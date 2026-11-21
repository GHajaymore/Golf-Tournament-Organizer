"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clientAddress } from "@/lib/client-address";
import { checkRateLimit } from "@/lib/rate-limit";
import { deviceValueHere } from "@/lib/services/known-device";
import { setGuestCookie, holdsLivePassIn } from "@/lib/guest-auth";
import { archiveRefusalFor } from "@/lib/services/club-archive";
import { logAudit } from "@/lib/services/action-shared";
import { entryLinkBudgetFor } from "@/lib/services/registration";
import { createWaitingGuest, entryForNonce, GuestWaitingFull, guestEntryRefusal, nonceHashOf } from "@/lib/services/guest-entry";
import { deviceHashOf, unsealCode } from "@/lib/services/player-link";
import { openAnyCode } from "@/lib/services/code-door";
import { cleanGuestRegistration, GUEST_WORDS, isGuestNonce } from "@/lib/domain/guest-entry";
import { groupedCode } from "@/lib/domain/player-link";
import { roundCodeLink } from "@/lib/code-format";

/**
 * A GUEST ENTERS THEMSELVES ON THE ONE SIGN-UP LINK (J39/J40 PR 3B; design §3.3, the Security Lead's C1.x to C4.x).
 *
 * Ruling (Ajay, 7 Nov): guests need no email and no app; they enter themselves only when the organizer switches it
 * on, and ALWAYS with approval. So this door makes a WAITING entry and a pass, and nothing else: no place, no roster
 * member, no account, no session, no email, no tees. It never calls `createSession`, `syncPlayerAccount`,
 * `sendRegistrationEmail` or any sign-in code (C1.9: the guest door is outside the hold, like links and round codes).
 *
 * These are PUBLIC endpoints: every argument is `unknown` and read at the boundary.
 */

/** A device value as `newBrowserValue` makes it (32 random bytes, base64url). Anything else is not a device we set. */
const DEVICE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type GuestEntryResult =
  | { ok: true; /** Waiting for staff (the only status this door makes). */ status: "pending"; /** The browser's own code, grouped; shown ONCE, held in client state only (C3.3). */ code: string | null; already?: boolean }
  | { ok: false; error: string };

/**
 * THE DEVICE COOKIE IS SET BEFORE THE SUBMIT (D3): pressing "Enter as a guest" asks this, so the form's own request
 * arrives holding one and costs the cookieless bucket nothing. A phone that refuses cookies still gets in, counted in
 * `guest-entry-cookieless`. Makes no row.
 */
export async function startGuestEntry(): Promise<{ ok: boolean }> {
  await deviceValueHere(true);
  return { ok: true };
}

/**
 * ASK TO PLAY. In order (design §3.3): the token only (never the 8-character code: C1.1), the form, the nonce, the
 * token's flood budget, the event, a retry of this same press (C3.5), a browser that already holds a live pass, the
 * per-browser budget, the cookieless budget, the switch and the entry window, then the waiting cap under the lock.
 */
export async function registerAsGuest(token: unknown, form: unknown, nonce: unknown): Promise<GuestEntryResult> {
  // C1.1: the 114-bit token, never the entry code. A token is 24 symbols; an 8-character code is not one.
  const t = typeof token === "string" ? token.trim() : "";
  if (t.length < 16 || t.length > 64) return { ok: false, error: GUEST_WORDS.codeOpensNothing };

  const cleaned = cleanGuestRegistration(form);
  if (!cleaned.ok) return { ok: false, error: cleaned.error };
  if (!isGuestNonce(nonce)) return { ok: false, error: GUEST_WORDS.noSend };

  // The link's own flood budget (it grows with the field: a 30-guest outing fits), before any lookup.
  const byToken = await checkRateLimit("register-token", t, () => entryLinkBudgetFor(t));
  if (!byToken.allowed) return { ok: false, error: byToken.message };

  const event = await prisma.event.findFirst({ where: { registrationToken: t } });
  // The same neutral answer for an unknown, rotated or deleted token.
  if (!event) return { ok: false, error: GUEST_WORDS.codeOpensNothing };

  // This browser, as the link's own key hashes it: a device we set (the shape we make), or none.
  const raw = await deviceValueHere(false);
  const device = raw && DEVICE_SHAPE.test(raw) ? raw : null;
  const deviceHash = device ? deviceHashOf(device) : "";
  const nonceHash = nonceHashOf(nonce, event.id, deviceHash);

  // C3.5: a retry of the SAME press, from the same device, inside its window, is the same entry: never a second one.
  const retry = await entryForNonce(event.id, nonceHash);
  if (retry) {
    await setGuestCookie(retry.id, retry.version);
    const again = unsealCode(retry.sealed, retry.id, retry.version);
    return { ok: true, status: "pending", code: again ? groupedCode(again) : null, already: true };
  }

  // One browser, one guest per event: a browser already holding a live pass here is sent to its Today.
  if (await holdsLivePassIn(event.id)) return { ok: true, status: "pending", code: null, already: true };

  const client = (await clientAddress()) ?? "no-client-address";
  if (device) {
    const perDevice = await checkRateLimit("guest-entry-device", `${deviceHash}|${event.id}`);
    if (!perDevice.allowed) return { ok: false, error: perDevice.message };
  } else {
    // No valid device: set one for the next request, and count THIS one against its own network + event.
    await deviceValueHere(true);
    const cookieless = await checkRateLimit("guest-entry-cookieless", `${client}|${event.id}`);
    if (!cookieless.allowed) return { ok: false, error: cookieless.message };
  }

  // A lapsed club's archive takes nobody new (asked here, as every door into a tournament asks it).
  if (await archiveRefusalFor(event.id, "player")) return { ok: false, error: GUEST_WORDS.notOpen };
  // The switch, the entry window on the club's day, the archive: one answer (`guestEntryRefusal`).
  if (await guestEntryRefusal(event)) return { ok: false, error: GUEST_WORDS.notOpen };

  let made;
  try {
    made = await createWaitingGuest(event, cleaned.value, nonceHash);
  } catch (e) {
    // The waiting cap: the one limit sentence, nothing revealed.
    if (e instanceof GuestWaitingFull) return { ok: false, error: GUEST_WORDS.limit };
    throw e;
  }
  await setGuestCookie(made.passId, made.version);
  // On the organizer's record, by the name given. Never the code (S7).
  await logAudit(event.id, "guest-entry.asked", `${cleaned.value.name} asked to play as a guest (waiting for approval).`, { actor: cleaned.value.name });
  return { ok: true, status: "pending", code: groupedCode(made.code) };
}

export interface TypedEntryState {
  error?: string;
  /** What was typed, kept in the box after a refusal. */
  code: string;
}

/**
 * THE TYPED CODE AT /register: one box, one door. The press hands the WHOLE input to the one door for a typed code
 * (`openAnyCode`: shape first, the failed-lookup gate before the lookup, the openness check before any token leaves),
 * and on success redirects the browser to the page the code opens, from a POST (the code is never in an address).
 * One kind-neutral sentence for every failure (C1.10). A closed code never reaches a page that names its event (C4.4).
 */
export async function guestEntryFor(_before: TypedEntryState | null, form: FormData): Promise<TypedEntryState> {
  const typed = form.get("code");
  const opened = await openAnyCode(typed, await clientAddress());
  if (!opened.ok) return { error: opened.error, code: String(typed ?? "").slice(0, 64) };
  // Outside any try: `redirect` works by throwing.
  if (opened.kind === "round") redirect(roundCodeLink("", opened.code));
  redirect(opened.href);
}
