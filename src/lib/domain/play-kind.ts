/**
 * WHAT THIS ONE IS CALLED — chosen per tournament, not per club.
 *
 * Ajay, 2026-09-19: "any golf play is a tournament including outing, charity,
 * league, etc.", and then "can we have an option at tournament level?" A club
 * runs a championship in June, a charity scramble in July and a roll-up every
 * Tuesday, so one word for all three is wrong however carefully it is chosen —
 * and a club-wide setting would make the championship and the roll-up share a
 * name again, one level up.
 *
 * `tournament` is the default and the fallback, which is what every row that
 * has never been asked already is.
 *
 * THE MODEL DOES NOT CHANGE. All of these are one Event with rounds in it —
 * the same draw, the same cards, the same money. This is the WORD a screen
 * uses, nothing else, and no rule anywhere may branch on it: the moment
 * something scores a "charity day" differently from a "medal", a club that
 * picked the wrong word gets the wrong golf.
 *
 * The one thing that is not on this list is a casual round, which is not an
 * organized competition at all and is deliberately kept out of a club's
 * fixtures, its history and its seasons.
 */

export const PLAY_KINDS = [
  { key: "tournament", label: "Tournament", result: "Tournament result" },
  { key: "competition", label: "Competition", result: "Competition result" },
  { key: "outing", label: "Outing", result: "Outing result" },
  { key: "charity", label: "Charity day", result: "Charity day result" },
  { key: "league", label: "League", result: "League result" },
  { key: "championship", label: "Championship", result: "Championship result" },
  { key: "medal", label: "Medal", result: "Medal result" },
  { key: "society", label: "Society day", result: "Society day result" },
  { key: "rollup", label: "Roll-up", result: "Roll-up result" },
] as const;

export type PlayKind = (typeof PLAY_KINDS)[number]["key"];

const BY_KEY = new Map(PLAY_KINDS.map((k) => [k.key as string, k]));

/** True when a stored value is one this app offers. */
export function isPlayKind(v: string): v is PlayKind {
  return BY_KEY.has(v);
}

/**
 * The word for one of these, in the middle of a sentence: "this outing".
 *
 * Falls back to "tournament" rather than echoing an unknown value, because
 * this goes into copy a member reads — an unrecognised key would print itself
 * into the middle of a sentence.
 */
export function playNoun(kind: string): string {
  return (BY_KEY.get(kind)?.label ?? "Tournament").toLowerCase();
}

/** The same word as a label: "Outing". */
export function playLabel(kind: string): string {
  return BY_KEY.get(kind)?.label ?? "Tournament";
}

/** The heading over the day's results: "Outing result". */
export function resultHeading(kind: string): string {
  return BY_KEY.get(kind)?.result ?? "Tournament result";
}
