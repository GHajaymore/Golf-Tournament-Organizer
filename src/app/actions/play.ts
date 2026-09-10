"use server";
import { revalidatePath } from "next/cache";
import { boardChanged } from "@/lib/services/board-refresh";
import { prisma } from "@/lib/db";
import { normalizeAccessCode, looksLikeAccessCode } from "@/lib/code-format";
import { createPlaySession, destroyPlaySession, getPlaySession } from "@/lib/play-auth";
import { settingsOf } from "@/lib/services/tournament";
import { usesAccessCodes, canPlayerSavePartial, canEnterScores } from "@/lib/tournament-settings";
import { checkRateLimit, clearRateLimit } from "@/lib/rate-limit";
import { cleanHoleResults } from "@/lib/domain/score-payload";
import { roundLabel } from "@/lib/domain/round-label";
import { marginToHoles } from "@/lib/domain";
import { writeScorecard } from "@/lib/services/scorecard-write";

/**
 * Redeeming a Round Code.
 *
 * The code is a shared secret announced to a field, so the security here rests
 * on rate limiting rather than on the code's length: 27^8 is a large space,
 * but only if an attacker can't sit there trying it.
 *
 * The allowance and the wording live in src/lib/domain/rate-limit.ts; the
 * counters live in Postgres, because until recently they lived in the memory
 * of a serverless instance and an attacker got a fresh budget every time they
 * landed on a cold one.
 */

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
  const limit = await checkRateLimit("round-code", code);
  if (!limit.allowed) return { ok: false, error: limit.message };

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

  // `type` as well as `id` — see play-auth: the number counts rounds, not rows,
  // and a cut is a row that is not a round.
  const stages = await prisma.stage.findMany({
    where: { eventId: stage.eventId },
    orderBy: { position: "asc" },
    select: { id: true, type: true },
  });

  await clearRateLimit("round-code", code);
  return {
    ok: true,
    players,
    stageId: stage.id,
    eventName: stage.event.name,
    roundLabel: roundLabel(stages, stage.id),
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
  const limit = await checkRateLimit("round-code", code);
  if (!limit.allowed) return { ok: false, error: limit.message };

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
  await clearRateLimit("round-code", code);
  // The stored code, not the typed one, so the session is bound to the row a
  // reissue will overwrite.
  await createPlaySession(stage.id, player.id, stage.accessCode);
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

  const settings = settingsOf(event);
  // The tournament decides who reports scores, and this surface has to ask the
  // same question the console does — see requireScoreEntry in
  // actions/tournament.ts and the same check in actions/courses.ts.
  //
  // A round code identifies a player and never staff, so a committee-scored
  // tournament must refuse it outright. Without this, an organizer who handed
  // out round codes purely so the field could sign in believed nobody but the
  // committee could touch a result, while any code holder could overwrite a
  // card and — because a score edit always resets approval — send one the
  // committee had already confirmed back to pending with nobody told.
  if (!canEnterScores(settings, "player")) {
    return { ok: false, error: "Scores for this tournament are entered by the organizer." };
  }

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

  // The payload itself, which nothing checked until now. The signature says
  // Array<"A"|"B"|"H"|null> and that type is erased at runtime, so what
  // arrives is whatever was posted. It is not inert once stored: holes.length
  // decides how nassau segments a match and which holes the tiebreakers read,
  // so a wrong-length array changes the RESULT rather than just the row.
  const stage = await prisma.stage.findUnique({
    where: { id: match.stageId },
    select: { holes: true },
  });
  const clean = cleanHoleResults(holes, stage?.holes === 9 ? 9 : 18);
  if (!clean) {
    return { ok: false, error: "Those scores aren't valid. Reload the round and try again." };
  }

  const complete = clean.every((h) => h !== null);
  if (!complete && !canPlayerSavePartial(settings)) {
    return { ok: false, error: "Enter the full round, then submit it." };
  }

  await prisma.match.update({
    where: { id: matchId },
    data: {
      holes: JSON.stringify(clean),
      scoreStatus: "pending",
      scoredAt: complete ? new Date() : null,
      confirmedById: null,
      // Who wrote it down, by name AND by player id. The id is what stops the
      // author signing their own result off — see services/attestation.ts. The
      // round-code surface recorded neither, so a result entered from a phone
      // on the course had no author at all.
      enteredBy: session.playerName,
      enteredById: session.playerId,
      // A new entry supersedes any signatures already collected: they attested
      // a different scoreline.
      attestedBy: "[]",
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

  // The standings just moved, so the crowd watching the public board should
  // see it now rather than when its sixty-second backstop expires.
  boardChanged(session.eventId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The result phoned in from the green: winner and margin, nothing else.
 *
 * The most-used quick path in real match play — "3&2" — brought to the
 * round-code surface with exactly the checks the console path has: the same
 * membership guard as savePlayMatchHoles, and the same refusal of margins
 * that describe no possible match. It reconstructs holes via marginToHoles so
 * a phoned-in result and a tapped-in card are identical downstream.
 *
 * No canPlayerSavePartial check here, unlike the hole-by-hole path: a result
 * IS the finished round arriving in one submission, which is precisely what
 * `scoreEntryWindow: "after"` asks for. The nulls marginToHoles leaves for a
 * closed-out "3&2" are holes nobody played, not holes nobody has reached yet,
 * so reading them as a partial card would refuse the most common real result
 * in match play.
 */
/** Hole count from the stored holes array (9 or 18 depending on the round). */
function matchHoleCount(holesJson: string): number {
  try {
    const parsed = JSON.parse(holesJson) as unknown[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.length : 18;
  } catch {
    return 18;
  }
}

export async function savePlayMatchResult(
  matchId: string,
  winner: "A" | "B" | "H",
  margin: string,
): Promise<ClaimResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);
  if (!event || !match) return { ok: false, error: "Match not found." };

  // Same entry gate as savePlayMatchHoles. Both write a result, so a guard on
  // only one of them protects nothing: phoning in "3&2" overwrites the card
  // just as completely as tapping eighteen holes.
  if (!canEnterScores(settingsOf(event), "player")) {
    return { ok: false, error: "Scores for this tournament are entered by the organizer." };
  }

  if (match.eventId !== session.eventId || match.stageId !== session.stageId) {
    return { ok: false, error: "That match isn't in your round." };
  }

  // Same membership rule as savePlayMatchHoles: player columns in an
  // individual format, team membership in a team format.
  let inMatch = match.playerAId === session.playerId || match.playerBId === session.playerId;
  if (!inMatch && (match.teamAId || match.teamBId)) {
    const teamIds = [match.teamAId, match.teamBId].filter((id) => id !== "");
    const membership = await prisma.teamMember.findFirst({
      where: { playerId: session.playerId, teamId: { in: teamIds } },
      select: { id: true },
    });
    inMatch = membership !== null;
  }
  if (!inMatch) return { ok: false, error: "You can only enter scores for your own match." };

  if (winner !== "A" && winner !== "B" && winner !== "H") {
    return { ok: false, error: "Pick a winner, or halved." };
  }

  // "2&3" is not a match anyone has won; the transposition almost always is.
  const total = matchHoleCount(match.holes);
  const amp = /^(\d+)\s*&\s*(\d+)$/.exec(margin.trim().toUpperCase());
  if (amp) {
    const lead = parseInt(amp[1], 10);
    const toPlay = parseInt(amp[2], 10);
    if (lead <= toPlay) {
      return {
        ok: false,
        error: `"${margin}" isn't a possible result — did you mean "${toPlay}&${lead}"?`,
      };
    }
    if (lead > total) return { ok: false, error: `"${margin}" can't happen over ${total} holes.` };
  }

  const holes = marginToHoles(winner, margin, total);
  await prisma.match.update({
    where: { id: matchId },
    data: {
      holes: JSON.stringify(holes),
      scoreStatus: "pending",
      scoredAt: new Date(),
      confirmedById: null,
    },
  });
  await prisma.auditLog.create({
    data: {
      eventId: session.eventId,
      matchId,
      actor: session.playerName,
      action: "score",
      detail: `Result entered via round code: ${winner === "H" ? "halved" : margin || "1 UP"}`,
    },
  });
  return { ok: true };
}

/**
 * A stroke card, entered with a Round Code.
 *
 * THE HALF THIS SURFACE DID NOT HAVE. Everything above scores a MATCH, so a
 * medal round with code access — which is exactly what the charity-day
 * template sets up, with `scoreEntryBy: "players"` and a Round Code so a
 * roster of names can get in without accounts — sent every player who
 * redeemed their code to "No match for you in Round 1. Check with your
 * organizer." Walked on 2026-09-10. There was nothing wrong with the draw;
 * there is simply no draw in a medal, and this was the only door.
 *
 * IT WRITES THROUGH `writeScorecard`, the same function the console's own
 * entry screen uses. Validation, the partial-card rule, the revision
 * conflict, whether a save retracts a certification and when a round's
 * handicaps freeze are all rules with real subtlety and a bug behind each —
 * a second copy of them here is how two writers of one card come to disagree.
 *
 * THE AUTHORIZATION IS THIS FILE'S OWN, and that is the half that must never
 * be shared. A round code identifies a player and never staff, so it asks the
 * same two questions `savePlayMatchHoles` asks — does the tournament let
 * players report at all, and is this round the one the code opened — and adds
 * nothing about roles, because there is no role here to add.
 */
export async function savePlayCard(strokes: (number | null)[]): Promise<ClaimResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };

  const [event, stage] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.stage.findUnique({ where: { id: session.stageId }, select: { id: true, eventId: true } }),
  ]);
  if (!event || !stage) return { ok: false, error: "Round not found." };

  // The round the code opened has to belong to the tournament the session
  // names. Both come off the signed cookie, so this cannot normally differ —
  // and "cannot normally" is not a reason to write a card without asking.
  if (stage.eventId !== session.eventId) return { ok: false, error: "That round isn't in your tournament." };

  const settings = settingsOf(event);
  /**
   * The same refusal the match path gives, for the same reason. A committee-
   * scored tournament must refuse a round code outright: without this, an
   * organizer who handed out codes purely so the field could sign in believed
   * only the committee could touch a result, while any code holder could
   * overwrite a card — and a score edit always resets approval, so one the
   * committee had already confirmed would go back to pending with nobody told.
   */
  if (!canEnterScores(settings, "player")) {
    return { ok: false, error: "Scores for this tournament are entered by the organizer." };
  }

  /**
   * The card is written for the player the SESSION names, never one the
   * caller sends. There is no playerId argument for the same reason the match
   * path checks membership: a round code is a shared secret announced to a
   * field, so anybody holding it could otherwise write anybody's card.
   */
  try {
    const result = await writeScorecard({
      eventId: session.eventId,
      stageId: session.stageId,
      playerId: session.playerId,
      strokes,
      settings,
      role: "player",
      // The phone is holding the card it just typed, and this surface has no
      // offline queue behind it — the console's conflict path is for a replay
      // arriving minutes late, which cannot happen here.
      expectedRevision: undefined,
    });
    if (!result.ok) {
      return { ok: false, error: "Somebody else has changed this card. Reload and try again." };
    }
  } catch (e) {
    // `writeScorecard` throws on an invalid payload, a partial card that is
    // not allowed and a locked card, exactly as it did inside the console
    // action. This surface reports rather than crashes: the message is written
    // for a player standing on the 18th green, not for a stack trace.
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save that card." };
  }

  await prisma.auditLog.create({
    data: {
      eventId: session.eventId,
      matchId: null,
      actor: session.playerName,
      action: "score",
      detail: "Card entered via round code",
    },
  });
  boardChanged(session.eventId);
  revalidatePath("/", "layout");
  return { ok: true };
}
