/**
 * WHY A ROUND PLAYED AS FIXTURES HAS NONE YET — and the way forward (J06,
 * state machine PR 3).
 *
 * The dashboard's progress tile read "Matches complete 0/0 · 0% of this round"
 * over a round robin with no flights: true, and no use to anybody — nothing
 * on it said why nothing was drawn or what to press. The state machine's round
 * robin family gives the tile its cause (proposal 2e: "Generate Round N
 * pairings" if a round has none; flights hold launch for a round robin, Golf
 * Pro 8.2), and this says it in plain words with the screen that fixes it.
 *
 * Pure, and told everything it needs: the flights made, the round's label, and
 * whether its field is the survivors of a cut (drawn once the round before is
 * closed, never during setup).
 */
export interface NothingDrawn {
  /** The tile's figure: a state, not "0/0". */
  value: string;
  /** Why, in one sentence. */
  why: string;
  /** The way forward — a sentence and a screen. */
  wayOut: { says: string; href: string };
}

export function nothingDrawnWords(input: {
  /** Flights made (not match carriers). */
  groups: number;
  /** "Round 1", from `roundLabel`. */
  roundLabel: string;
  /** Its field comes from a cut, so it is drawn once the round before closes. */
  cutFed: boolean;
  /** What the sidebar calls Flights and Rounds & formats — `screenName`. */
  flightsScreen: string;
  roundsScreen: string;
}): NothingDrawn {
  const round = input.roundLabel || "This round";
  if (input.cutFed) {
    return {
      value: "Not drawn yet",
      why: `${round} is played by the players who make the cut, so its matches are drawn once the round before it is closed.`,
      wayOut: { says: `Close the round before it on ${input.roundsScreen}`, href: "/stages" },
    };
  }
  if (input.groups === 0) {
    return {
      value: "No flights yet",
      why: "A round robin is played inside flights, and none are made yet, so nobody has anyone to play.",
      wayOut: { says: `Make the flights on ${input.flightsScreen}`, href: "/grouping" },
    };
  }
  return {
    value: "Not drawn yet",
    why: `The flights are made, but ${round}'s pairings have not been generated.`,
    wayOut: { says: `Generate them on ${input.roundsScreen}`, href: "/stages" },
  };
}
