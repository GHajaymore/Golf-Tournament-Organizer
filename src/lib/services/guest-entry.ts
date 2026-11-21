import "server-only";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db";
import { derivedKey } from "@/lib/auth";
import { generateAccessCode } from "@/lib/codes";
import { Prisma } from "@prisma/client";
import { NONCE_WINDOW_MINUTES, waitingCapFor, type CleanedGuest } from "@/lib/domain/guest-entry";
import { entryLinkIsOpen } from "@/lib/services/registration";
import { fieldLimitFor } from "@/lib/services/waitlist";
import { withEventIntakeLock } from "@/lib/services/intake-lock";
import { makePassIn } from "@/lib/services/player-link";

/**
 * A GUEST ENTERS THEMSELVES (J39/J40 PR 3B), stored. The one place the entry code is made and the one place a
 * self-entered guest's row and pass are written. Nothing here makes a place, an account, a roster row or a session:
 * the entry is WAITING, whatever the event's approval mode, until a staff press (`approveSignup`).
 */

const NONCE_KEY = "guest-entry-nonce";

/**
 * The Ask-to-play nonce, kept as a keyed hash bound to the EVENT and to this browser's device (C3.5): the same nonce
 * from another device, or for another event, hashes to a different value and finds nothing.
 */
export function nonceHashOf(nonce: string, eventId: string, deviceHash: string): string {
  return createHmac("sha256", derivedKey(NONCE_KEY)).update(`${eventId}|${deviceHash}|${nonce}`).digest("hex");
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * THE ENTRY CODE, MADE LAZILY BY A STAFF PRESS ONLY (C1.4): the first Print poster, the first Show code or the first
 * guest turn-on. Never at entries-open and never on a public read, so an event whose link is only emailed never carries
 * a guessable door. Made only while a token exists. Checked against BOTH tables (a round's `accessCode` and the events'
 * `registrationCode`) and drawn again on a clash (C1.5). Returns the code, or null with no token to be the short form of.
 */
/** A code that no round and no event holds: drawn again on a clash with EITHER table (C1.5). */
export async function drawRegistrationCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateAccessCode();
    const [round, entry] = await Promise.all([
      prisma.stage.count({ where: { accessCode: code } }),
      prisma.event.count({ where: { registrationCode: code } }),
    ]);
    if (round === 0 && entry === 0) return code;
  }
  throw new Error("Couldn't make the sign-up code just now. Try again.");
}

export async function ensureRegistrationCode(eventId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { registrationToken: true, registrationCode: true } });
    if (!event?.registrationToken) return null;
    if (event.registrationCode) return event.registrationCode;
    const code = await drawRegistrationCode();
    try {
      // Only where there is still none: two presses at once make one.
      const done = await prisma.event.updateMany({ where: { id: eventId, registrationCode: "" }, data: { registrationCode: code } });
      if (done.count === 1) return code;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("Couldn't make the sign-up code just now. Try again.");
}

/**
 * IS THE GUEST BUTTON OPEN (`guestEntryRefusal`): the one answer, asked by the sign-up page and by `registerAsGuest`.
 * The switch, entries open on the club's day (the SAME judgement as the member page: `entryLinkIsOpen`), and a club
 * that is not archived (inside `entryLinkIsOpen`). It does NOT govern the code: whether the code opens the page is the
 * sign-up link's own open rule, so with the switch off a typed code still reaches the member form.
 */
export async function guestEntryRefusal(event: { id: string; guestEntryOpen: boolean }): Promise<string | null> {
  if (!event.guestEntryOpen) return "off";
  if (!(await entryLinkIsOpen(event.id))) return "closed";
  return null;
}

/** A waiting guest entry that this nonce (from this device, inside its window) already made, or null (C3.5). */
export async function entryForNonce(eventId: string, nonceHash: string, now = new Date()) {
  const since = new Date(now.getTime() - NONCE_WINDOW_MINUTES * 60_000);
  return prisma.playerPass.findFirst({
    where: { eventId, entryNonceHash: nonceHash, entryNonceAt: { gte: since } },
    select: { id: true, version: true, sealed: true, playerId: true, player: { select: { status: true } } },
  });
}

export class GuestWaitingFull extends Error {}

/**
 * THE ENTRY AND ITS PASS, UNDER THE EVENT'S INTAKE LOCK: counted against the waiting cap (`max(24, the field's limit)`),
 * written as a guest (`standing: guest`), `status: "pending"`, no email, no phone, no `teeId`, NO roster row and no
 * account. The handicap fields hold what the guest declared (a pre-fill only; the committee's figure is written at
 * approval), "none" when nothing was declared: never a scratch golfer nobody declared.
 */
export async function createWaitingGuest(
  event: { id: string; capacity: number; playerCountMode: string; manualPlayerCount: number; organizationId: string },
  guest: CleanedGuest,
  nonceHash: string,
): Promise<{ playerId: string; passId: string; version: number; code: string }> {
  const cap = waitingCapFor(await fieldLimitFor(event));
  return withEventIntakeLock(event.id, async (tx) => {
    const waiting = await tx.player.count({ where: { eventId: event.id, status: "pending", standing: "guest" } });
    if (waiting >= cap) throw new GuestWaitingFull();
    const maxSeed = await tx.player.aggregate({ where: { eventId: event.id }, _max: { seed: true } });
    const made = await tx.player.create({
      select: { id: true },
      data: {
        eventId: event.id,
        name: guest.name,
        handicap: guest.declared ?? 0,
        handicapSource: guest.declared === null ? "none" : "manual",
        handicapType: "18",
        seed: (maxSeed._max.seed ?? 0) + 1,
        status: "pending",
        standing: "guest",
        email: "",
        phone: "",
      },
    });
    const pass = await makePassIn(tx, { eventId: event.id, playerId: made.id, by: guest.name, entryNote: guest.invitedBy, nonceHash });
    return { playerId: made.id, passId: pass.passId, version: pass.version, code: pass.code };
  });
}
