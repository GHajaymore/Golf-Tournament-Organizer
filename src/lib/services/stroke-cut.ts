import { prisma } from "../db";
import { loadEventState, settingsOf } from "./tournament";
import { allowsAutoConfirm } from "../tournament-settings";
import { cutBlockers, cutBlockedSentence, cutRuleOf } from "../domain/cut-ready";
import { survivorsWithTies, type CutRule } from "../domain/cut";
import { isPlayingRound, isIndividualStrokeRound } from "../stage-types";
import { holesPlayed } from "../domain/handicap";
import { logAudit } from "./action-shared";
import { roundLabel, roundKicker } from "../domain/round-label";

/**
 * THE STROKE-PLAY CUT, APPLIED — Ajay's decisions of 2026-09-26.
 *
 * A cut was configurable on a stroke round ("cuts to top 16", printed on the
 * rules sheet) and never applied: `generateCutRound` builds a round only from a
 * round-robin feeder. So in a 36-hole championship every player cut after
 * round 1 was offered a round 2 card, and entering one put them back on the
 * board. Found walking the seeded Club Championship as a player who missed the
 * cut: Today offered "Start my card" for round 2.
 *
 * Two decisions: the cut is applied when the round it is taken out of is
 * closed ("This round is finished"), and players level on the last place ALL go
 * through ("top 16 and ties").
 *
 * NOT by completing the tournament, which this comment used to claim and the
 * code never did. Ajay confirmed on 2026-10-05 that it should not: a cut is
 * made between rounds, by the committee, after every card is approved — and
 * since that day closing the round is refused until they are
 * (`strokeCutRefusal`), with the dashboard asking for it once they are
 * (`roundReadyForCut`).
 *
 * Applied the way the round-robin path already does it: every survivor gets an
 * empty, playable card for the next round, and nobody else does — so the field
 * of the round is exactly who the cut let through. Re-closing after a
 * correction re-applies it: new survivors get a card, and an EMPTY card left
 * with a player who no longer survives is removed. A card with strokes on it
 * is never removed — that is a round somebody played, and the committee's to
 * deal with.
 */

type StageRow = {
  id: string;
  position: number;
  type: string;
  format: string;
  holes: number;
  description: string;
  cutEnabled: boolean;
  cutScope: string;
  cutMode: string;
  cutCount: number;
  cutPercent: number;
  closedAt: Date | null;
};

const STAGE_SELECT = {
  id: true,
  position: true,
  type: true,
  format: true,
  holes: true,
  description: true,
  cutEnabled: true,
  cutScope: true,
  cutMode: true,
  cutCount: true,
  cutPercent: true,
  closedAt: true,
} as const;

/**
 * What a player calls a round: the organizer's own name for it, else the
 * number from `roundLabel` — the one count in the app, which does not count a
 * cut as a round. Never `position + 1` (see `round-number-source.test.ts`).
 */
function nameOf(all: readonly StageRow[], s: StageRow): string {
  // `roundKicker`: the description only where it reads as a NAME. Every round
  // is added carrying its type's blurb as its description, so "the organizer's
  // own name, else the number" was always the blurb — "didn't play The field
  // plays the round and returns cards; …" under every missed cut (2026-10-04).
  return roundKicker(s.description, roundLabel(all, s.id) || "the round before");
}

/** A round whose scores are individual stroke cards — the only kind this cuts. */
const individualStroke = (s: StageRow): boolean => isIndividualStrokeRound(s);

/** Shared with the dashboard's preview of the cut — see `cutRuleOf`. */
const ruleOf = (next: StageRow): CutRule => cutRuleOf(next);

/** The playing round after `feeder`, if its field is decided by a stroke cut out of it. */
async function cutRoundAfter(
  eventId: string,
  feederId: string,
): Promise<{ feeder: StageRow; next: StageRow; all: StageRow[] } | null> {
  const all = await prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" }, select: STAGE_SELECT });
  const rounds = all.filter((s) => isPlayingRound(s.type));
  const i = rounds.findIndex((s) => s.id === feederId);
  const feeder = rounds[i];
  const next = rounds[i + 1];
  if (!feeder || !next || !next.cutEnabled) return null;
  if (!individualStroke(feeder) || !individualStroke(next)) return null;
  return { feeder, next, all };
}

/**
 * WHY THE CUT OUT OF `feederId` CANNOT BE MADE YET, or null when it can (or
 * when there is no cut to make).
 *
 * Ajay, 2026-10-05: "Cut can't be final unless organizer approve all cards and
 * approve the Cut." Closing the round IS approving the cut — it is the act that
 * makes it — so `setRoundClosed` asks this first and refuses to close while any
 * card in the round is not yet a result: awaiting the committee's approval, not
 * returned, or disputed. Refused rather than closed-without-a-cut, because a
 * closed feeder is what `strokeCutField` reads as "the cut has been made", and
 * a round closed with no cut applied would hand the next round an empty field.
 *
 * Here, beside `applyStrokeCut`, so the rule lives where the cut is made and a
 * second door into closing a round cannot forget it.
 */
