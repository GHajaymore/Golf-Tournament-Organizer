import "server-only";
import { prisma } from "../db";
import { findFormat, sideSizeRange } from "../formats";
import { courseHandicapMap } from "../domain/handicap";
import {
  sideHandicap,
  committeeWeights,
  aggregateTeamCard,
  singleBallTeamCard,
  SCRAMBLE_WEIGHTS_2,
  SCRAMBLE_WEIGHTS_4,
} from "../domain/team";

export interface TeamMemberView {
  playerId: string;
  name: string;
  handicap: number;
  position: number;
}

export interface TeamView {
  id: string;
  name: string;
  seed: number;
  /** Null when the team plays the whole tournament rather than one round. */
  stageId: string | null;
  members: TeamMemberView[];
  /** The side's playing handicap under this round's format. */
  playingHandicap: number;
}

/**
 * Teams available to a round.
 *
 * Returns round-specific teams where they exist, and event-wide teams
 * otherwise — a member-guest draws its pairings once for the whole
 * tournament, a society redraws every week, and neither should have to know
 * which model the other uses.
 */
export async function teamsForStage(
  eventId: string,
  stageId: string,
  format: string,
  allowanceOverride = 0,
  holes = 18,
  weightsOverride?: number[] | null,
): Promise<TeamView[]> {
  // Side handicaps are built from Course Handicaps, not roster Indexes — a
  // foursomes pair off the blues receives different strokes to the same pair
  // off the reds, which is the whole reason tees are rated.
  const tees = await prisma.tee.findMany({
    where: { course: { events: { some: { eventId } } } },
    orderBy: [{ position: "asc" }],
  });
  const teeRatings = new Map(
    tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
  );
  const defaultTeeId = tees[0]?.id ?? null;

  const rows = await prisma.team.findMany({
    where: { eventId, OR: [{ stageId }, { stageId: null }] },
    include: {
      members: {
        orderBy: { position: "asc" },
        include: { player: { select: { id: true, name: true, handicap: true, handicapType: true, teeId: true } } },
      },
    },
    orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
  });

  // A round that has its own teams uses only those; falling through to the
  // event-wide set as well would field every pairing twice.
  const scoped = rows.filter((t) => t.stageId === stageId);
  const use = scoped.length > 0 ? scoped : rows.filter((t) => t.stageId === null);

  const allMembers = use.flatMap((t) => t.members.map((m) => m.player));
  const courseHcp = courseHandicapMap(allMembers, teeRatings, defaultTeeId, holes);

  return use.map((t) => {
    const members = t.members.map((m) => ({
      playerId: m.playerId,
      name: m.player.name,
      handicap: courseHcp.get(m.playerId) ?? m.player.handicap,
      position: m.position,
    }));
    return {
      id: t.id,
      name: t.name,
      seed: t.seed,
      stageId: t.stageId,
      members,
      playingHandicap: sidePlayingHandicap(members.map((m) => m.handicap), format, allowanceOverride, weightsOverride),
    };
  });
}

/**
 * The side's playing handicap for a format.
 *
 * Scrambles use a descending share of each player's handicap rather than a
 * flat percentage of the combined total — a four whose handicaps sum to 72
 * would otherwise be given a wildly different allowance depending on how the
 * percentage was applied. Everything else takes the format's allowance against
 * the combined handicaps, which is how foursomes' 50% is meant to work.
 */
export function sidePlayingHandicap(
  courseHandicaps: number[],
  format: string,
  allowanceOverride = 0,
  weightsOverride?: number[] | null,
): number {
  const f = findFormat(format);
  // A committee's own split is the most specific thing they can say, so it
  // wins: it is only ever settable on formats that use one, and a club that
  // has typed "55 / 45" has said something a single percentage cannot.
  const committee = committeeWeights(weightsOverride, courseHandicaps.length);
  if (committee) return sideHandicap(courseHandicaps, 0, committee);
  // A flat override replaces the whole scheme, including the scramble
  // weights: a committee that says "40%" means 40% of the combined handicaps,
  // not 40% layered on top of a descending table they never mentioned.
  if (allowanceOverride > 0) return sideHandicap(courseHandicaps, allowanceOverride);
  // A format that declares per-player shares (greensomes' 60/40) is scored by
  // that split, not by a flat percentage of the combined handicaps — applying
  // `allowance` here instead would hand the side far too many shots.
  const declared = f.weightsBySideSize?.[courseHandicaps.length];
  if (declared) return sideHandicap(courseHandicaps, 0, declared);
  if (/scramble/i.test(f.name)) {
    const weights = courseHandicaps.length > 2 ? SCRAMBLE_WEIGHTS_4 : SCRAMBLE_WEIGHTS_2;
    return sideHandicap(courseHandicaps, 0, weights);
  }
  return sideHandicap(courseHandicaps, f.allowance);
}

/** The allowance actually in force for a round: the committee's, or the
 *  format's recommendation when they haven't set one. */
export function effectiveAllowance(format: string, override: number): number {
  return override > 0 ? override : findFormat(format).allowance;
}

/**
 * How many partners' scores count on each hole for this round.
 *
 * Zero means the organizer has said nothing, which is one — the single best
 * ball, as four-ball and best ball are normally played. A stored zero must
 * never read as "count none", which would score every hole as blank.
 *
 * Capped at the number of players a side can hold: "best 6 of 4" is not a
 * format, and letting it through would just be a confusing way of writing
 * "everyone counts".
 */
