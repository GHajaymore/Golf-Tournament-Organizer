import { resolveMatch } from "./match";
import type { HoleResult } from "./types";

/**
 * A match, from the point of view of one of the two people in it.
 *
 * The app has always known who each player faces — the pairing is a Match row,
 * written when the draw was generated, and the console reads it on three
 * screens. The PLAYER's own screens never mentioned it. On 2026-09-07, signed
 * in as an entrant in a match-play tournament, Today showed a stroke-play
 * position and a to-par, and "My card" said "your score is recorded against
 * your opponent" — without naming the opponent. There was nowhere in the
 * player app to find out who you were playing or how the match stood.
 *
 * That is the wrong way round for the app's signature format. A player walking
 * to the first tee of a match wants one sentence: who, and where does it
 * stand. "Position 23, +4" is a stroke-play answer to a question nobody in a
 * match asked.
 *
 * So this turns a resolved match into that sentence, from one side. It is pure
 * and takes the resolution rather than the row, because the arithmetic of who
 * is up belongs to `resolveMatch` and a second implementation of it is how the
 * board and the player's phone would come to disagree about the same match.
 */

export interface MyMatchView {
  /** The other player's name, as the field knows them. */
  opponent: string;
  /** How it stands, in the words a golfer uses: "2 up", "3&2", "All square". */
  state: string;
  /**
   * Whether this player is ahead — true, false, or null while level.
   *
   * Three-valued on purpose. A boolean would make "all square" indistinguishable
   * from "losing", and level is the commonest state of a match.
   */
  ahead: boolean | null;
  /** Played out, conceded, or otherwise decided. */
  complete: boolean;
  /** Nothing recorded yet. Distinct from `complete: false`, which also covers
   *  a match that is under way. */
  notStarted: boolean;
}

export interface MatchSides {
  /** This player's id. */
  meId: string;
  playerAId: string;
  playerBId: string;
  /** Hole results as stored: 'A' | 'B' | 'H' | null, one per hole. */
  holes: HoleResult[];
  /** The side that conceded, if either did. Empty when the match was played. */
  forfeitedBy?: string | null;
  /** Names, by player id. */
  nameOf: (id: string) => string;
}

/**
 * How a match reads to one of its players.
 *
 * Returns null when this player is not in it, rather than guessing a side —
 * a caller that has filtered wrongly must get nothing, not a match described
 * from the wrong end.
 */
export function myMatchView(m: MatchSides): MyMatchView | null {
  const iAmA = m.meId === m.playerAId;
  const iAmB = m.meId === m.playerBId;
  if (!iAmA && !iAmB) return null;

  const opponentId = iAmA ? m.playerBId : m.playerAId;
  const opponent = m.nameOf(opponentId) || "your opponent";

  /**
   * A concession decides the match, whatever is on the card.
   *
   * Checked BEFORE the holes, because a player who concedes on the 14th is
   * often up at the time — reading the card would report them winning a match
   * they walked in from. Rule 3.2b(1): a conceded match is over, and the
   * opponent has won it.
   */
  const conceded = (m.forfeitedBy ?? "").trim();
  if (conceded) {
    const iConceded = conceded === m.meId;
    return {
      opponent,
      state: iConceded ? "Conceded" : "Won by concession",
      ahead: !iConceded,
      complete: true,
      notStarted: false,
    };
  }

  const r = resolveMatch(m.holes);
  const started = m.holes.some((h) => h !== null);
  if (!started) {
    return { opponent, state: "Not started", ahead: null, complete: false, notStarted: true };
  }

  // `lead` is A minus B, so it has to be flipped for the player on the other
  // side of it. Getting this wrong tells half the field they are winning.
  const myLead = iAmA ? r.lead : -r.lead;

  if (r.complete) {
    if (r.winner === "H") {
      return { opponent, state: "Halved", ahead: null, complete: true, notStarted: false };
    }
    // `resultText` is already the golfing form — "3&2" for a match closed out
    // early, "2 UP" for one that went to the last. Lowercased for prose, since
    // it is read in a sentence rather than printed on a board.
    const margin = r.resultText.replace("UP", "up");
    return {
      opponent,
      state: myLead > 0 ? `Won ${margin}` : `Lost ${margin}`,
      ahead: myLead > 0,
      complete: true,
      notStarted: false,
    };
  }

  if (myLead === 0) {
    return { opponent, state: "All square", ahead: null, complete: false, notStarted: false };
  }
  return {
    opponent,
    state: `${Math.abs(myLead)} ${myLead > 0 ? "up" : "down"}`,
    ahead: myLead > 0,
    complete: false,
    notStarted: false,
  };
}
