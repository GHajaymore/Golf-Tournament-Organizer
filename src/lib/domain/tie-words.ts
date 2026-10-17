import { STANDARD_COUNTBACK, STANDARD_COUNTBACK_9, type MatchTiebreakKey } from "@/lib/domain/match-tiebreak";
import { toughestN } from "@/lib/domain/types";

/**
 * EACH TIE RULE IN ONE LINE, for the "Ties" group on the face of a round
 * (2026-10-16). Ajay could not find the tiebreakers: they sat at the foot of
 * Customize, inside ~2,000px of points table and checkbox chains, on a phone,
 * a tablet and a computer alike. The review panel (docs/tiebreak-brief-
 * 2026-10-16.md) asked for one line per tie question, saying the rule in use
 * in words, with Change where there is a choice. These are those words, kept
 * apart from the screen so its tests read the same sentences.
 */

const MATCH_WORDS: Record<MatchTiebreakKey, string> = {
  halved: "stays halved",
  "last-9": "last 9",
  "last-6": "last 6",
  "last-3": "last 3",
  "last-1": "last hole",
  "toughest-6": "toughest 6 holes",
  "toughest-3": "toughest 3 holes",
  "toughest-1": "the toughest hole",
  "sudden-death": "a sudden-death play-off",
};

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** A round-robin match all square after the last hole: what happens, in words. */
export function matchTieInWords(seq: readonly MatchTiebreakKey[], holes: number): string {
  const steps = seq.filter((k) => k !== "halved");
  if (steps.length === 0) return "stays halved — each side takes the halve points";
  if (same(steps, holes === 9 ? STANDARD_COUNTBACK_9 : STANDARD_COUNTBACK)) {
    return holes === 9 ? "card countback: last 6, 3, then the last hole" : "card countback: last 9, 6, 3, then the last hole";
  }
  if (same(steps, ["sudden-death"])) return "a sudden-death play-off — you record the winner";
  return `${steps.map((k) => MATCH_WORDS[k]).join(", then ")}; still level, it stays halved`;
}

const TABLE_WORDS: Record<string, string> = {
  "head-to-head": "head-to-head",
  "most-wins": "most wins",
  "win-percentage": "winning percentage",
  "holes-won-ratio": "hole difference",
  "fewest-holes-lost": "fewest holes lost",
  "lower-handicap": "lower handicap",
};

function tableStep(key: string): string {
  const n = toughestN(key);
  if (n !== null) return n === 1 ? "the toughest hole" : `toughest ${n} holes`;
  return TABLE_WORDS[key] ?? key;
}

/**
 * Players level in the table: the order they are separated in, in words.
 * `first` is what the table ranks on before the steps, where it is not points
 * (a stroke-play round robin: "lowest net, then lowest gross").
 */
export function tableTieInWords(order: readonly string[], first = ""): string {
  if (order.length === 0) return first ? `${first}; still level, they share the place` : "players level share the place";
  if (first) return `${first}, then ${tableTieInWords(order)}`;
  const shown = order.slice(0, 2).map(tableStep).join(", then ");
  return order.length > 2 ? `${shown}, +${order.length - 2} more` : shown;
}
