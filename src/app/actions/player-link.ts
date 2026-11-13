"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { assertEventWritable } from "@/lib/services/club-archive";
import { clientGuessGate } from "@/lib/rate-limit";
import { clientAddress } from "@/lib/client-address";
import { PLAYER_LINK_WORDS, normaliseLinkCode, passStatusWords, readHandOver, suggestsNewLink } from "@/lib/domain/player-link";
import { ensurePass, passForCode, passStatusFor, recordOpen, revokePass, rotatePass } from "@/lib/services/player-link";
import { choosePlayerViewCookie, clearGuestCookie, getGuestSession, setGuestCookie } from "@/lib/guest-auth";
import { deviceValueHere } from "@/lib/services/known-device";
import { logAudit } from "@/lib/services/action-shared";

/**
 * THE GUEST'S PLAYER LINK, PRESSED (J39/J40 PR 1; design §2, §4.1).
 *
 * Opening: `openPlayerLink` is the ONLY door, and it is a POST made by a TAP on
 * /p (S1) — a page load, a link-preview bot, a mail scanner's headless browser
 * opens nothing, records no browser and raises no alarm. It never makes a User
 * session (`createSession` is not called) and does not ask the sign-in hold
 * (D9: links work before launch, like round codes).
 *
 * The organizer's panel: status, show (made on first use), new link, turn off.
 * Staff of the tournament only; the code leaves the server only as the answer
 * to one of those presses, and each hand-over is an audit line that never
 * holds the code (S7).
 */

/** Every client whose address cannot be read shares one bucket (S2a: a stated fallback, never no limit). */
const NO_ADDRESS = "no-client-address";
/** The platform-wide failure counter's one identity (S2c). */
const PLATFORM = "player-link-platform";

type Opened = { ok: true } | { ok: false; error: string };

/* The organizer panel's gate and argument check, above every action so no action's text carries them. */
async function requireStaffSession() {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") throw new Error("Organizer access required");
  await assertEventWritable(session.eventId);
  return session;
}

const asId = (v: unknown): string => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : "");


/**
 * A tap on "Open my card", or a typed code. In order: the shape (free), the
 * platform alarm, the per-client limit (S2: keyed on the client, NEVER on the
 * code; a success gives its one attempt back and nothing is ever cleared), the
 * lookup by keyed hash, the live-pass rule, then the browser, the cookie and
 * the audit line. Unknown and dead codes get one answer.
 */
export async function openPlayerLink(code: unknown): Promise<Opened> {
  const normal = normaliseLinkCode(code);
  if (!normal) return { ok: false, error: PLAYER_LINK_WORDS.notACode };
  const client = (await clientAddress()) ?? NO_ADDRESS;

  const alarm = await clientGuessGate("player-link-alarm", PLATFORM);
  const slow = alarm.decision.allowed ? null : await clientGuessGate("player-link-slow", client);
  if (!alarm.decision.allowed) {
    console.error("[player-link] platform alarm: failed player-link opens are above the hourly threshold; opens are slowed");
    if (slow && !slow.decision.allowed) return { ok: false, error: slow.decision.message };
  }
  const guess = await clientGuessGate("player-link-client", client);
  if (!guess.decision.allowed) return { ok: false, error: guess.decision.message };

  const pass = await passForCode(normal);
  if (!pass) return { ok: false, error: PLAYER_LINK_WORDS.dead };
  await Promise.all([guess.succeeded(), alarm.succeeded(), slow?.succeeded()]);

  const { newBrowser } = await recordOpen(pass.passId, await deviceValueHere(true));
  await setGuestCookie(pass.passId, pass.version);
  // Beside a sign-in, the link is what this browser just chose to look through (S4).
  if (await getSession()) await choosePlayerViewCookie("guest");
  if (newBrowser) {
    await logAudit(pass.eventId, "player-link.opened", `${pass.playerId}'s player link opened on a new phone or browser`, { actor: pass.name });
  }
  revalidatePath("/me", "layout");
  return { ok: true };
}

/** "Forget me on this phone": clears the link from THIS browser only. Revokes nothing. */
export async function forgetThisPhone(): Promise<{ ok: true }> {
  const held = await getGuestSession();
  await clearGuestCookie();
  if (held) revalidatePath("/me", "layout");
  return { ok: true };
}

/**
 * A browser holding BOTH a sign-in and a link chooses which to look through
 * (S4: offered side by side, never merged). Only with both: it switches
 * between two things this browser already holds and grants nothing.
 */
export async function choosePlayerView(view: unknown): Promise<{ ok: boolean }> {
  if (view !== "guest" && view !== "account") return { ok: false };
  const [held, account] = await Promise.all([getGuestSession(), getSession()]);
  if (!held || !account) return { ok: false };
  await choosePlayerViewCookie(view);
  revalidatePath("/me", "layout");
  return { ok: true };
}

/* ───────────────────────── the organizer's panel ───────────────────────── */

export type LinkStatusResult =
  | { ok: true; status: string; made: boolean; revoked: boolean; suggestNew: boolean }
  | { ok: false; error: string };

/** The panel's status line. Never the code. */
export async function playerLinkStatus(playerId: unknown): Promise<LinkStatusResult> {
  const session = await requireStaffSession();
  const status = await passStatusFor(session.eventId, asId(playerId));
  if (!status) return { ok: false, error: PLAYER_LINK_WORDS.membersHaveEmail };
  return { ok: true, status: passStatusWords(status), made: status.made, revoked: status.revoked, suggestNew: suggestsNewLink(status) };
}

export type ShowLinkResult = { ok: true; code: string } | { ok: false; error: string };

const HANDED_WORDS = { shown: "shown", read: "read out", copied: "copied", shared: "shared" } as const;

/**
 * THE CODE, for Show QR, Read it out, Copy and Share (made on first use, D13;
 * the same code every time until New link, D3). Answered to the press only,
 * and each press is on the record by who and how — never the code (S7).
 */
export async function showPlayerLink(playerId: unknown, how: unknown): Promise<ShowLinkResult> {
  const session = await requireStaffSession();
  const id = asId(playerId);
  const shown = await ensurePass(session.eventId, id, session.name);
  if (!shown.ok) {
    return {
      ok: false,
      error: shown.reason === "turned-off" ? "This link is turned off. Press New link to make a new one." : PLAYER_LINK_WORDS.membersHaveEmail,
    };
  }
  await logAudit(session.eventId, "player-link.handed", `${id}'s player link ${HANDED_WORDS[readHandOver(how) ?? "shown"]}`);
  return { ok: true, code: shown.code };
}

/** NEW LINK: the old code and every phone holding it stop working (the panel confirms first). */
export async function newPlayerLink(playerId: unknown): Promise<ShowLinkResult> {
  const session = await requireStaffSession();
  const id = asId(playerId);
  const made = await rotatePass(session.eventId, id, session.name);
  if (!made.ok) return { ok: false, error: PLAYER_LINK_WORDS.membersHaveEmail };
  await logAudit(session.eventId, "player-link.new", `${id}'s player link replaced with a new one`);
  return { ok: true, code: made.code };
}

/** TURN OFF LINK: it stops opening everywhere; the round code still scores the day. */
export async function turnOffPlayerLink(playerId: unknown): Promise<{ ok: boolean; error?: string }> {
  const session = await requireStaffSession();
  const id = asId(playerId);
  const done = await revokePass(session.eventId, id, session.name);
  if (!done) return { ok: false, error: "There is no link turned on for this player." };
  await logAudit(session.eventId, "player-link.off", `${id}'s player link turned off`);
  return { ok: true };
}
