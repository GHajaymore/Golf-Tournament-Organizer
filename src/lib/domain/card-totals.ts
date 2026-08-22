import { lookupFormat } from "../formats";

/**
 * Which totals a card shows, from how the round is actually scored.
 *
 * Every stroke card in this app showed the same four figures — gross, net, to
 * par and Stableford — whatever the round was played for. So a gross medal
 * displayed a Net and a Stableford total the tournament will never read, and a
 * Stableford round gave "to par" equal billing with the points it is won on.
 * Four numbers of which two are noise is worse than two: on a phone in the sun
 * the reader has to work out which one is theirs.
 *
 * Derived, never stored. The round already says how it is scored; a second
 * setting for what the card displays would be a second reader of the same
 * rule, and the first time somebody changed the basis the card would go on
 * showing what the old one wanted.
 *
 * `gross` is in every list. It is what the player wrote in the boxes, it is
 * what every other figure is computed from, and a card that will not show you
 * the number you just entered is not a card.
 */

/** The figures a card can report, in the order they should be read. */
export type CardTotal = "gross" | "net" | "toPar" | "points";

const BY_BASIS: Record<string, CardTotal[]> = {
  // A gross medal is won on strokes, and to-par is how a scratch field talks
  // about them. No handicap is involved, so a net column would be a column of
  // the same numbers.
  gross: ["gross", "toPar"],
  // A net competition is won on net, but the gross stays: it is what was
  // written down, and it is what a query is settled against.
  net: ["gross", "net"],
  // "Both" means both prizes are given, so both are shown, and to-par with
  // them because the gross prize is read that way.
  both: ["gross", "net", "toPar"],
  // Points first. A Stableford is won on the highest points, and putting
  // strokes ahead of them invites reading the wrong number as the result.
  stableford: ["points", "gross"],
};

/**
 * Engines that decide the card themselves, whatever the basis says.
 *
 * The format and the basis are two settings that can contradict each other,
 * and one of them is a fact about the game while the other is a stored string.
 * A Modified Stableford round whose basis still reads "gross" — because the
 * format was changed after the basis was set, which is the ordinary way this
 * happens — is still won on points: Rule 21.1 says the winner is the player
 * with the most points, and no committee setting changes that. Showing it
 * strokes-first would put the losing number where the result goes.
 *
 * So the standard wins the conflict. The basis still chooses among the
 * figures the format leaves open; it cannot overrule what the format IS.
 */
const ENGINE_TOTALS: Record<string, CardTotal[]> = {
  stableford: ["points", "gross"],
  "modified-stableford": ["points", "gross"],
};

/**
 * The totals for a round, in reading order.
 *
 * `format` wins where the two disagree — see `ENGINE_TOTALS`. Optional, so a
 * caller that only knows the basis still gets a coherent card.
 *
 * An unrecognised basis falls back to gross and to-par rather than to
 * everything: a card should not start claiming a net figure for a round whose
 * scoring nobody here recognises.
 */
export function cardTotals(scoringBasis: string, format?: string): CardTotal[] {
  const engine = format ? lookupFormat(format)?.engine ?? "" : "";
  return ENGINE_TOTALS[engine] ?? BY_BASIS[scoringBasis.trim().toLowerCase()] ?? BY_BASIS.gross;
}

/** The heading each figure is printed under. */
export const TOTAL_LABEL: Record<CardTotal, string> = {
  gross: "Gross",
  net: "Net",
  toPar: "To par",
  points: "Stableford",
};
