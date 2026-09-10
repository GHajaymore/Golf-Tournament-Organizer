/**
 * What a league night is decided on, and what to call it.
 *
 * The weekly sheet asked one question — "is this Stableford?" — and answered
 * everything else with NET. So a round set to gross was ranked by net and
 * labelled "net strokes", while the ordinary leaderboard ranked the identical
 * round by gross.
 *
 * MEASURED, not reasoned about. On 2026-09-10 a society league week was built
 * with four cards chosen so gross and net order reverse: 76/77/78/79 off
 * handicaps of 10/12/14/16. The leaderboard read "zz-lg Player 1 leads at +4"
 * and put 76 first; `/week` put the 79 first and the 76 third, over the words
 * "Stroke Play · 18 holes · net strokes". The season table beneath it totalled
 * net as well, so the whole league was being run on a figure the round had not
 * been set to.
 *
 * `/week` is the SOCIETY's screen — it exists only for a league — so this is
 * the one product where the wrong answer is the answer people see every week.
 *
 * NOT `cardTotals`, which answers a neighbouring question: which figures to
 * PRINT on a card. Its first entry is not the ranking key — a net competition
 * prints gross first, because gross is what was written down — so ranking off
 * it would put a net league in gross order. One rule per question.
 */

/** The three ways a night is ranked. */
export type WeekBasis = "stableford" | "gross" | "net";

/**
 * Which of the three this round is scored on.
 *
 * "both" means both prizes are given, and it stays on NET here deliberately:
 * that is the figure a league table has always carried, and this change is
 * about the case that was provably wrong rather than about re-deciding one
 * that was not. Anything unrecognised lands on net for the same reason — it
 * is what every round got before this existed.
 */
export function weekBasis(scoringBasis: string | null | undefined): WeekBasis {
  const b = (scoringBasis ?? "").trim().toLowerCase();
  if (b === "stableford" || b === "modified-stableford") return "stableford";
  if (b === "gross") return "gross";
  return "net";
}

/** What the sheet calls it, in the words a league would use. */
export const WEEK_BASIS_LABEL: Record<WeekBasis, string> = {
  stableford: "Stableford points",
  gross: "gross strokes",
  net: "net strokes",
};

/** The column heading for the figure a night is decided on. */
export const WEEK_BASIS_COLUMN: Record<WeekBasis, string> = {
  stableford: "Points",
  gross: "Gross",
  net: "Net",
};

/**
 * Ranked best-first, over the three figures a night can be decided on.
 *
 * Points descend and strokes ascend, which is why this is one function rather
 * than a comparator written out at each call site — the sheet, the season
 * table and the movement column all have to agree about which way is winning.
 */
export function compareOnBasis(
  basis: WeekBasis,
  a: { gross: number; net: number; points: number },
  b: { gross: number; net: number; points: number },
): number {
  if (basis === "stableford") return b.points - a.points;
  if (basis === "gross") return a.gross - b.gross;
  // Gross breaks a net tie, which is the countback a committee reaches for
  // first and what this comparison already did.
  return a.net - b.net || a.gross - b.gross;
}

/** Whether two rows finished level on the night's own figure. */
export function levelOnBasis(
  basis: WeekBasis,
  a: { gross: number; net: number; points: number },
  b: { gross: number; net: number; points: number },
): boolean {
  if (basis === "stableford") return a.points === b.points;
  if (basis === "gross") return a.gross === b.gross;
  return a.net === b.net && a.gross === b.gross;
}

/** The number a row is ranked on, for a season total. */
export function valueOnBasis(
  basis: WeekBasis,
  row: { gross: number; net: number; points: number },
): number {
  if (basis === "stableford") return row.points;
  return basis === "gross" ? row.gross : row.net;
}

/** Which way a season total is best: points high, strokes low. */
export function directionOnBasis(basis: WeekBasis): "asc" | "desc" {
  return basis === "stableford" ? "desc" : "asc";
}
