import { toParText } from "./index";

/**
 * The one number a player is RANKED on, and what to call it.
 *
 * The same board legitimately shows three different things depending on the
 * round — strokes to par, Stableford points, match points — and the choice
 * between them was written out wherever somebody needed it. Three copies at
 * the last count: twice inside `PlayerLeaderboard` and once in the player's
 * own Today card.
 *
 * That duplication is not a tidiness complaint, it is the cause of a shipped
 * bug. The two copies inside `PlayerLeaderboard` disagreed about when a score
 * exists at all, so a match-play board printed a dash for every player's
 * points except your own — a board headed "Ranked by match points", sorted by
 * match points, with no match points on it. And Today printed a to-par over a
 * match-play round, so one player's own two screens showed "4" and "+4" for
 * the same tournament: two different statistics that look alike.
 *
 * One rule, one reader.
 */

export interface RankedRow {
  /** Match points, preformatted — "10.5". Empty on a stroke row. */
  pts: string;
  /** Stableford points. */
  points: number;
  toPar: number;
  thru: number;
  /** Holes this row's own counted cards cover. */
  holesOwed: number;
  /**
   * Whether this row has a RESULT yet.
   *
   * Not `thru > 0`. A match-play round keeps its results on the matches, so
   * `thru` is nought for everybody in one however many matches they have won.
   */
  started: boolean;
}

export interface RankedScore {
  /** Ready to print. A dash where there is nothing to report. */
  text: string;
  /** What the number is: "Match points", "Thru 14", "Final". */
  label: string;
}

export function rankedScore(
  row: RankedRow,
  opts: { isStroke: boolean; isStableford?: boolean },
): RankedScore {
  if (!row.started) return { text: "–", label: "Not started" };

  if (!opts.isStroke) {
    // A match round is decided on match points, whatever stroke cards happen
    // to exist alongside it.
    return { text: row.pts || "–", label: "Match points" };
  }

  /**
   * "F" is a claim about this player's own round, not about eighteen holes.
   *
   * Measured against what their counted cards cover: a round robin puts three
   * matches inside one round, so eighteen holes returned is a third of it, and
   * calling that "F" tells somebody still on the course they have finished.
   */
  const label = row.holesOwed > 0 && row.thru >= row.holesOwed ? "Final" : `Thru ${row.thru}`;
  return {
    text: opts.isStableford ? String(row.points) : toParText(row.toPar),
    label,
  };
}
