import { isKnockoutRound, isStraightKnockout } from "../stage-types";
import { isBracketMode, type BracketMode, type BracketView } from "./bracket";

/**
 * WHETHER ANYBODY HAS PLAYED THE ROUNDS THAT FEED THE DRAW (2026-10-16).
 * Before then a qualified draw is the entry order, and the Bracket screen says
 * so ("in entry order for now"). A straight knockout has nothing before it and
 * is seeded from the start — on handicap, which is what a player's seed is.
 */
export function qualifyingPlayed(stages: ReadonlyArray<{ id: string; type: string }>, roundsWithResults: ReadonlySet<string>): boolean {
  const firstKnockout = stages.findIndex((s) => isKnockoutRound(s.type));
  return stages.slice(0, firstKnockout < 0 ? 0 : firstKnockout).some((s) => roundsWithResults.has(s.id));
}

/**
 * WHICH OF A TOURNAMENT'S DRAWS WERE SEEDED (the panel, 2026-10-23: "seed
 * numbers shown only when the draw was actually seeded"), one answer per draw
 * in the order handed in.
 *
 *   a qualified draw, nothing qualifying yet played   no — it is the entry order for now
 *   a plate                                           no — it is filled by who lost, in the order they lost
 *   flights divided "Evenly, at random"               no — drawn by lot; the order is the lot's, and
 *                                                      printing it as 1, 2, 3 made the first dealt read
 *                                                      as a top seed (the golf professional, 2026-10-23)
 *   everything else                                    yes — on qualifying, or on handicap
 *
 * The one answer the Bracket screen, the player's Board and the public board
 * all ask, so a seed number cannot be on one and not another. Asked of each
 * draw's own kind rather than its place in a list, because the member-facing
 * lists leave out a draw nobody is in yet and the places move.
 */
export function drawsSeeded(input: {
  stages: ReadonlyArray<{ id: string; type: string }>;
  roundsWithResults: ReadonlySet<string>;
  mode: BracketMode;
  /** How a field in flights was divided (`FlightPlan.criterion`), or null when it is not in flights. */
  criterion: string | null;
  draws: ReadonlyArray<{ view: Pick<BracketView, "kind"> }>;
}): boolean[] {
  const ordered = isStraightKnockout(input.stages) || qualifyingPlayed(input.stages, input.roundsWithResults);
  const byLot = input.mode === "flights" && input.criterion === "random";
  return input.draws.map((d) => ordered && !byLot && !(input.mode === "plate" && d.view.kind === "consolation"));
}

/** Each draw with its answer attached — what the member-facing boards carry. */
export function seededDraws<D extends { label: string; view: BracketView }>(
  state: {
    stages: ReadonlyArray<{ id: string; type: string }>;
    roundsWithResults: ReadonlySet<string>;
    event: { bracketMode: string };
    flights?: { plan: { criterion: string } } | null;
  },
  draws: D[],
): Array<D & { seeded: boolean }> {
  const mode: BracketMode = isBracketMode(state.event.bracketMode) ? state.event.bracketMode : "split";
  const criterion = state.flights?.plan.criterion ?? null;
  const answers = drawsSeeded({ stages: state.stages, roundsWithResults: state.roundsWithResults, mode, criterion, draws });
  return draws.map((d, i) => ({ ...d, seeded: answers[i] }));
}
