import { lookupFormat } from "@/lib/formats";
import { countbackCompare } from "./stroke-countback";

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
 * THE FORMAT GIVES THE UNIT; THE BASIS GIVES THE ALLOCATION. That is how a
 * golf club runs it, and it is Ajay's ruling of 2026-09-20: a Stableford
 * competition is decided on POINTS, and gross/net only says whether handicap
 * strokes are applied while computing them. So the two settings were never in
 * conflict — this function was simply reading one of them.
 *
 * It asked the BASIS alone, so eight weeks of the seeded club's Thursday
 * league — every one `format: "Stableford"`, `scoringBasis: "net"` — were
 * ranked on net strokes under a heading reading
 *
 *     Stableford · 18 holes · net strokes
 *
 * which names the competition and then says the night is decided on something
 * else, on one line.
 *
 * WHAT IT DOES NOT DO IS MOVE ANYBODY. Measured across all four played weeks
 * before the change: points and net produce the identical order, every week,
 * because the two can only diverge on a hole whose points FLOOR at zero and no
 * card in that fixture has one — the 99 and the 84 on week 3 both net 75 and
 * both score 32. So this is a correctness and labelling fix rather than a
 * re-decision, and the test that proves it works has to build a card with a
 * wipe on it. See `stableford-ranks-on-points.audit.test.ts`.
 *
 * THE FORMAT IS REQUIRED, not optional. Ten callers each had the stage in hand
 * and passed only the basis; an optional argument would have left all ten free
 * to keep forgetting, which is the shape `cardForStage` was in when five
 * boards scored a round against the wrong course (#521). A parameter you must
 * pass cannot be forgotten.
 *
 * "both" means both prizes are given, and it stays on NET here deliberately:
 * that is the figure a league table has always carried. Anything unrecognised
 * lands on net for the same reason — it is what every round got before this
 * existed.
 */
export function weekBasis(
  scoringBasis: string | null | undefined,
  format: string | null | undefined,
): WeekBasis {
  // The format first: a Stableford round is decided on points whatever the
  // basis says, and the basis then decides whether those points are computed
  // off net or off scratch.
  const engine = lookupFormat((format ?? "").trim())?.engine;
  if (engine === "stableford" || engine === "modified-stableford") return "stableford";

  const b = (scoringBasis ?? "").trim().toLowerCase();
  // A basis naming a UNIT rather than an allocation is the older way of saying
  // the same thing, and is still live on rows written before the format
  // carried it. Kept, so nothing already stored changes meaning.
  if (b === "stableford" || b === "modified-stableford") return "stableford";
  if (b === "gross") return "gross";
  return "net";
}

/**
 * Whether this round is a Stableford one — the same question `weekBasis` asks,
 * for the screens that want a boolean rather than the basis.
 *
 * Eight of them asked `scoringBasis === "stableford"` directly: the dashboard,
 * both console boards, the printed sheet, the player's board and Today. Every
 * one answered FALSE for the seeded club's league, whose weeks are
 * `format: "Stableford"` with `scoringBasis: "net"` — so a Stableford
 * competition was given stroke columns and stroke sentences.
 *
 * That was survivable while the RANKING agreed with them and wrong in the same
 * direction. It stopped being survivable the moment the ranking moved to
 * points: a board ordered on points under a column headed Net is a worse
 * screen than the one we started with. So this exists, and the guard in
 * `audit-guards.test.ts` keeps the direct comparison from coming back.
 */
export function isStablefordRound(
  scoringBasis: string | null | undefined,
  format: string | null | undefined,
): boolean {
  return weekBasis(scoringBasis, format) === "stableford";
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

/**
 * A NIGHT'S FIGURES PLUS THE CARD A COUNTBACK READS.
 *
 * `cbHoles` is this round's per-hole card on the night's own basis — net for a
 * net comp, points for Stableford, gross for gross — exactly as `holesByStage`
 * on the stroke aggregate holds it. Empty when there is no card to count back
 * over, which the countback reads as "cannot separate".
 */
export interface NightRow {
  gross: number;
  net: number;
  points: number;
  cbHoles: (number | null)[];
}

/** The figure a night is ranked on. */
export function nightFigureOf(basis: WeekBasis, r: { gross: number; net: number; points: number }): number {
  return basis === "stableford" ? r.points : basis === "gross" ? r.gross : r.net;
}

/**
 * Rank two rows for a league NIGHT, best first, breaking a tie by countback.
 *
 * This is `compareOnBasis` with the LEADERBOARD's tiebreak in place of gross.
 * Breaking a net tie on gross hands the night to exactly the low handicapper a
 * countback exists to stop, and disagreed with the board and `/live`, which
 * break the same tie on the last nine (then six, three, one) of the night's own
 * figure — see `cbCard` in `tournament.ts`. The primary figure is unchanged;
 * only the tiebreak moves, onto the shared `countbackCompare`, so the sheet and
 * the board cannot order two level players differently.
 */
export function compareNight(basis: WeekBasis, holeCount: number, a: NightRow, b: NightRow): number {
  const fa = nightFigureOf(basis, a);
  const fb = nightFigureOf(basis, b);
  const primary = basis === "stableford" ? fb - fa : fa - fb;
  if (primary !== 0) return primary;
  return countbackCompare(
    { playerId: "", total: 0, holes: a.cbHoles },
    { playerId: "", total: 0, holes: b.cbHoles },
    holeCount,
    basis === "stableford",
  );
}

/**
 * Whether two rows are genuinely level on the night — the same figure AND a
 * countback that cannot separate them, the same tie the board shows. Used to
 * assign shared places, so the places match the order `compareNight` produced.
 */
export function nightLevel(basis: WeekBasis, holeCount: number, a: NightRow, b: NightRow): boolean {
  return nightFigureOf(basis, a) === nightFigureOf(basis, b) && compareNight(basis, holeCount, a, b) === 0;
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
