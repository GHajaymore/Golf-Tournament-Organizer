import { prisma } from "../db";
import { loadEventState, settingsOf } from "./tournament";
import { allowsAutoConfirm } from "../tournament-settings";
import { cutBlockers, cutBlockedSentence, cutRuleOf, cutHasBeenMade } from "../domain/cut-ready";
import {
  strokeCutOutcome,
  cutLineRows,
  cutTieRuleOf,
  cutTieDecisionsOf,
  type CutRule,
  type CutOutcome,
  type CutTie,
} from "../domain/cut";
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
 * through ("top 16 and ties") — since 2026-10-23 the default of three, the
 * organizer choosing per cut between that, a play-off and a countback
 * (`strokeCutOutcome`). A tie the chosen rule leaves to the committee holds the
 * cut until it is recorded (`strokeCutRefusal`).
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
 * is not — that player was told they had made it and played on it, and taking
 * their round away is the committee's to deal with.
 *
 * The FIRST cut into a round is different (2026-10-14): nobody has been told
 * they made anything, so a card somebody started before the round before was
 * closed is taken out with the rest, its holes written to Recent changes.
 * `Stage.cutMadeAt` records the first cut, which is how the two are told apart.
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
  cutMadeAt: Date | null;
  cutTies: string;
  cutTieDecisions: string;
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
  cutMadeAt: true,
  cutTies: true,
  cutTieDecisions: true,
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
  /**
   * ONLY THE FIELD'S CARDS (2026-10-09). A disqualified or withdrawn player's
   * card stays on the record but is nobody's result: walked on a 120-player
   * championship, a player DQ'd for not holding out kept the cut waiting on
   * "1 card needs your approval" — her twelve holes — while the dashboard,
   * counting the confirmed field through `roundProgress`, said 117 of 119
   * were in. Same field as the dashboard now, so the two cannot disagree.
   */
  const field = new Set(
    (await prisma.player.findMany({ where: { eventId, status: "confirmed" }, select: { id: true } })).map((p) => p.id),
  );
  const cards = (
    await prisma.scorecard.findMany({
      where: { eventId, stageId: feederId },
      select: { status: true, strokes: true, playerId: true },
    })
  ).filter((c) => field.has(c.playerId));
  const blockers = cutBlockers(cards, staffApproves);
  if (blockers.total > 0) return cutBlockedSentence(blockers, nameOf(pair.all, pair.feeder));
  /**
   * AND A TIE FOR THE LAST PLACE THE COMMITTEE HAS NOT SETTLED (2026-10-23).
   * Under a play-off, or a countback that could not separate them, the cut
   * waits for the committee to record who went through — refused rather than
   * made with a pick, so nobody in the tie is ever told they are out.
   */
  const made = await strokeCutOutcomeOf(eventId, feederId);
  if (made && made.outcome.undecided.length > 0) {
    return cutTieRefusal(made.outcome.undecided, made.names, nameOf(pair.all, pair.feeder));
  }
  return null;
}

