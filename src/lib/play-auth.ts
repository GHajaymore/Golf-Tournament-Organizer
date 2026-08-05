import "server-only";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { sign, verify } from "./auth";

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

const PLAY_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: SECURE_COOKIES,
  path: "/",
  // Short by design. A code is a shared secret for one round of golf; there's
  // no reason for it to still be letting someone in a week later.
  maxAge: 60 * 60 * 12,
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
  jar.set(PLAY_COOKIE, sign(`${stageId}:${playerId}`), PLAY_COOKIE_OPTS);
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

  const [stageId, playerId] = raw.split(":");
  if (!stageId || !playerId) return null;

  const stage = await prisma.stage.findUnique({
    where: { id: stageId },
    include: { event: true },
  });
  // No code on the round means code access was switched off or the code was
  // reissued — either way this session is no longer valid.
  if (!stage || !stage.accessCode) return null;

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
