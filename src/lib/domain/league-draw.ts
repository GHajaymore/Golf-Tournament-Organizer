import { roundRobinSchedule } from "./schedule";

/**
 * WHO PLAYS WHOM IN A LEAGUE WEEK.
 *
 * Two levels, and the generic team draw knows neither. `generateTeamMatches`
 * plays every side in a round against every other — right for a four-team
 * member-guest, and 2,556 matches for a twelve-club league week with six pairs
 * a club, including a club's pairs playing each other. So a league week is
 * drawn here instead:
 *
 *   1. THE CLUBS meet on a round-robin rotation across the weeks — the
 *      standard circle method, so N clubs meet everybody once in N-1 weeks
 *      (N weeks with a bye when N is odd), and a longer season goes round
 *      again in the same order.
 *   2. INSIDE A MEETING the pairs meet in the order the clubs listed them —
 *      first pair against first pair. That is the convention club software
 *      uses and what a captain means by "our top pair".
 *
 * Pure: ids in, pairings out.
 */

export interface LeagueWeek {
  /** The meetings this week, as [clubA, clubB]. */
  meetings: [string, string][];
  /** The club sitting out, when the league has an odd number. */
  bye: string | null;
}

/**
 * The meetings for one week of the rotation.
 *
 * `week` counts from zero. It wraps, so week N-1 of an N-club league (even N)
 * is week 0 again — the second time round.
 */
export function leagueWeekMeetings(clubIds: readonly string[], week: number): LeagueWeek {
  if (clubIds.length < 2) return { meetings: [], bye: clubIds[0] ?? null };
  const schedule = roundRobinSchedule([...clubIds]);
  const weeks = Math.max(...schedule.map((p) => p.round));
  const round = (((week % weeks) + weeks) % weeks) + 1;
  const meetings = schedule
    .filter((p) => p.round === round)
    .map((p): [string, string] => [p.aId, p.bId]);
  const playing = new Set(meetings.flat());
  const bye = clubIds.find((c) => !playing.has(c)) ?? null;
  return { meetings, bye };
}

export interface MeetingDraw {
  /** Each four-ball, as [pair from club A, pair from club B]. */
  matches: [string, string][];
  /** Pairs with nobody to play, because the other club put up fewer. */
  unmatched: string[];
}

/**
 * First pair against first pair, and so on.
 *
 * A club short of pairs leaves the other club's extras without a match
 * rather than doubling somebody up — a pair playing two four-balls at once is
 * not a thing that happens on a shotgun — and says which, so the screen can
 * name them.
 */
export function drawMeeting(pairsA: readonly string[], pairsB: readonly string[]): MeetingDraw {
  const n = Math.min(pairsA.length, pairsB.length);
  const matches: [string, string][] = [];
  for (let i = 0; i < n; i += 1) matches.push([pairsA[i], pairsB[i]]);
  return { matches, unmatched: [...pairsA.slice(n), ...pairsB.slice(n)] };
}
