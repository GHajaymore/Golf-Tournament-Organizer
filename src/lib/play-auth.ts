import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { sign, verify } from "./auth";
import { cleanSettings, usesAccessCodes } from "./tournament-settings";

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

export async function createPlaySession(stageId: string, playerId: string): Promise<void> {
  const jar = await cookies();
  // The expiry is inside the signed value, not only in the cookie's maxAge.
  // maxAge is a request the browser may honour; anyone holding the cookie
  // string can keep replaying it forever, because the signature over
  // "stage:player" alone never goes stale. Signing the deadline is what makes
  // "12 hours" a rule the server enforces rather than a hint the client obeys.
  jar.set(PLAY_COOKIE, sign(`${stageId}:${playerId}:${Date.now() + PLAY_SESSION_TTL_MS}`), PLAY_COOKIE_OPTS);
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

  const [stageId, playerId, expiresAt] = raw.split(":");
  if (!stageId || !playerId || !expiresAt) return null;

  // Cookies signed before the deadline joined the payload have no third field
  // and land here, which is the intended outcome: they are exactly the
  // never-expiring ones this check exists to retire. The holder re-enters the
  // code that is already on their tee sheet.
  const deadline = Number(expiresAt);
  if (!Number.isFinite(deadline) || Date.now() > deadline) return null;

  const stage = await prisma.stage.findUnique({
    where: { id: stageId },
    include: { event: true },
  });
  // No code on the round means code access was switched off or the code was
  // reissued — either way this session is no longer valid.
  if (!stage || !stage.accessCode) return null;
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

  const stages = await prisma.stage.findMany({
    where: { eventId: stage.eventId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const index = stages.findIndex((s) => s.id === stage.id);

  return {
    stageId,
    playerId,
    eventId: stage.eventId,
    playerName: player.name,
    roundLabel: `Round ${index + 1}`,
  };
}
