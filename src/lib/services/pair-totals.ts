import "server-only";
import type { EventState } from "./tournament";
import { playingStages } from "./tournament";
import { teamStandings } from "./teams";
import { boardKindForRound } from "../stage-types";
import { weekBasis, type WeekBasis } from "../domain/week-basis";
import { pairTotals, type PairTotal } from "../domain/pair-totals";
import { roundNumber } from "../domain/round-label";

export interface EventPairTotals {
  basis: WeekBasis;
  /** "R1", "R2" … one per team round, numbered as the tournament numbers it (`roundNumber`). */
  labels: string[];
  rows: PairTotal[];
}

/**
 * The pairs' total over every team round of the event — see `pairTotals`.
 *
 * Each round is read by `teamStandings` on `strokeCourseFor`, the same reader
 * and the same card the round's own board uses, so a round's figure in the
 * total is the figure on that round's board. Null when there is no total to
 * show: fewer than two team rounds, rounds on different bases, partners
 * changed between rounds, or no card returned anywhere.
 */
export async function eventPairTotals(state: EventState): Promise<EventPairTotals | null> {
  const rounds = playingStages(state.stages).filter((s) => boardKindForRound(s.format, s.type) === "team");
  if (rounds.length < 2) return null;
  const basis = weekBasis(rounds[0].scoringBasis, rounds[0].format);
  if (rounds.some((r) => weekBasis(r.scoringBasis, r.format) !== basis)) return null;

  const perRound = await Promise.all(
    rounds.map((r) => {
      const card = state.strokeCourseFor(r.id);
      return teamStandings(
        state.event.id,
        r.id,
        r.format,
        card.pars,
        card.holeDifficulty,
        r.scoringBasis,
        r.handicapAllowance,
        r.allowanceWeights,
        r.countBest,
      );
    }),
  );
  const rows = pairTotals(perRound, basis);
  if (!rows.some((r) => r.played > 0)) return null;
  return { basis, labels: rounds.map((r) => `R${roundNumber(state.stages, r.id)}`), rows };
}
