import { matchStrokeCards, type MatchCardRow, type MatchForCards } from "./match-cards";
import { isKnockoutRound } from "../stage-types";

/**
 * HAS THIS ROUND BEEN PLAYED AT ALL — the rounds with any result, ONE rule.
 *
 * It was written twice: in `loadEventState` (`state.roundsWithResults`, which
 * Rounds & formats, the final report and completing read) and again in the
 * state machine's reader (`tournamentFactsFor`'s `hasResult`, proposal 3 Nov,
 * PR 1), held equal only by an audit test. PR 2 makes both callers of this, so
 * the two cannot drift — the shape `docs/one-rule-one-place.md` asks for.
 *
 * Built from every table a round's result can live in, because a round's
 * result lives in whichever one its format writes: a medal round returns
 * `Scorecard` rows, a match round keeps the result on `Match.holes`, and net
 * match play writes `MatchScorecard` as well. A set built from cards alone
 * would call a round-robin night that has been played "upcoming" for ever.
 *
 * `cards` is every returned card, INDIVIDUAL AND TEAM (`playedCards` in
 * `loadEventState`, 2026-10-31): a side playing one ball — a scramble, a best
 * ball — files a `TeamScorecard`, and a set built from the individual cards
 * alone read a played scramble "Upcoming" on Rounds & formats, left it out of
 * the final report's round-by-round tables, and would have had completing call
 * it "not played".
 *
 * `/[1-9AaBbHh]/` is the same test `playRefusal` uses for "has anybody been out
 * on the course" — one hole is enough — and a forfeit is a result.
 *
 * A KNOCKOUT'S RESULTS ARE IN NEITHER TABLE. `BracketWinner` is keyed by slot
 * (`winners-0-1`) rather than by stage, so a bracket with every semi-final
 * recorded holds no `Match` row and no card. Left out, the demo's Round 4
 * stayed "Upcoming" on a bracket whose final already had two names in it. Any
 * winner recorded means the knockout has started; it is attributed to every
 * knockout stage, because the key does not name one and a tournament with two
 * brackets runs them off the same set of picks. `resultsIn` still leaves this
 * table out — that is D2 of the proposal, settled when PR 3/4 move its readers
 * onto the machine, because settling it moves what the dashboard says.
 */
export function roundsWithResultsFrom(input: {
  stages: ReadonlyArray<{ id: string; type: string }>;
  cards: ReadonlyArray<{ stageId: string | null }>;
  matchCards: MatchCardRow[];
  matches: ReadonlyArray<MatchForCards & { forfeitedBy?: string | null }>;
  /** How many `BracketWinner` rows the tournament has — only "any" matters. */
  bracketWinners: number;
}): Set<string> {
  return new Set<string>([
    ...input.cards.filter((c) => c.stageId).map((c) => c.stageId as string),
    ...matchStrokeCards(input.matchCards, [...input.matches]).map((c) => c.stageId),
    ...input.matches.filter((m) => /[1-9AaBbHh]/.test(m.holes) || m.forfeitedBy).map((m) => m.stageId),
    ...(input.bracketWinners > 0 ? input.stages.filter((s) => isKnockoutRound(s.type)).map((s) => s.id) : []),
  ]);
}
