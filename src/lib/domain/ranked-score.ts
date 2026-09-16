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
   * WHETHER THERE IS A PAR TO BE UNDER.
   *
   * `toPar` is `gross - parThru`, so a round with no course card behind it
   * returns the GROSS score unchanged — and this reader then printed "+71" for
   * a 71, in the accent colour, under a heading that says the number is a
   * to-par.
   *
   * The organizer's `LeaderboardTable` was taught to print "—" for that on
   * 2026-09-09, off a real tournament whose venue had been set by ticking it in
   * the course library, which attaches the course for the venue picker and
   * leaves the ids everything actually scores against null. The fix went to the
   * table that was reported and stopped there. This reader — the one behind the
   * player's own Board tab, the Today card and the PUBLIC share link — was
   * never given the question to ask, so the console said "—" and the board a
   * spectator opens said "+71" about the same round.
   *
   * Optional, and `undefined` reads as known: every existing caller passes a
   * row that has it, and a caller written later against a source that genuinely
   * has par is not made to prove it.
   */
  parKnown?: boolean;
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

/**
 * ONE CELL, FOR EVERY TABLE THAT PRINTS A TO-PAR.
 *
 * `toPar` is `gross - parThru`, so a round with no course card returns the
 * GROSS — and a column headed "To par" then carries a 71 as "+71". The
 * organizer's board learned to refuse that in September; the exported CSV, the
 * player's board and the scoring screen did not, so the console and the share
 * link said different things about the same round.
 *
 * `placeholder` because the tables already use different dashes and changing
 * one would be a copy change with nothing behind it.
 *
 * LEVEL PAR IS A REAL ANSWER and comes back as "E". The question is whether par
 * is known, never whether the number is falsy — a rule written the other way
 * swallows the round somebody shot exactly to par.
 */
export function toParCell(
  row: { toPar: number; parKnown?: boolean },
  placeholder = "—",
): string {
  return row.parKnown === false ? placeholder : toParText(row.toPar);
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
  // Stableford points are counted off the card and need no par of their own,
  // so only the to-par branch asks. A missing figure is a smaller failure than
  // a wrong one — and LEVEL PAR IS A REAL ANSWER, so the question is whether
  // par is known, never whether the number is falsy.
  if (!opts.isStableford && row.parKnown === false) return { text: "–", label };
  return {
    text: opts.isStableford ? String(row.points) : toParText(row.toPar),
    label,
  };
}
