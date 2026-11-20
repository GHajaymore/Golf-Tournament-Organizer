"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertEventWritable } from "@/lib/services/club-archive";
import { PLAYER_LINK_WORDS, passStatusWords, readHandOver, suggestsNewLink } from "@/lib/domain/player-link";
import { ensurePass, mutePass, passStatusFor, revokePass, rotatePass } from "@/lib/services/player-link";
import { choosePlayerViewCookie, clearGuestCookie, getGuestSession } from "@/lib/guest-auth";
import { logAudit } from "@/lib/services/action-shared";
import { forgetPassHere } from "@/lib/services/push";

/**
 * THE GUEST'S PLAYER LINK, PRESSED (J39/J40 PR 1; design §2, §4.1).
 *
 * Opening is THE ONE DOOR FOR A TYPED CODE (`openAnyCode`, services/code-door.ts,
 * pressed through actions/code-box.ts), and it is a POST made by a TAP on /p or a
 * press of any code box (S1) — a page load, a link-preview bot, a mail scanner's headless browser
 * opens nothing, records no browser and raises no alarm. It never makes a User
 * session (`createSession` is not called) and does not ask the sign-in hold
 * (D9: links work before launch, like round codes).
 *
 * The organizer's panel: status, show (made on first use), new link, turn off.
 * Staff of the tournament only; the code leaves the server only as the answer
 * to one of those presses, and each hand-over is an audit line that never
 * holds the code (S7).
 */

/* The organizer panel's gate and argument check, above every action so no action's text carries them. */
async function requireStaffSession(opts: { evenArchived?: boolean } = {}) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") throw new Error("Organizer access required");
  // Turning a link OFF is allowed in a lapsed club's archive (security review SF-5): a leaked link
  // must be stoppable there too. Showing or making one is not.
  if (!opts.evenArchived) await assertEventWritable(session.eventId);
  return session;
}

const asId = (v: unknown): string => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : "");

/**
 * "Forget me on this phone": clears the link from THIS browser only. Revokes
 * nothing. And this phone stops getting the guest's notices (review of #1133,
 * SEC-1): the held pass's push row for this browser's endpoint goes first, as
 * Forget changes no version and the sender would otherwise go on reaching a
 * borrowed phone. The endpoint is the browser's own, sent by the button.
 *
 * It ENDS WITH `redirect("/p")`, as Sign out ends with its own, and the client
 * does not navigate itself (QA finding G638-1 #2). Clearing a cookie in an
 * action makes Next re-render the page it was pressed on (`/me`), and with no
 * viewer left `/me` sends the router to the sign-in front door — which, on
 * WebKit, cancelled the button's own `location.assign("/p")` and left a guest
 * on an iPhone at the front door. Dropping `revalidatePath` would not have
 * stopped it (the cookie alone re-renders); redirecting from here renders `/p`
 * in the action's own answer, so there is one navigation on every engine.
 */
export async function forgetThisPhone(endpoint?: unknown): Promise<never> {
  const held = await getGuestSession();
  if (held) await forgetPassHere(held.passId, endpoint);
  await clearGuestCookie();
  redirect("/p");
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
  | { ok: true; status: string; made: boolean; revoked: boolean; suggestNew: boolean; muted: boolean }
  | { ok: false; error: string };

/** The panel's status line. Never the code. */
export async function playerLinkStatus(playerId: unknown): Promise<LinkStatusResult> {
  const session = await requireStaffSession();
  const status = await passStatusFor(session.eventId, asId(playerId));
  if (!status) return { ok: false, error: PLAYER_LINK_WORDS.membersHaveEmail };
  return {
    ok: true,
    status: passStatusWords(status),
    made: status.made,
    revoked: status.revoked,
    suggestNew: suggestsNewLink(status),
    muted: !!status.muted,
  };
}

/**
 * MUTE IN MESSAGES (J39/J40 PR 2, S8): the guest's posts to the round, group
 * and other threads are refused in words; Message the organizer stays open, and
 * the link, the card and Today are untouched. Staff of the event only, resolved
 * inside it as a guest entry; allowed in a lapsed club's archive, like Turn off
 * (SF-5). On the record by who, never by a code.
 */
export async function muteGuestInMessages(playerId: unknown, muted: unknown): Promise<{ ok: boolean; error?: string }> {
  const session = await requireStaffSession({ evenArchived: true });
  const id = asId(playerId);
  const on = muted === true;
  const done = await mutePass(session.eventId, id, on, session.name);
  if (!done) return { ok: false, error: "Make this guest's link first: there is nothing to mute yet." };
  await logAudit(session.eventId, on ? "player-link.muted" : "player-link.unmuted", `${id} ${on ? "muted" : "unmuted"} in messages by ${session.name}`);
  return { ok: true };
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
  const session = await requireStaffSession({ evenArchived: true });
  const id = asId(playerId);
  const done = await revokePass(session.eventId, id, session.name);
  if (!done) return { ok: false, error: "There is no link turned on for this player." };
  await logAudit(session.eventId, "player-link.off", `${id}'s player link turned off`);
  return { ok: true };
}
