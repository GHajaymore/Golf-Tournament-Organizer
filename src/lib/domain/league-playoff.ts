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
  /**
   * Who the organizer recorded as going through: the winner of the play-off
   * hole on a level meeting, or a committee decision overturning a played
   * result. Null while a tie is undecided.
   */
  holeWinner?: string | null;
  /**
   * True when that recorded winner OVERTURNS the points rather than settling
   * a tie. Carried so every screen can say so — a bracket that silently
   * disagrees with the scores is worse than the decision it hides.
   */
  overrode?: boolean;
  /** The committee’s reason for an override, shown beside it. */
  note?: string;
  /** Who recorded it, so a decision is never anonymous on the screen. */
  decidedBy?: string;
}

/**
 * Who goes through from one play-off meeting.
 *
 * More points wins. A LEVEL MEETING IS SETTLED ON THE COURSE — sudden death
 * on a play-off hole — which is Ajay's decision of 2026-09-18 and the rule
 * this app now follows. It used to send the higher seed through, which is a
 * rule some leagues publish and was never this league's.
 *
 * Nobody scores a play-off hole into the app, so the result is RECORDED by
 * the organizer (`LeaguePlayoffHole`) and arrives here as `holeWinner`.
 * Until then a tie is unresolved and this returns null — the same answer as
 * a meeting still out on the course, because in both cases the club that
 * goes through is genuinely not known yet. Inventing one from the seeding
 * is exactly what was wrong before.
 */
export function meetingWinner(m: PlayoffMeeting, outcome: MeetingOutcome | undefined): string | null {
  if (!outcome || !outcome.complete) return null;
  const recorded =
    outcome.holeWinner === m.clubA || outcome.holeWinner === m.clubB ? outcome.holeWinner : null;
  /**
   * A COMMITTEE DECISION OUTRANKS THE POINTS, and only where it says it is
   * one. Ajay, 2026-09-18: the option is wanted, with caution — so it is
   * never inferred from a recorded winner that merely disagrees, it is the
   * flag the organizer set while being told what they were overturning.
   */
  if (outcome.overrode && recorded) return recorded;
  const aPoints = outcome.clubA === m.clubA ? outcome.pointsA : outcome.pointsB;
  const bPoints = outcome.clubA === m.clubA ? outcome.pointsB : outcome.pointsA;
  if (aPoints > bPoints) return m.clubA;
  if (bPoints > aPoints) return m.clubB;
  // Level: only a recorded play-off hole decides it, and only for one of
  // these two clubs — a stored id naming anybody else decides nothing.
  return recorded;
}

/**
 * A meeting that is over, level, and waiting on a play-off hole.
 *
 * The state the screen has to show and the draw has to refuse on: everything
 * has been played, nobody is through, and the app is not going to guess.
 */
export function needsPlayoffHole(m: PlayoffMeeting, outcome: MeetingOutcome | undefined): boolean {
  if (!outcome || !outcome.complete) return false;
  return meetingWinner(m, outcome) === null;
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