export function effectiveCountBest(format: string, override: number): number {
  if (!Number.isFinite(override) || override <= 0) return 1;
  return Math.min(Math.round(override), sideSizeRange(format).max);
}

export interface TeamProblem {
  teamId: string;
  teamName: string;
  problem: string;
}

/**
 * Sides that can't play the round as configured.
 *
 * Surfaced before a round starts rather than at scoring time, because a
 * three-player scramble discovered on the first tee is an organizer's problem
 * and a three-player scramble discovered on Saturday morning is a crisis.
 */
export function teamProblems(teams: TeamView[], format: string): TeamProblem[] {
  const { min, max } = sideSizeRange(format);
  const problems: TeamProblem[] = [];
  for (const t of teams) {
    const n = t.members.length;
    if (n < min) {
      problems.push({
        teamId: t.id,
        teamName: t.name,
        problem: n === 0 ? "has no players" : `has ${n} of ${min} players`,
      });
    } else if (n > max) {
      problems.push({ teamId: t.id, teamName: t.name, problem: `has ${n} players, more than ${max}` });
    }
  }
  return problems;
}

/** Players entered in the tournament who aren't on any side for this round. */
export async function unassignedPlayers(
  eventId: string,
  teams: TeamView[],
): Promise<{ id: string; name: string; handicap: number }[]> {
  const taken = new Set(teams.flatMap((t) => t.members.map((m) => m.playerId)));
  const players = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { id: true, name: true, handicap: true },
    orderBy: { seed: "asc" },
  });
  return players.filter((p) => !taken.has(p.id));
}

export interface TeamStanding {
  teamId: string;
  name: string;
  members: string[];
  playingHandicap: number;
  gross: number;
  net: number;
  points: number;
  played: number;
  toPar: number;
}

/**
 * Standings for a team round.
 *
 * Ranks sides rather than players, which is the whole point — in a scramble
 * nobody has an individual score to rank, and in a four-ball an individual
 * score is only half the story.
 *
 * Sides that haven't returned anything sort last rather than tying for first
 * on a gross of zero, which is what a naive ascending sort would do.
 */
export async function teamStandings(
  eventId: string,
  stageId: string,
  format: string,
  pars: number[],
  strokeIndex: number[],
  basis: string,
  allowanceOverride = 0,
  weightsOverride?: number[] | null,
  countBestOverride = 0,
): Promise<TeamStanding[]> {
  const f = findFormat(format);
  const [teams, cards] = await Promise.all([
    // `holes` is left at its default rather than derived from pars.length, to
    // keep this call behaving exactly as it did before weights were added.
    teamsForStage(eventId, stageId, format, allowanceOverride, 18, weightsOverride),
    prisma.teamScorecard.findMany({ where: { eventId, stageId } }),
  ]);

  const parse = (s: string): (number | null)[] => {
    try {
      return JSON.parse(s) as (number | null)[];
    } catch {
      return [];
    }
  };

  const rows = teams.map((t) => {
    const own = cards.filter((c) => c.teamId === t.id);
    const card =
      f.ball === "single"
        ? singleBallTeamCard(
            parse(own.find((c) => c.playerId === "")?.strokes ?? "[]"),
            pars,
            t.playingHandicap,
            strokeIndex,
          )
        : aggregateTeamCard(
            t.members.map((m) => ({
              playerId: m.playerId,
              strokes: parse(own.find((c) => c.playerId === m.playerId)?.strokes ?? "[]"),
              courseHandicap: m.handicap,
            })),
            pars,
            strokeIndex,
            effectiveAllowance(format, allowanceOverride),
            effectiveCountBest(format, countBestOverride),
          );
    return {
      teamId: t.id,
      name: t.name,
      members: t.members.map((m) => m.name),
      playingHandicap: t.playingHandicap,
      gross: card.grossTotal,
      net: card.netTotal,
      points: card.pointsTotal,
      played: card.played,
      toPar: card.toPar,
    };
  });

  const stableford = basis === "stableford";
  return rows.sort((a, b) => {
    // A side with no card yet has nothing to rank, and a gross of zero would
    // otherwise put it top.
    if (a.played === 0 !== (b.played === 0)) return a.played === 0 ? 1 : -1;
    if (stableford) return b.points - a.points || a.name.localeCompare(b.name);
    return a.net - b.net || a.gross - b.gross || a.name.localeCompare(b.name);
  });
}

/**
 * Draw sides automatically, pairing strongest with weakest.
 *
 * A snake draw keeps sides comparable, which is what a charity day or a
 * member-guest actually wants — random sides in a field with a 25-shot spread
 * produce a winner decided at registration rather than on the course.
 */
export function snakeDraw<T extends { id: string; handicap: number }>(
  players: T[],
  sideSize: number,
): T[][] {
  const ordered = [...players].sort((a, b) => a.handicap - b.handicap);
  const sideCount = Math.ceil(ordered.length / sideSize) || 0;
  if (sideCount === 0) return [];
  const sides: T[][] = Array.from({ length: sideCount }, () => []);
  ordered.forEach((p, i) => {
    const row = Math.floor(i / sideCount);
    const col = i % sideCount;
    // Alternate direction each pass, so the best player and the weakest end up
    // together rather than all the low handicaps landing on side one.
    sides[row % 2 === 0 ? col : sideCount - 1 - col].push(p);
  });
  return sides;
}
