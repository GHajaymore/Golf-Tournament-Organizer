/**
 * Who won a tournament, and why the app will not decide it alone.
 *
 * The club's permanent record — the board in the hall with names going back
 * decades — is the one thing in this app that must never change by itself. Two
 * separate reasons, and either alone would settle it.
 *
 * **A derived board rewrites history.** Standings are computed from the cards
 * every time they are drawn. Fix a scoring defect and every past tournament is
 * silently re-decided: team matches started pricing off Course Handicaps rather
 * than the roster index on 2026-08-22, which is exactly the kind of correction
 * a club wants going forward and never wants applied to the name already
 * engraved on a trophy. This is the same problem the per-round handicap freeze
 * solved, one level up.
 *
 * **And the winner is the committee's to declare.** Under the Rules the
 * Committee decides the result: a countback, a disqualification under Rule 1.2,
 * a tie settled by a play-off nobody entered into the app. A table cannot know
 * any of that. An honours board asserting the top row won is asserting
 * something nobody decided.
 *
 * So this SUGGESTS from the standings and refuses where it cannot see clearly.
 * A committee confirms, and the confirmed entry is the record.
 */

/** A finishing position, from whichever board the tournament was scored on. */
export interface FinishingPosition {
  playerId: string;
  name: string;
  /** 1-based. Players who cannot be ranked are left out entirely. */
  rank: number;
}

/** Why the app will not name a winner on its own. */
export type NoChampionReason =
  | "not-completed"
  | "no-results"
  | "tied"
  | "unconfirmed";

export type ChampionSuggestion =
  | { ok: true; playerId: string; name: string; runnersUp: FinishingPosition[] }
  | { ok: false; reason: NoChampionReason; tied: FinishingPosition[] };

/** What each refusal means, in the words a committee needs. */
export const CHAMPION_REFUSAL: Record<NoChampionReason, string> = {
  "not-completed":
    "This tournament hasn't finished. A winner goes on the board when the club says the tournament is over.",
  "no-results": "No ranked results yet — nobody can be named from an empty board.",
  tied: "Two or more players finished level. The committee decides this one — a countback, a play-off, or a shared title.",
  unconfirmed: "Nobody has confirmed this result yet.",
};

/**
 * The player the standings point at, or the reason they do not point cleanly.
 *
 * A tie at the top is REFUSED rather than broken. The tiebreakers this app
 * applies are the ones a committee configured for scoring; the ones that decide
 * a championship — a play-off, a countback the committee chose on the day, a
 * shared title — are not in the data. Picking the first of two players sorted
 * equal would be the app inventing a champion, and on a board that lasts
 * decades that is the worst possible place to guess.
 */
export function suggestChampion(input: {
  completed: boolean;
  positions: readonly FinishingPosition[];
}): ChampionSuggestion {
  if (!input.completed) return { ok: false, reason: "not-completed", tied: [] };

  const ranked = input.positions.filter((p) => Number.isFinite(p.rank) && p.rank > 0);
  if (ranked.length === 0) return { ok: false, reason: "no-results", tied: [] };

  const top = Math.min(...ranked.map((p) => p.rank));
  const leaders = ranked.filter((p) => p.rank === top);

  if (leaders.length > 1) {
    return { ok: false, reason: "tied", tied: leaders };
  }

  // The next two places, for the board's "and then" line. Sorted by rank and
  // then by name so a shared second is stable rather than however the query
  // happened to return them.
  const runnersUp = ranked
    .filter((p) => p.rank > top)
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, 2);

  return { ok: true, playerId: leaders[0].playerId, name: leaders[0].name, runnersUp };
}

/** One line on the board: a tournament, a year, and whose name is on it. */
export interface HonoursEntry {
  eventId: string;
  eventName: string;
  /** As the club wrote it — free text, because "May 14–16, 2026" is a date
   *  range and "Winter 2025/26" is a season. */
  dates: string;
  /** The year the board sorts and groups by. 0 when the dates say nothing. */
  year: number;
  championName: string;
  /** Who confirmed it, so "says who?" has an answer years later. */
  confirmedBy: string;
}

/**
 * The year a tournament belongs to on the board.
 *
 * Read out of the free-text dates rather than from `completedAt`: a club
 * finishing its 2025 winter league in January 2026 has run a 2025 competition,
 * and the board it hangs in the hall says 2025. Falls back to the completion
 * year, and then to nothing at all rather than to a guess.
 */
export function honoursYear(dates: string, completedAt?: Date | null): number {
  const found = dates.match(/\b(19|20)\d{2}\b/g);
  if (found && found.length > 0) {
    // The LAST year mentioned: "Winter 2025/26" is decided in 2026, and a
    // range like "Dec 2025 – Jan 2026" ends in the year it was won.
    return Number(found[found.length - 1]);
  }
  if (completedAt) return completedAt.getFullYear();
  return 0;
}

/**
 * The board, newest first, grouped by year.
 *
 * Entries with no year sit together at the end under their own heading rather
 * than being dropped or filed under a year nobody chose.
 */
export function honoursByYear(entries: readonly HonoursEntry[]): Array<{ year: number; entries: HonoursEntry[] }> {
  const byYear = new Map<number, HonoursEntry[]>();
  for (const entry of entries) {
    const list = byYear.get(entry.year) ?? [];
    list.push(entry);
    byYear.set(entry.year, list);
  }
  return [...byYear.entries()]
    // Newest first, and the undated group (0) always last however it sorts.
    .sort((a, b) => (a[0] === 0 ? 1 : b[0] === 0 ? -1 : b[0] - a[0]))
    .map(([year, list]) => ({
      year,
      entries: list.sort((x, y) => x.eventName.localeCompare(y.eventName)),
    }));
}
