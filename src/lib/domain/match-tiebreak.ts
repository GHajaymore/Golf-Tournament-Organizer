import type { HoleResult } from "./types";

/**
 * Deciding a single match that finished all square.
 *
 * Distinct from the standings tiebreakers, and the distinction matters: those
 * separate two players who are level on *points across the tournament* — head
 * to head, most wins, hole differential. This separates two players who are
 * level *in one match*, on the card in front of you.
 *
 * The app had no answer to the second question at all. A halved match was
 * simply halved, which is correct match play and wrong for every club event
 * that has to produce a winner by the prize-giving.
 *
 * The sequence is the organizer's; these are the pieces it is built from, and
 * they are the ones the rules of golf actually recommend.
 */

export type MatchTiebreakKey =
  | "halved"
  | "last-9"
  | "last-6"
  | "last-3"
  | "last-1"
  | "toughest-6"
  | "toughest-3"
  | "toughest-1"
  | "sudden-death";

/** Every key the engine understands, including ones not offered in the UI. */
export const MATCH_TIEBREAK_KEYS: MatchTiebreakKey[] = [
  "last-9",
  "last-6",
  "last-3",
  "last-1",
  "toughest-6",
  "toughest-3",
  "toughest-1",
  "sudden-death",
  "halved",
];

/**
 * The keys an organizer may actually pick.
 *
 * Sudden death was held back while nothing could record who won a play-off —
 * offering a step the app cannot complete is the same trap as listing a format
 * with no engine behind it. The organizer override in match-entry.ts is that
 * mechanism: the play-off happens on the course and its result is entered
 * against the match, so the step now completes and is offered.
 */
export const OFFERED_MATCH_TIEBREAKS: MatchTiebreakKey[] = [...MATCH_TIEBREAK_KEYS];

export const MATCH_TIEBREAK_LABELS: Record<MatchTiebreakKey, string> = {
  halved: "Leave it halved",
  "last-9": "Last 9 holes",
  "last-6": "Last 6 holes",
  "last-3": "Last 3 holes",
  "last-1": "Last hole",
  "toughest-6": "Toughest 6 holes (by stroke index)",
  "toughest-3": "Toughest 3 holes (by stroke index)",
  "toughest-1": "Toughest hole (stroke index 1)",
  "sudden-death": "Sudden death play-off",
};

export const MATCH_TIEBREAK_BLURBS: Record<MatchTiebreakKey, string> = {
  halved: "A tie stands. Correct match play, and the right answer when nothing has to be decided today.",
  "last-9": "Who won more of the back nine. The first step of the standard card countback.",
  "last-6": "Who won more of the last six.",
  "last-3": "Who won more of the last three.",
  "last-1": "Who won the 18th. The last step of the countback, and rarely decisive on its own.",
  "toughest-6": "Who won more of the six hardest holes on the card, by stroke index.",
  "toughest-3": "Who won more of the three hardest holes.",
  "toughest-1": "Who won stroke index 1 — the hardest hole on the course.",
  "sudden-death": "Played off on the course. The app records the result rather than computing it.",
};

/**
 * The countback the rules of golf actually recommend, in order.
 *
 * Last nine, then last six, then last three, then the last hole. Offered as a
 * one-click default because it is what a committee will be asked to justify,
 * and "we used the standard countback" is the answer that ends the argument.
 */
export const STANDARD_COUNTBACK: MatchTiebreakKey[] = ["last-9", "last-6", "last-3", "last-1"];

/** The same idea over nine holes, where a "last 9" is the whole round. */
export const STANDARD_COUNTBACK_9: MatchTiebreakKey[] = ["last-6", "last-3", "last-1"];

export interface MatchTiebreakOutcome {
  /** null when nothing separated them, or the step needs a human. */
  winner: "A" | "B" | null;
  /** Which step decided it. */
  decidedBy: MatchTiebreakKey | null;
  /** Whether a person has to enter the result (sudden death). */
  needsManualResult: boolean;
  /** One line an organizer can read out. */
  detail: string;
}

/** Holes counted by a step, as indexes into the round. */
function holesForStep(
  key: MatchTiebreakKey,
  holeCount: number,
  strokeIndex: number[],
): number[] | null {
  const all = Array.from({ length: holeCount }, (_, i) => i);

  const last = (n: number): number[] => all.slice(Math.max(0, holeCount - n));

  switch (key) {
    case "last-9":
      return last(9);
    case "last-6":
      return last(6);
    case "last-3":
      return last(3);
    case "last-1":
      return last(1);
    case "toughest-6":
    case "toughest-3":
    case "toughest-1": {
      const n = key === "toughest-6" ? 6 : key === "toughest-3" ? 3 : 1;
      // Ranked by the card's own stroke index, 1 being hardest. A hole with no
      // index sorts last rather than being treated as the hardest on the
      // course, which is what a missing value would otherwise mean.
      const ranked = all
        .filter((i) => Number.isFinite(strokeIndex[i]))
        .sort((a, b) => strokeIndex[a] - strokeIndex[b]);
      return ranked.length ? ranked.slice(0, n) : null;
    }
    case "sudden-death":
    case "halved":
    default:
      return null;
  }
}

/** Who won more of a given set of holes. */
function compareOn(holes: HoleResult[], indexes: number[]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const i of indexes) {
    const h = holes[i];
    if (h === "A") a += 1;
    else if (h === "B") b += 1;
  }
  return { a, b };
}

/**
 * Walk the organizer's sequence and stop at the first step that separates them.
 *
 * Applied only to a match that is genuinely level — the caller decides that.
 * A step that also ties falls through to the next, and if every step ties the
 * match stays halved, which is the honest outcome rather than an arbitrary one.
 */
export function breakMatchTie(
  holes: HoleResult[],
  strokeIndex: number[],
  sequence: MatchTiebreakKey[],
): MatchTiebreakOutcome {
  for (const key of sequence) {
    if (key === "halved") break;

    if (key === "sudden-death") {
      return {
        winner: null,
        decidedBy: "sudden-death",
        needsManualResult: true,
        detail: "All square — play off on the course, then record the winner here.",
      };
    }

    const indexes = holesForStep(key, holes.length, strokeIndex);
    // A toughest-N step on a card with no stroke index can't be computed. Skip
    // to the next step rather than inventing an order.
    if (!indexes || indexes.length === 0) continue;

    const { a, b } = compareOn(holes, indexes);
    if (a === b) continue;

    const label = MATCH_TIEBREAK_LABELS[key];
    return {
      winner: a > b ? "A" : "B",
      decidedBy: key,
      needsManualResult: false,
      detail: `${label}: ${Math.max(a, b)}–${Math.min(a, b)}.`,
    };
  }

  return {
    winner: null,
    decidedBy: null,
    needsManualResult: false,
    detail: "All square — nothing in the countback separated them.",
  };
}

/** Whether a stored sequence is usable, dropping anything unrecognised. */
export function cleanMatchTiebreakers(input: unknown): MatchTiebreakKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: MatchTiebreakKey[] = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    if (!(MATCH_TIEBREAK_KEYS as string[]).includes(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v as MatchTiebreakKey);
  }
  return out;
}

/** The default sequence for a round of this many holes. */
export function defaultCountback(holes: number): MatchTiebreakKey[] {
  return holes === 9 ? [...STANDARD_COUNTBACK_9] : [...STANDARD_COUNTBACK];
}
