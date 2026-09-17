/**
 * A LEAGUE'S PLAY-OFFS: the top clubs after the round robin, in a knockout.
 *
 * The shape club software offers — final only, semi-finals and a final, or
 * quarter-finals as well — so the choice is 2, 4 or 8 clubs and nothing else.
 * A play-off round is an ordinary league week whose meetings come from the
 * seeding instead of the rotation; everything about scoring a meeting is
 * unchanged.
 *
 * WHICH ROUNDS are the play-offs is derived: the last one, two or three team
 * rounds. Nothing is flagged on a round, so adding a week to the season moves
 * the play-offs with it rather than leaving a marker on the wrong round.
 *
 * Pure: ids and numbers in, meetings out.
 */

export const LEAGUE_PLAYOFF_SIZES = [0, 2, 4, 8] as const;
export type LeaguePlayoffSize = (typeof LEAGUE_PLAYOFF_SIZES)[number];

export function isLeaguePlayoffSize(v: unknown): v is LeaguePlayoffSize {
  return (LEAGUE_PLAYOFF_SIZES as readonly unknown[]).includes(v);
}

export const LEAGUE_PLAYOFF_LABEL: Record<LeaguePlayoffSize, string> = {
  0: "No play-offs",
  2: "Top 2 — a final",
  4: "Top 4 — semi-finals and a final",
  8: "Top 8 — quarter-finals, semi-finals and a final",
};

/** How many rounds a play-off of this size takes. */
export function playoffRoundCount(size: number): number {
  return isLeaguePlayoffSize(size) && size > 0 ? Math.log2(size) : 0;
}

/** What each play-off round is called, counted back from the final. */
export function playoffRoundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 1) return "Final";
  if (fromEnd === 2) return "Semi-finals";
  if (fromEnd === 3) return "Quarter-finals";
  return `Play-off round ${round + 1}`;
}

/**
 * Split the tournament's team rounds into the season and the play-offs.
 *
 * A league without at least one season round before its play-offs has no
 * play-offs yet — a final with no season before it has nobody to seed — so
 * every round counts as season until the organizer adds enough of them.
 */
export function splitSeason<T>(teamRounds: readonly T[], size: number): { season: T[]; playoffs: T[] } {
  const n = playoffRoundCount(size);
  if (n === 0 || teamRounds.length <= n) return { season: [...teamRounds], playoffs: [] };
  return {
    season: teamRounds.slice(0, teamRounds.length - n),
    playoffs: teamRounds.slice(teamRounds.length - n),
  };
}

/**
 * The standard bracket: seed pairs for the first round, in bracket order.
 *
 * Bracket order rather than 1v8, 2v7, 3v6, 4v5 in a list, because the order
 * decides who meets whom next: the winners of adjacent meetings play each
 * other, and this arrangement keeps 1 and 2 apart until the final. Seeds are
 * 1-based.
 */
export function bracketSeeds(size: number): [number, number][] {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    order = order.flatMap((s) => [s, total - s]);
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
  return pairs;
}

export interface SeedRow {
  clubId: string;
  name: string;
  points: number;
  /** Meetings won outright — the first tiebreak. */
  won: number;
}

/**
 * The table in seeding order: points, then meetings won, then name.
 *
 * The name is the last resort and is not golf, which is why the screen says
 * it out loud. A league that wants a play-off hole for a tie settles it and
 * the organizer adjusts; the app will not invent a result.
 */
export function seedOrder<T extends SeedRow>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => b.points - a.points || b.won - a.won || a.name.localeCompare(b.name),
  );
}

export interface PlayoffMeeting {
  /** Seed numbers, 1-based. */
  seedA: number;
  seedB: number;
  clubA: string;
  clubB: string;
}

export interface MeetingOutcome {
  clubA: string;
  clubB: string;
  pointsA: number;
  pointsB: number;
  /** Every pairing in the meeting has a decided result. */
  complete: boolean;
}

/**
 * Who goes through from one play-off meeting.
 *
 * More points wins. A level meeting goes to the higher seed — the reward for
 * the season, and the rule most leagues publish — rather than to nobody.
 * Null while the meeting is still being played.
 */
export function meetingWinner(m: PlayoffMeeting, outcome: MeetingOutcome | undefined): string | null {
  if (!outcome || !outcome.complete) return null;
  const aPoints = outcome.clubA === m.clubA ? outcome.pointsA : outcome.pointsB;
  const bPoints = outcome.clubA === m.clubA ? outcome.pointsB : outcome.pointsA;
  if (aPoints > bPoints) return m.clubA;
  if (bPoints > aPoints) return m.clubB;
  return m.seedA < m.seedB ? m.clubA : m.clubB;
}

const outcomeKey = (a: string, b: string) => [a, b].sort().join(":");

export interface PlayoffRound {
  name: string;
  /** Null for a meeting whose sides are not known yet. */
  meetings: (PlayoffMeeting | null)[];
}

/**
 * The whole bracket, as far as the results allow.
 *
 * `seeded` is the club ids in seeding order; `outcomes[r]` the meetings
 * actually played in play-off round r. A later round's meeting is known only
 * once both meetings feeding it have a winner.
 */
export function playoffBracket(
  seeded: readonly string[],
  size: number,
  outcomes: readonly (readonly MeetingOutcome[])[],
): PlayoffRound[] {
  const rounds = playoffRoundCount(size);
  if (rounds === 0 || seeded.length < size) return [];

  const result: PlayoffRound[] = [];
  let current: (PlayoffMeeting | null)[] = bracketSeeds(size).map(([a, b]) => ({
    seedA: a,
    seedB: b,
    clubA: seeded[a - 1],
    clubB: seeded[b - 1],
  }));

  for (let r = 0; r < rounds; r += 1) {
    result.push({ name: playoffRoundName(r, rounds), meetings: current });
    if (r === rounds - 1) break;

    const played = new Map((outcomes[r] ?? []).map((o) => [outcomeKey(o.clubA, o.clubB), o]));
    const winners = current.map((m) => {
      if (!m) return null;
      const w = meetingWinner(m, played.get(outcomeKey(m.clubA, m.clubB)));
      if (!w) return null;
      return { club: w, seed: w === m.clubA ? m.seedA : m.seedB };
    });

    const next: (PlayoffMeeting | null)[] = [];
    for (let i = 0; i + 1 < winners.length; i += 2) {
      const a = winners[i];
      const b = winners[i + 1];
      next.push(a && b ? { seedA: a.seed, seedB: b.seed, clubA: a.club, clubB: b.club } : null);
    }
    current = next;
  }
  return result;
}

/** The champion, once the final has a winner. */
export function playoffChampion(
  bracket: readonly PlayoffRound[],
  finalOutcomes: readonly MeetingOutcome[],
): string | null {
  const final = bracket.at(-1)?.meetings[0];
  if (!final) return null;
  return meetingWinner(
    final,
    finalOutcomes.find((o) => outcomeKey(o.clubA, o.clubB) === outcomeKey(final.clubA, final.clubB)),
  );
}
