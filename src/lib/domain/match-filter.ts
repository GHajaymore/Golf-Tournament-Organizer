/**
 * Finding one match in a draw.
 *
 * A round-robin of eight flights is 48 matches; a big member-guest is more.
 * The picker listed all of them in draw order with no way to narrow it, which
 * is fine on the first morning and useless afterwards — by the time it matters
 * the organizer is not looking for "a match", they are looking for the eleven
 * cards still waiting on them, or for Halloran's, because Halloran is standing
 * at the desk.
 *
 * Kept pure so the filtering can be tested without rendering anything, and so
 * the counts on the chips and the rows in the list cannot disagree — they are
 * the same function over the same input.
 */

/** What a match is doing, as one word to filter on. */
export type MatchStatusKey = "awaiting" | "final" | "disputed" | "live" | "not-started";

export interface MatchState {
  /** Every hole decided. */
  complete: boolean;
  /** At least one hole written down. */
  started: boolean;
  /** The stored scoreStatus: confirmed | auto-confirmed | disputed | "". */
  confirmStatus: string;
}

/**
 * The single reading of "what is this match doing".
 *
 * One function rather than one per screen. The list, the chip counts and the
 * bulk action all have to agree about which matches are awaiting approval, and
 * three implementations of that is how a "approve all 11" button comes to
 * approve nine.
 */
export function matchStatusKey({ complete, started, confirmStatus }: MatchState): MatchStatusKey {
  if (complete) {
    if (confirmStatus === "disputed") return "disputed";
    if (confirmStatus === "confirmed" || confirmStatus === "auto-confirmed") return "final";
    return "awaiting";
  }
  return started ? "live" : "not-started";
}

export const STATUS_LABEL: Record<MatchStatusKey, string> = {
  awaiting: "Awaiting approval",
  final: "Final",
  disputed: "Disputed",
  live: "Live",
  "not-started": "Not started",
};

/** Chip order: what needs doing first, what is finished last. */
export const STATUS_ORDER: MatchStatusKey[] = ["awaiting", "disputed", "live", "not-started", "final"];

export interface FilterableMatch {
  id: string;
  aName: string;
  bName: string;
  groupName: string;
  round: number;
  status: MatchStatusKey;
}

export interface MatchFilter {
  /** Free text: either player, or the flight. */
  query: string;
  /** null means every status. */
  status: MatchStatusKey | null;
}

export const EMPTY_FILTER: MatchFilter = { query: "", status: null };

/**
 * Whether a filter is doing anything.
 *
 * Used to decide whether to offer "clear" — an always-visible clear button on
 * an untouched filter is a control that does nothing, and the picker has
 * little enough room as it is.
 */
export function filterActive(filter: MatchFilter): boolean {
  return filter.query.trim() !== "" || filter.status !== null;
}

/**
 * Matches passing the filter, in the order they were given.
 *
 * Draw order is preserved deliberately. An organizer knows their draw runs
 * flight by flight and round by round, and re-sorting by relevance would move
 * a match they were about to tap.
 */
export function filterMatches<T extends FilterableMatch>(rows: T[], filter: MatchFilter): T[] {
  const q = filter.query.trim().toLowerCase();
  return rows.filter((m) => {
    if (filter.status !== null && m.status !== filter.status) return false;
    if (!q) return true;
    // Flight and round included because "flight 3" and "round 2" are how an
    // organizer names a block of the draw out loud.
    const haystack = `${m.aName} ${m.bName} ${m.groupName} round ${m.round}`.toLowerCase();
    return haystack.includes(q);
  });
}

/** How many matches sit in each status, for the chip labels. */
export function statusCounts(rows: FilterableMatch[]): Record<MatchStatusKey, number> {
  const counts: Record<MatchStatusKey, number> = {
    awaiting: 0,
    final: 0,
    disputed: 0,
    live: 0,
    "not-started": 0,
  };
  for (const m of rows) counts[m.status] += 1;
  return counts;
}

/**
 * How many rows to render before offering "show the rest".
 *
 * The picker used to be a nested scroller with a fixed height, which on a
 * phone meant a swipe landing on it scrolled 48 matches instead of the page —
 * the score entry panel below was unreachable until your thumb found the
 * margin beside the list. Rendering a capped number and letting the page
 * scroll normally removes the trap rather than tuning it.
 */
export const VISIBLE_CAP = 12;

export interface VisibleMatches<T> {
  rows: T[];
  /** How many the cap is holding back. 0 when everything is shown. */
  hidden: number;
}

export function visibleMatches<T>(rows: T[], showAll: boolean): VisibleMatches<T> {
  if (showAll || rows.length <= VISIBLE_CAP) return { rows, hidden: 0 };
  return { rows: rows.slice(0, VISIBLE_CAP), hidden: rows.length - VISIBLE_CAP };
}