/** "Ann", "Ann and Bob", "Ann, Bob and Cy". */
function listOf(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the organizer is told when a cut waits on a tie — said where they pressed. */
export function cutTieRefusal(undecided: readonly CutTie[], names: ReadonlyMap<string, string>, feederName: string): string {
  const t = undecided[0];
  const who = listOf(t.playerIds.map((id) => names.get(id) ?? "A player"));
  const places = t.places === 1 ? "the last place" : `the last ${t.places} places`;
  const how =
    t.by === "playoff"
      ? "This cut settles a tie by play-off: record who won it on the dashboard's cut card"
      : "This cut settles a tie by countback, and theirs cannot be separated: record the draw by lot on the dashboard's cut card";
  const more = undecided.length > 1 ? ` (and ${undecided.length - 1} more flight${undecided.length === 2 ? " is" : "s are"} tied)` : "";
  return `${who} are level for ${places}${more}. ${how}, then mark ${feederName} finished.`;
}

/**
 * WHO GOES THROUGH THE CUT OUT OF `feederId` — `strokeCutOutcome` on the field
 * ranked as of that round, under the next round's tie rule and the decisions the
 * committee has recorded. The one door the cut, its refusal, the dashboard's
 * preview and the tie card all go through. Null when there is no stroke cut, or
 * nothing has been returned to cut on.
 */
export async function strokeCutOutcomeOf(
  eventId: string,
  feederId: string,
): Promise<{
  outcome: CutOutcome;
  feeder: StageRow;
  next: StageRow;
  all: StageRow[];
  state: NonNullable<Awaited<ReturnType<typeof loadEventState>>>;
  /** Everybody's name, by id, for the sentences. */
  names: Map<string, string>;
} | null> {
  const pair = await cutRoundAfter(eventId, feederId);
  if (!pair) return null;
  // Ranked on the rounds up to and including the feeder only — a round 2 card
  // somebody started early must not move who made a cut out of round 1.
  const state = await loadEventState(eventId, pair.feeder.id);
  if (!state) return null;
  const rows = cutLineRows(state.strokeStandings, state.strokeRankingBasis);
  if (rows.length === 0) return null;
  const outcome = strokeCutOutcome(rows, ruleOf(pair.next), cutTieRuleOf(pair.next.cutTies), cutTieDecisionsOf(pair.next.cutTieDecisions));
  const names = new Map(state.players.map((p) => [p.id, p.name]));
  return { outcome, ...pair, state, names };
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
  // door; here so a cut can never be made on cards that are not results, nor
  // through a tie nobody has settled.
  if (await strokeCutRefusal(eventId, feederId)) return null;

  // Nothing returned yet: a cut taken on nothing would advance nobody, which
  // is worse than leaving the round open to all. Refuse quietly — the board
  // still shows the cut line, and closing again once cards are in applies it.
  const made = await strokeCutOutcomeOf(eventId, feederId);
  if (!made || made.outcome.undecided.length > 0) return null;
  const { state, outcome } = made;
  const through = outcome.through;
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
  /** The holes on a card, in order, to the last one scored: "5 – 4" for a gap. */
  const holesOf = (json: string): string[] => {
    try {
      const row = (JSON.parse(json) as unknown[]).map((v) => (typeof v === "number" && v > 0 ? String(v) : "–"));
      const last = row.map((v) => v !== "–").lastIndexOf(true);
      return row.slice(0, last + 1);
    } catch {
      return [];
    }
  };
  const holding = new Set(existing.map((c) => c.playerId));
  /**
   * THE FIRST CUT INTO A ROUND TAKES OUT EVERY CARD OF A PLAYER IT LEAVES OUT —
   * scored or not (2026-10-14).
   *
   * Before any cut the round is everybody's, so a player can start a card in it
   * while the round before is still open; and a card with holes on it was never
   * removed. So anybody who teed off before round 1 was closed came through
   * whatever the cut said: measured, a 75 against a cut to the top two stayed
   * in round 2, ranked, not marked as having missed it.
   *
   * A cut RE-MADE after a correction keeps the rule it had: a card with holes on
   * it stays. That player was told they had made it and played on it, and
   * taking their round away is the committee's call, not a side effect of
   * fixing a typo in round 1. `cutMadeAt` is what tells the two apart.
   */
  const first = next.cutMadeAt == null;
  const setAside = first ? existing.filter((c) => !through.has(c.playerId) && hasStrokes(c.strokes)) : [];

  await prisma.$transaction(async (tx) => {
    for (const id of through) {
      if (!holding.has(id)) {
        await tx.scorecard.create({ data: { eventId, stageId: next.id, playerId: id, strokes: emptyStrokes } });
      }
    }
    const stale = existing.filter((c) => !through.has(c.playerId) && (first || !hasStrokes(c.strokes))).map((c) => c.id);
    if (stale.length > 0) await tx.scorecard.deleteMany({ where: { id: { in: stale } } });
    if (first) await tx.stage.update({ where: { id: next.id }, data: { cutMadeAt: new Date() } });
  });
  // Each card taken out with holes on it, by name, with the holes: the record
  // the committee reads in Recent changes, and all it needs to put them back.
  for (const c of setAside) {
    const name = state.players.find((p) => p.id === c.playerId)?.name ?? "A player";
    const holes = holesOf(c.strokes);
    const played = holes.filter((h) => h !== "–").length;
    await logAudit(
      eventId,
      "cut-applied",
      `${name}'s ${nameOf(all, next)} card was taken out: they did not make the cut. It held ${played} ${played === 1 ? "hole" : "holes"} (${holes.join(" ")}), started before ${nameOf(all, feeder)} was closed. To put them back in, enter it again in Score entry.`,
    );
  }

  const rule = ruleOf(next);
  const tieRule = cutTieRuleOf(next.cutTies);
  const wording = rule.mode === "percent" ? `top ${rule.percent}%` : `top ${rule.count}`;
  // How the line was settled, in the record: "and ties", or who won the
  // play-off or the draw, by name, so Recent changes answers "why him?".
  const settled = outcome.decided
    .map(
      (d) =>
        ` ${listOf(d.through.map((id) => made.names.get(id) ?? "A player"))} went through on the ${d.by === "playoff" ? "play-off" : "draw"} for ${d.places === 1 ? "the last place" : `the last ${d.places} places`}, of ${listOf(d.playerIds.map((id) => made.names.get(id) ?? "A player"))}.`,
    )
    .join("");
  await logAudit(
    eventId,
    "cut-applied",
    `${nameOf(all, feeder)} closed: ${wording}${tieRule === "ties" ? " and ties" : ""} go through — ${through.size} into ${nameOf(all, next)}.${settled}`,
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
  // The one answer to whether the cut has been made — the board asks it too.
  if (!round || !cutHasBeenMade(round, i > 0 ? rounds[i - 1] : undefined)) return null;
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
