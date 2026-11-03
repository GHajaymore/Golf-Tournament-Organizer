/**
 * A MEMBER'S SEASON, IN A NUMBER AND A WORD (Ajay, 2026-10-24: a light "My
 * season" page for the player — not a feed, no badges, no chart).
 *
 * The figures on it are never worked out here. Each tournament's place and
 * figures are read off that tournament's own board, the way its final report
 * reads them (`reportStandings` in `services/event-report.ts`), and this file
 * only decides three small things a season adds on top:
 *
 *   which tournaments are THIS season   `inSeason` — the club's own window
 *                                       (`club-season.ts`), on the club's day
 *   what the member's entry is called   `entryWords` — never "not entered" for
 *                                       somebody waiting for a place
 *   the season's best figures           `seasonBests` — the lowest gross and
 *                                       net and the most points, compared only
 *                                       over the same number of holes
 */
import { seasonOf, type Season, type SeasonWindow } from "./club-season";

/** How a member stands in one tournament's field. The `Player.status` values, as a season reads them. */
export type SeasonEntry = "confirmed" | "waitlisted" | "pending" | "withdrawn" | "disqualified";

/** Which status wins when one address holds two rows in one tournament — a data oddity, said once. */
const ENTRY_RANK: Record<SeasonEntry, number> = { confirmed: 5, withdrawn: 4, disqualified: 3, pending: 2, waitlisted: 1 };

export function asEntry(status: string): SeasonEntry | null {
  return status in ENTRY_RANK ? (status as SeasonEntry) : null;
}

/** The entry a member holds in a tournament, given every row their address has in it. */
export function strongestEntry(statuses: readonly string[]): SeasonEntry | null {
  let best: SeasonEntry | null = null;
  for (const s of statuses) {
    const e = asEntry(s);
    if (e && (!best || ENTRY_RANK[e] > ENTRY_RANK[best])) best = e;
  }
  return best;
}

/** A tournament they held a place in — what "tournaments" counts. Waiting for one is not having one. */
export function heldAPlace(entry: SeasonEntry): boolean {
  return entry === "confirmed" || entry === "withdrawn" || entry === "disqualified";
}

/**
 * The words for an entry that has no result to show. Never "not entered" for
 * somebody with a row in the field — the rule `verify-player-states.mjs` holds
 * the rest of the player app to.
 */
export function entryWords(entry: SeasonEntry, roundsPlayed: number, completed: boolean): string {
  switch (entry) {
    case "waitlisted":
      return "On the waiting list";
    case "pending":
      return "Awaiting approval";
    case "withdrawn":
      return "Withdrew";
    case "disqualified":
      return "Disqualified";
    case "confirmed":
      // Over and nothing returned is not "yet": the board says the same, a row with no card.
      if (roundsPlayed === 0) return completed ? "Entered · no card returned" : "Entered · nothing played yet";
      return "Entered";
  }
}

/**
 * Whether a tournament belongs to this season. An undated one belongs to none —
 * `seasonOf` says why: putting it in "this season" would be the app inventing
 * a fact.
 */
export function inSeason(startOn: string, season: Season | null, window: SeasonWindow): boolean {
  if (!season) return false;
  return seasonOf(startOn, window)?.key === season.key;
}

/** One complete card's figures, as its board printed them. */
export interface CountedResult {
  holes: number;
  gross: number | null;
  net: number | null;
  points: number | null;
}

export interface SeasonBest {
  label: "Best gross" | "Best net" | "Best points";
  value: number;
}

/**
 * THE SEASON'S BEST, compared only like with like.
 *
 * A nine is not compared with an eighteen, so the figures are taken over one
 * hole count: eighteen where the member has any, otherwise the longest they
 * have. Lowest gross and net; most points. A figure the board did not print
 * (`null`) is not a figure. The rows handed in are already the ones that hold
 * a place on a single-round board — the caller's half of "like with like".
 */
export function seasonBests(results: readonly CountedResult[]): { holes: number; bests: SeasonBest[] } {
  if (results.length === 0) return { holes: 0, bests: [] };
  const counts = new Set(results.map((r) => r.holes));
  const holes = counts.has(18) ? 18 : Math.max(...counts);
  const over = results.filter((r) => r.holes === holes);
  const low = (pick: (r: CountedResult) => number | null) => {
    const v = over.map(pick).filter((n): n is number => n !== null && Number.isFinite(n));
    return v.length ? Math.min(...v) : null;
  };
  const high = (pick: (r: CountedResult) => number | null) => {
    const v = over.map(pick).filter((n): n is number => n !== null && Number.isFinite(n));
    return v.length ? Math.max(...v) : null;
  };
  const gross = low((r) => r.gross);
  const net = low((r) => r.net);
  const points = high((r) => r.points);
  const bests: SeasonBest[] = [];
  if (gross !== null) bests.push({ label: "Best gross", value: gross });
  if (net !== null) bests.push({ label: "Best net", value: net });
  if (points !== null) bests.push({ label: "Best points", value: points });
  return { holes, bests };
}

/** "1 tournament", "6 tournaments" — a number and a word. */
export function countWord(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
