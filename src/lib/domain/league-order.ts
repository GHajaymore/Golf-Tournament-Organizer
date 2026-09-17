import type { TiebreakerKey } from "./types";

/**
 * WHERE TWO CLUBS LEVEL ON POINTS FINISH, DECIDED BY THE COMMITTEE'S OWN
 * CHAIN RATHER THAN BY THE ALPHABET.
 *
 * The tournament already holds one — `Event.tiebreakers`, set on Scoring &
 * rules, and `tiebreakerCompare` applies it to PLAYERS. The league table was
 * written without it and fell back to the club's name, so a four-way tie at
 * the top of a twelve-club league seeded the play-offs alphabetically. A club
 * that wins its meetings and a club that does not are not separated by being
 * called Ashridge.
 *
 * NOT EVERY KEY MEANS SOMETHING TO A CLUB, and the ones that do not decide
 * NOTHING rather than being reinterpreted:
 *
 *   head-to-head        the meeting between these two clubs, if they have met
 *   most-wins           meetings won outright
 *   win-percentage      meetings won as a share of meetings played
 *   holes-won-ratio     holes won minus holes lost, across every pairing
 *   fewest-holes-lost   the defensive twin of the above
 *   toughest-N          a countback on ONE player's card; a club fields
 *                       twelve, so there is no such record to compare
 *   lower-handicap      a club has no handicap
 *
 * Skipping is the same behaviour the player chain already has for a countback
 * with no stroke index: the key decides nothing and the next one is asked.
 * Pure — ids, numbers and the chain in, an ordering out.
 */

export interface ClubRecord {
  clubId: string;
  name: string;
  points: number;
  played: number;
  /** Meetings won outright. A halved meeting counts to neither side. */
  won: number;
  holesWon: number;
  holesLost: number;
}

/**
 * The meetings, as "who beat whom" — for head-to-head.
 *
 * Keyed club id to club id, worth 1 for a win, -1 for a loss and 0 for a
 * halved meeting. Two clubs who never met is an absence, and absence is what
 * makes head-to-head decide nothing.
 */
export type HeadToHead = Map<string, Map<string, number>>;

/** Whether this tiebreaker says anything about a club at all. */
export function meansSomethingForAClub(key: TiebreakerKey): boolean {
  return (
    key === "head-to-head" ||
    key === "most-wins" ||
    key === "win-percentage" ||
    key === "holes-won-ratio" ||
    key === "fewest-holes-lost"
  );
}

function compareOn(key: TiebreakerKey, a: ClubRecord, b: ClubRecord, h2h: HeadToHead): number {
  switch (key) {
    case "head-to-head":
      // Their meeting, from A's side: 1 beat, -1 lost, 0 halved or never met.
      return -(h2h.get(a.clubId)?.get(b.clubId) ?? 0);
    case "most-wins":
      return b.won - a.won;
    case "win-percentage": {
      const wa = a.played > 0 ? a.won / a.played : 0;
      const wb = b.played > 0 ? b.won / b.played : 0;
      return wb - wa;
    }
    case "holes-won-ratio":
      return b.holesWon - b.holesLost - (a.holesWon - a.holesLost);
    case "fewest-holes-lost":
      return a.holesLost - b.holesLost;
    default:
      // A countback or a handicap: nothing about a club to compare.
      return 0;
  }
}

/**
 * The league table's order: points, then the committee's chain, then the name.
 *
 * The name stays as the LAST resort, because two clubs the chain cannot
 * separate still have to be listed in some order and a stable one is kinder
 * than an arbitrary one. What changed is that it is no longer the FIRST thing
 * asked after the points.
 */
export function orderClubs(
  rows: readonly ClubRecord[],
  chain: readonly TiebreakerKey[],
  h2h: HeadToHead,
): ClubRecord[] {
  const useful = chain.filter(meansSomethingForAClub);
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (const key of useful) {
      const d = compareOn(key, a, b, h2h);
      if (d !== 0) return d;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * What the screen says decided the order, in the committee's own words.
 *
 * Only the keys that can actually separate two clubs, so a league whose chain
 * is all countbacks is told the truth: nothing after the points.
 */
export function clubOrderNote(chain: readonly TiebreakerKey[], label: (k: TiebreakerKey) => string): string {
  const useful = chain.filter(meansSomethingForAClub);
  if (useful.length === 0) return "Ranked on points. Clubs level on points are listed by name.";
  return `Ranked on points, then ${useful.map(label).join(", then ").toLowerCase()}, then by name.`;
}
