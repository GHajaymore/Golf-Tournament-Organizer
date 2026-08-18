import type { BracketView, BracketSlot } from "./bracket";

/**
 * The third-place match — the two beaten semi-finalists.
 *
 * A knockout in this app ends at the Final and stops, so a championship
 * produces two placings out of four. Every club that runs one plays off for
 * third, and the audit called this out as a capability gap rather than a bug:
 * the word "third" appears nowhere in the codebase.
 *
 * It is structurally unlike every other bracket match, which is why it could
 * not simply be another round. Every match in a draw is fed by WINNERS; this
 * one is fed by LOSERS, and `drawBrackets` accepts no loser-derived pairing
 * except `plate`, which takes first-round losers only. So rather than bend the
 * draw, this derives the pairing from the semi-finals the same way the Single
 * Match Stage derives its own — read late, from results as they stand.
 *
 * Deliberately NOT part of `buildBracket`. A third-place match is a decision a
 * committee makes about a tournament, not a property of a draw of that size,
 * and threading it through the bracket builder would put an optional fixture
 * in the middle of the structure every other screen reads.
 */

export interface ThirdPlacePairing {
  a: BracketSlot;
  b: BracketSlot;
}

export interface ThirdPlaceResolution {
  pairing: ThirdPlacePairing | null;
  /**
   * Why there is no pairing yet, in words. Empty when there is one.
   *
   * "The semi-finals have not been played" is the ordinary state for most of a
   * knockout, so this is an explanation rather than an error.
   */
  problem: string;
}

/**
 * The round that feeds it: the one before the Final.
 *
 * Found by position rather than by label, because a label is a display string
 * and a draw of eight calls its semi-final round something different from a
 * draw of thirty-two.
 */
export function semiFinalRound(view: BracketView): BracketView["rounds"][number] | null {
  if (view.rounds.length < 2) return null;
  return view.rounds[view.rounds.length - 2] ?? null;
}

/**
 * Who plays for third, from the semi-finals as they stand.
 *
 * Never guesses. A semi-final without a winner produces no pairing and says
 * so, because a third-place match invented from an unfinished semi would name
 * two players who might both still reach the Final.
 */
export function resolveThirdPlace(view: BracketView | null): ThirdPlaceResolution {
  const none = (problem: string): ThirdPlaceResolution => ({ pairing: null, problem });
  if (!view) return none("There's no bracket yet.");

  const semis = semiFinalRound(view);
  if (!semis) return none("This draw is too small to have a semi-final round.");
  if (semis.matches.length !== 2) {
    // A play-off for third is a two-semi-final idea. A draw whose penultimate
    // round has four matches has quarter-finalists, not beaten semi-finalists.
    return none("A third-place match needs exactly two semi-finals.");
  }

  const losers: BracketSlot[] = [];
  for (const m of semis.matches) {
    if (!m.winnerId) {
      return none("Waiting on the semi-finals — the losers of those two play for third.");
    }
    // The loser is whichever side is not the winner. A slot with no player id
    // is a bye or an unfilled place, and there is nobody to lose it.
    const loser = m.a.playerId === m.winnerId ? m.b : m.a;
    if (!loser.playerId) {
      return none("One semi-final was a bye, so there is no beaten semi-finalist from it.");
    }
    losers.push(loser);
  }

  if (losers[0].playerId === losers[1].playerId) {
    // Not reachable in a well-formed draw, and worth refusing rather than
    // producing a match somebody plays against themselves.
    return none("Both semi-finals name the same beaten player.");
  }

  return { pairing: { a: losers[0], b: losers[1] }, problem: "" };
}

/** How it reads on the bracket screen and the results sheet. */
export const THIRD_PLACE_LABEL = "Play-off for third";

export const THIRD_PLACE_HELP =
  "The two beaten semi-finalists play for third and fourth. Off by default — plenty of clubs send everyone to the bar instead — and it only appears once both semi-finals have a winner.";