export async function strokeCutRefusal(eventId: string, feederId: string): Promise<string | null> {
  const pair = await cutRoundAfter(eventId, feederId);
  if (!pair) return null;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return null;
  const staffApproves = !allowsAutoConfirm(settingsOf(event));
  const cards = await prisma.scorecard.findMany({
    where: { eventId, stageId: feederId },
    select: { status: true, strokes: true },
  });
  const blockers = cutBlockers(cards, staffApproves);
  return blockers.total > 0 ? cutBlockedSentence(blockers, nameOf(pair.all, pair.feeder)) : null;
}

/**
 * Apply the cut out of `feederId` into the round after it, if there is one.
 * Returns how many go through, or null when there is no stroke cut to apply.
 */
export async function applyStrokeCut(eventId: string, feederId: string): Promise<{ through: number } | null> {
  const pair = await cutRoundAfter(eventId, feederId);
  if (!pair) return null;
  const { feeder, next, all } = pair;
  // The same refusal `setRoundClosed` asks first. Never reached through that
  // door; here so a cut can never be made on cards that are not results.
  if (await strokeCutRefusal(eventId, feederId)) return null;

  // Ranked on the rounds up to and including the feeder only — a round 2 card
  // somebody started early must not move who made a cut out of round 1.
  const state = await loadEventState(eventId, feeder.id);
  if (!state) return null;
  const ranked = state.strokeStandings
    .filter((s) => s.ranked)
    .map((s) => ({ id: s.player.id, groupId: s.player.groupId, rank: s.rank }));
  // Nothing returned yet: a cut taken on nothing would advance nobody, which
  // is worse than leaving the round open to all. Refuse quietly — the board
  // still shows the cut line, and closing again once cards are in applies it.
  if (ranked.length === 0) return null;

  const through = survivorsWithTies(ranked, ruleOf(next));
  const emptyStrokes = JSON.stringify(new Array(holesPlayed(next.holes)).fill(null));

  const existing = await prisma.scorecard.findMany({
    where: { eventId, stageId: next.id },
    select: { id: true, playerId: true, strokes: true },
  });
  const hasStrokes = (json: string) => {
    try {
      return (JSON.parse(json) as unknown[]).some((v) => typeof v === "number" && v > 0);
    } catch {
      return false;
    }
  };
  const holding = new Set(existing.map((c) => c.playerId));

  await prisma.$transaction(async (tx) => {
    for (const id of through) {
      if (!holding.has(id)) {
        await tx.scorecard.create({ data: { eventId, stageId: next.id, playerId: id, strokes: emptyStrokes } });
      }
    }
    const stale = existing.filter((c) => !through.has(c.playerId) && !hasStrokes(c.strokes)).map((c) => c.id);
    if (stale.length > 0) await tx.scorecard.deleteMany({ where: { id: { in: stale } } });
  });

  const rule = ruleOf(next);
  const wording = rule.mode === "percent" ? `top ${rule.percent}%` : `top ${rule.count}`;
  await logAudit(
    eventId,
    "cut-applied",
    `${nameOf(all, feeder)} closed: ${wording} and ties go through — ${through.size} into ${nameOf(all, next)}.`,
  );
  return { through: through.size };
}

/**
 * Who may play `stageId`, when its field was decided by an applied stroke cut
 * — the players holding a card for it — or null when the round is open to the
 * whole field (no cut, or the round it is cut from is not closed yet).
 */
export async function strokeCutField(eventId: string, stageId: string): Promise<Set<string> | null> {
  const rounds = (
    await prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" }, select: STAGE_SELECT })
  ).filter((s) => isPlayingRound(s.type));
  const i = rounds.findIndex((s) => s.id === stageId);
  const round = rounds[i];
  const feeder = rounds[i - 1];
  if (!round || !feeder || !round.cutEnabled || !feeder.closedAt) return null;
  if (!individualStroke(feeder) || !individualStroke(round)) return null;
  const cards = await prisma.scorecard.findMany({ where: { eventId, stageId }, select: { playerId: true } });
  return new Set(cards.map((c) => c.playerId));
}

/** The name a player reads for the round the cut was taken out of. */
export async function cutFeederName(eventId: string, stageId: string): Promise<string> {
  const all = await prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" }, select: STAGE_SELECT });
  const rounds = all.filter((s) => isPlayingRound(s.type));
  const i = rounds.findIndex((s) => s.id === stageId);
  const feeder = rounds[i - 1];
  return feeder ? nameOf(all, feeder) : "the round before";
}
