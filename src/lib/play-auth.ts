import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { sign, verify, fingerprint } from "./auth";
import { cleanSettings, usesAccessCodes } from "./tournament-settings";
import { roundLabel } from "./domain/round-label";

/**
 * The Round Code play session.
 *
 * Deliberately separate from the main session: this identifies a *player in
 * one round*, not a user account. There is no User row, no password, and no
 * role — the holder entered a code that was announced to the field and then
 * said which of the listed players they are.
 *
 * That means it is a weaker credential than a password, and it is scoped to
 * match: one round of one tournament, score entry only. Nothing in the
 * organizer console is reachable with it.
 */

const PLAY_COOKIE = "ng_play";
const SECURE_COOKIES = process.env.NODE_ENV === "production";

/** One round of golf, plus enough slack for a slow four-ball and a rain delay. */
const PLAY_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const PLAY_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: SECURE_COOKIES,
  path: "/",
  // Short by design. A code is a shared secret for one round of golf; there's
  // no reason for it to still be letting someone in a week later.
  maxAge: PLAY_SESSION_TTL_MS / 1000,
} as const;

export interface PlaySession {
  stageId: string;
  playerId: string;
  eventId: string;
  playerName: string;
  roundLabel: string;
}

/**
 * Which code a session was opened with, as a fingerprint rather than the code.
 *
 * The session has to be bound to the code that opened it, or reissuing one
 * cannot end it (see `getPlaySession`). Binding to a digest rather than the
 * code itself keeps the shared secret out of the cookie: this is only ever
 * compared against a value recomputed from the row, so it never needs to be
 * reversed. Keyed with the app secret so it cannot be precomputed against the
 * small alphabet a Round Code is drawn from.
 */
export function codeFingerprint(code: string): string {
  // Colon-free by construction, because the payload it joins is colon-split.
  return fingerprint(`round-code:${code}`).slice(0, 16);
}

export async function createPlaySession(stageId: string, playerId: string, accessCode: string): Promise<void> {
  const jar = await cookies();
  // The expiry is inside the signed value, not only in the cookie's maxAge.
  // maxAge is a request the browser may honour; anyone holding the cookie
  // string can keep replaying it forever, because the signature over
  // "stage:player" alone never goes stale. Signing the deadline is what makes
  // "12 hours" a rule the server enforces rather than a hint the client obeys.
  //
  // The code's fingerprint is signed for the same reason: so that WHICH code
  // let this holder in is a fact the server can check, not something it has to
  // take on trust.
  jar.set(
    PLAY_COOKIE,
    sign(`${stageId}:${playerId}:${Date.now() + PLAY_SESSION_TTL_MS}:${codeFingerprint(accessCode)}`),
    PLAY_COOKIE_OPTS,
  );
}

export async function destroyPlaySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(PLAY_COOKIE);
}

/**
 * Resolve the current play session, re-checking the database every time.
 *
 * The cookie is only a claim. It is re-verified against live data on each
 * request so that revoking a Round Code (reissuing it, or switching code
 * access off) takes effect immediately instead of leaving already-issued
 * cookies working until they expire.
 */
export async function getPlaySession(): Promise<PlaySession | null> {
  const jar = await cookies();
  const raw = verify(jar.get(PLAY_COOKIE)?.value);
  if (!raw) return null;

  const [stageId, playerId, expiresAt, codePrint] = raw.split(":");
  if (!stageId || !playerId || !expiresAt || !codePrint) return null;

  // Cookies signed before the deadline and the code fingerprint joined the
  // payload are short a field and land here, which is the intended outcome:
  // they are exactly the sessions these checks exist to retire. The holder
  // re-enters the code that is already on their tee sheet.
  const deadline = Number(expiresAt);
  if (!Number.isFinite(deadline) || Date.now() > deadline) return null;

  const stage = await prisma.stage.findUnique({
    where: { id: stageId },
    include: { event: true },
  });
  // No code on the round means code access was switched off.
  if (!stage || !stage.accessCode) return null;
  /**
   * And it must be the SAME code this session was opened with.
   *
   * This tested non-emptiness, and `regenerateRoundCode` writes a new
   * non-empty code onto the same row — so a reissue changed nothing for anyone
   * already holding a cookie. A leaked code stayed usable for the remaining
   * twelve hours, and the holder went on writing match results through
   * `savePlayMatchHoles`, each of which clears `confirmedById` and puts the
   * score back to pending.
   *
   * The comment above this function has always said a reissue "takes effect
   * immediately"; three places in the app tell the organizer the same, and
   * `PlaySettings.tsx` recommends reissuing "if it travels beyond the field".
   * That is the remedy the product offers for exactly this situation, so it
   * has to be the one thing that certainly works.
   */
  if (codeFingerprint(stage.accessCode) !== codePrint) return null;
  // And the tournament must still be running on codes at all. Switching
  // playerAccess away from codes clears them, so this is belt-and-braces —
  // but it is the setting that actually decides, and a stale accessCode left
  // behind by any other write path must not keep a session alive.
  if (!usesAccessCodes(cleanSettings(stage.event))) return null;

  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId: stage.eventId },
    select: { name: true },
  });
  if (!player) return null;

  // `type` as well as `id`: the number is over the rounds the field PLAYS, and
  // a cut is a stage nobody plays. Counting rows made the round after a cut one
  // higher here than the same round on every screen that counted rounds.
  const stages = await prisma.stage.findMany({
    where: { eventId: stage.eventId },
    orderBy: { position: "asc" },
    select: { id: true, type: true },
  });

  return {
    stageId,
    playerId,
    eventId: stage.eventId,
    playerName: player.name,
    roundLabel: roundLabel(stages, stage.id),
  };
}
