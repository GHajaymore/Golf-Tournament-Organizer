"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { normalizeAccessCode, looksLikeAccessCode } from "@/lib/code-format";
import { createPlaySession, destroyPlaySession, getPlaySession } from "@/lib/play-auth";
import { settingsOf } from "@/lib/services/tournament";
import { usesAccessCodes, canPlayerSavePartial } from "@/lib/tournament-settings";
import { rateLimit, clearRateLimit, retryAfterText } from "@/lib/rate-limit";

/**
 * Redeeming a Round Code.
 *
 * The code is a shared secret announced to a field, so the security here rests
 * on rate limiting rather than on the code's length: 27^8 is a large space,
 * but only if an attacker can't sit there trying it.
 */

const REDEEM_LIMIT = 10;
const REDEEM_WINDOW_MS = 15 * 60 * 1000;

export interface RedeemResult {
  ok: boolean;
  error?: string;
  /** The field for that round, for the player to pick themselves from. */
  players?: Array<{ id: string; name: string }>;
  stageId?: string;
  eventName?: string;
  roundLabel?: string;
}

export async function redeemRoundCode(input: string): Promise<RedeemResult> {
  const code = normalizeAccessCode(input);

  // Shape-check before touching the database, so junk costs nothing.
  if (!looksLikeAccessCode(code)) {
    return { ok: false, error: "That doesn't look like a round code. It's 8 characters, like ABCD-EFGH." };
  }

  // Keyed on the code rather than on a caller identity, which we don't have
  // here — this caps how fast any one code can be guessed at.
  const limit = rateLimit(`redeem:${code}`, REDEEM_LIMIT, REDEEM_WINDOW_MS);
  if (!limit.ok) {
    return { ok: false, error: `Too many attempts. Try again in ${retryAfterText(limit.retryAfterSeconds)}.` };
  }

  const stage = await prisma.stage.findFirst({
    where: { accessCode: code },
    include: { event: true },
  });
  // Same message whether the code is wrong or the tournament has since turned
  // code access off — no reason to confirm that a code was once real.
  if (!stage || !usesAccessCodes(settingsOf(stage.event))) {
    return { ok: false, error: "That code isn't valid. Check it with your organizer." };
  }

  const players = await prisma.player.findMany({
    where: { eventId: stage.eventId, status: "confirmed" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const stages = await prisma.stage.findMany({
    where: { eventId: stage.eventId },
    orderBy: { position: "asc" },
    select: { id: true },
  });

  clearRateLimit(`redeem:${code}`);
  return {
    ok: true,
    players,
    stageId: stage.id,
    eventName: stage.event.name,
    roundLabel: `Round ${stages.findIndex((s) => s.id === stage.id) + 1}`,
  };
}

export interface ClaimResult {
  ok: boolean;
  error?: string;
}

/**
 * Say which player you are, and start the play session.
 *
 * Re-checks the code rather than trusting the stageId the browser sends back:
 * without that, someone who once saw a valid code could keep claiming slots
 * after it was reissued.
 */
export async function claimPlayerSlot(rawCode: string, playerId: string): Promise<ClaimResult> {
  const code = normalizeAccessCode(rawCode);
  if (!looksLikeAccessCode(code)) return { ok: false, error: "That code isn't valid." };

  // Rate limited on the same key as redeemRoundCode, and it must be: this
  // performs the identical accessCode lookup, so without a limit here an
  // attacker simply guesses codes through this action instead and the limit on
  // the other one counts for nothing. Sharing the key means attempts against a
  // code are capped however they arrive.
  const limit = rateLimit(`redeem:${code}`, REDEEM_LIMIT, REDEEM_WINDOW_MS);
  if (!limit.ok) {
    return { ok: false, error: `Too many attempts. Try again in ${retryAfterText(limit.retryAfterSeconds)}.` };
  }

  const stage = await prisma.stage.findFirst({
    where: { accessCode: code },
    include: { event: true },
  });
  if (!stage || !usesAccessCodes(settingsOf(stage.event))) {
    return { ok: false, error: "That code isn't valid." };
  }

  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId: stage.eventId, status: "confirmed" },
    select: { id: true },
  });
  // Same message as a bad code. Saying "pick your name from the list" here
  // would confirm that the code was real — turning a failed claim into a
  // reliable oracle for which codes exist.
  if (!player) return { ok: false, error: "That code isn't valid." };

  // A genuine claim resets the budget, so a fourball fumbling the code on the
  // first tee doesn't lock the group out of the round they're about to play.
  clearRateLimit(`redeem:${code}`);
  await createPlaySession(stage.id, player.id);
  revalidatePath("/play");
  return { ok: true };
}

export async function leavePlay(): Promise<void> {
  await destroyPlaySession();
  revalidatePath("/play");
}

/**
 * Save the signed-in play session's own match card.
 *
 * A separate action from the console's `saveMatchHoles` because the
 * authorization is completely different: this trusts a Round Code rather than
 * an account, so it re-derives everything from the session and refuses to
 * touch any match the holder isn't playing in.
 */
export async function savePlayMatchHoles(
  matchId: string,
  holes: Array<"A" | "B" | "H" | null>,
): Promise<ClaimResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);
  if (!event || !match) return { ok: false, error: "Match not found." };

  // Scoped three ways: the right tournament, the right round, and a match this
  // player is actually in.
  if (match.eventId !== session.eventId || match.stageId !== session.stageId) {
    return { ok: false, error: "That match isn't in your round." };
  }
  // Being "in" a match means being on one of its sides. In an individual
  // format the sides are the two player columns; in a team format those are
  // empty by design and the sides are teams — so checking the player columns
  // alone refused every four-ball partner their own match. Same scoring-group
  // rule as domain/attest.ts: the match decides who belongs, and membership of
  // either side qualifies.
  let inMatch = match.playerAId === session.playerId || match.playerBId === session.playerId;
  if (!inMatch && (match.teamAId || match.teamBId)) {
    const teamIds = [match.teamAId, match.teamBId].filter((id) => id !== "");
    const membership = await prisma.teamMember.findFirst({
      where: { playerId: session.playerId, teamId: { in: teamIds } },
      select: { id: true },
    });
    inMatch = membership !== null;
  }
  if (!inMatch) {
    return { ok: false, error: "You can only enter scores for your own match." };
  }

  const settings = settingsOf(event);
  const complete = holes.every((h) => h !== null);
  if (!complete && !canPlayerSavePartial(settings)) {
    return { ok: false, error: "Enter the full round, then submit it." };
  }

  await prisma.match.update({
    where: { id: matchId },
    data: {
      holes: JSON.stringify(holes),
      scoreStatus: "pending",
      scoredAt: complete ? new Date() : null,
      confirmedById: null,
    },
  });
  await prisma.auditLog.create({
    data: {
      eventId: session.eventId,
      matchId,
      actor: session.playerName,
      action: "score",
      detail: "Entered via round code",
    },
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
