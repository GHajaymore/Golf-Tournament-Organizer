import "server-only";
import { prisma } from "../db";
import { findFormat, sideSizeRange } from "../formats";
import { sideHandicap, SCRAMBLE_WEIGHTS_2, SCRAMBLE_WEIGHTS_4 } from "../domain/team";

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
export async function teamsForStage(eventId: string, stageId: string, format: string): Promise<TeamView[]> {
  const rows = await prisma.team.findMany({
    where: { eventId, OR: [{ stageId }, { stageId: null }] },
    include: {
      members: {
        orderBy: { position: "asc" },
        include: { player: { select: { id: true, name: true, handicap: true } } },
      },
    },
    orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
  });

  // A round that has its own teams uses only those; falling through to the
  // event-wide set as well would field every pairing twice.
  const scoped = rows.filter((t) => t.stageId === stageId);
  const use = scoped.length > 0 ? scoped : rows.filter((t) => t.stageId === null);

  return use.map((t) => {
    const members = t.members.map((m) => ({
      playerId: m.playerId,
      name: m.player.name,
      handicap: m.player.handicap,
      position: m.position,
    }));
    return {
      id: t.id,
      name: t.name,
      seed: t.seed,
      stageId: t.stageId,
      members,
      playingHandicap: sidePlayingHandicap(members.map((m) => m.handicap), format),
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
export function sidePlayingHandicap(courseHandicaps: number[], format: string): number {
  const f = findFormat(format);
  if (/scramble/i.test(f.name)) {
    const weights = courseHandicaps.length > 2 ? SCRAMBLE_WEIGHTS_4 : SCRAMBLE_WEIGHTS_2;
    return sideHandicap(courseHandicaps, 0, weights);
  }
  return sideHandicap(courseHandicaps, f.allowance);
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
