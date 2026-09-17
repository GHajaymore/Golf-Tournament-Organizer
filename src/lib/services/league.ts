import "server-only";
import { prisma } from "../db";
import { COURSE_REF, cardForStage } from "./course-resolution";
import { resolveCourse } from "../courses";
import { aggregateTeamCard, teamMatchHoles, type TeamMemberCard } from "../domain/team";
import { effectiveCountBest } from "./teams";
import {
  meetingPoints,
  meetingsIn,
  type LeaguePointsSystem,
  type PairingResult,
} from "../domain/league-meeting";
import type { HoleResult } from "../domain/types";

/**
 * A WEEK OF AN INTERCLUB LEAGUE, READ OFF THE ROWS.
 *
 * Twelve club teams, six four-balls each, shotgun across eighteen holes, round
 * robin. The golf is ordinary and already worked — this only finds which pairs
 * met, scores each four-ball the way the app scores every other one, and adds
 * the results up to the clubs.
 *
 * THE MEETING IS DERIVED. `Team.parentTeamId` says which club a pair plays
 * for, so two pairs on one round whose parents differ ARE a meeting. Nothing
 * stores a tie, which is why six pairings need no model of their own and why
 * a club can nominate different pairs every week without anything being
 * rebuilt.
 *
 * SCORED THROUGH THE SAME FUNCTIONS AS EVERY OTHER FOUR-BALL —
 * `aggregateTeamCard` for each side's better ball, `teamMatchHoles` for who
 * won the hole. A second opinion here is how a league table comes to disagree
 * with the scorecard a player is looking at.
 */

export interface LeaguePairing {
  /** The two sides, as they are named on the sheet. */
  aName: string;
  bName: string;
  /** The clubs they play for. */
  parentA: string;
  parentB: string;
  parentAName: string;
  parentBName: string;
  /** Per-hole winner, for the running match line. */
  holes: HoleResult[];
}

export interface LeagueMeeting {
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  pointsA: number;
  pointsB: number;
  pairings: LeaguePairing[];
}

/**
 * Every club-versus-club meeting in one round, with its pairings scored.
 *
 * Returns an empty list for every round that is not league play, which is
 * almost all of them: a side with no parent is an ordinary four-ball and is
 * skipped rather than read as a club of one.
 */
export async function leagueMeetings(
  eventId: string,
  stageId: string,
  system: LeaguePointsSystem,
  matchBonus?: number,
): Promise<LeagueMeeting[]> {
  const [event, stage, sides, matches] = await Promise.all([
    /**
     * `COURSE_REF`, because a league is the thing that rotates venues.
     *
     * Without it `resolveCourse` never sees the linked course rows and falls
     * back to the free-text name on the event — so a league playing week three
     * at another club would be scored against the home card, allocating
     * strokes off the wrong stroke index. `course-by-id.test.ts` caught this
     * the first time this file was written, and CLAUDE.md records the same
     * defect having reached the birdie pots once already.
     *
     * `cardForStage` then narrows it to the round's own venue and nine.
     */
    prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF }),
    prisma.stage.findUnique({ where: { id: stageId } }),
    prisma.team.findMany({
      where: { eventId, stageId, parentTeamId: { not: null } },
      include: { members: true, parent: { select: { id: true, name: true } } },
    }),
    prisma.match.findMany({ where: { eventId, stageId } }),
  ]);
  if (!event || !stage || sides.length === 0) return [];

  const card = cardForStage(resolveCourse(event), stage);
  const countBest = effectiveCountBest(stage.format, stage.countBest);

  const cards = await prisma.teamScorecard.findMany({ where: { eventId, stageId } });
  const players = await prisma.player.findMany({
    where: { eventId },
    select: { id: true, handicap: true },
  });
  const handicapOf = new Map(players.map((p) => [p.id, p.handicap]));

  /**
   * One side's four-ball card, built the same way the entry screen and the
   * team board build it. A side with no scores yet yields a card of nulls
   * rather than nothing, so an unplayed pairing reads as unplayed instead of
   * as a walkover.
   */
  const cardFor = (teamId: string) => {
    const own = cards.filter((c) => c.teamId === teamId);
    const members: TeamMemberCard[] = own.map((c) => {
      let strokes: (number | null)[] = [];
      try {
        strokes = JSON.parse(c.strokes) as (number | null)[];
      } catch {
        strokes = [];
      }
      return { playerId: c.playerId, strokes, courseHandicap: handicapOf.get(c.playerId) ?? 0 };
    });
    return aggregateTeamCard(members, card.pars, card.strokeIndex, stage.handicapAllowance, countBest);
  };

  const sideById = new Map(sides.map((s) => [s.id, s]));

  const pairings: (PairingResult & LeaguePairing)[] = [];
  for (const m of matches) {
    const a = sideById.get(m.teamAId);
    const b = sideById.get(m.teamBId);
    // Not league play: an individual fixture, or a side with no club.
    if (!a || !b || !a.parent || !b.parent) continue;

    pairings.push({
      aName: a.name,
      bName: b.name,
      parentA: a.parent.id,
      parentB: b.parent.id,
      parentAName: a.parent.name,
      parentBName: b.parent.name,
      holes: teamMatchHoles(cardFor(a.id), cardFor(b.id)),
    });
  }

  const nameOfParent = new Map<string, string>();
  for (const p of pairings) {
    nameOfParent.set(p.parentA, p.parentAName);
    nameOfParent.set(p.parentB, p.parentBName);
  }

  return meetingsIn(pairings).map(([teamAId, teamBId]) => {
    const own = pairings.filter(
      (p) =>
        (p.parentA === teamAId && p.parentB === teamBId) ||
        (p.parentA === teamBId && p.parentB === teamAId),
    );
    const scored = meetingPoints(own, system, matchBonus);
    const by = new Map(scored.map((s) => [s.teamId, s.points]));
    return {
      teamAId,
      teamBId,
      teamAName: nameOfParent.get(teamAId) ?? "—",
      teamBName: nameOfParent.get(teamBId) ?? "—",
      pointsA: by.get(teamAId) ?? 0,
      pointsB: by.get(teamBId) ?? 0,
      pairings: own,
    };
  });
}

export interface LeagueTableRow {
  teamId: string;
  name: string;
  points: number;
  /** Meetings this club has actually played, for "after six weeks". */
  played: number;
}

/**
 * THE TABLE A LEAGUE ACTUALLY CARES ABOUT: where the clubs stand after N
 * weeks.
 *
 * `season.ts` says the same thing about the SIDE that plays — "a league is one
 * event with many rounds, so until now nothing could answer 'where do we stand
 * after six weeks'". This is that question one level up, for the club rather
 * than the pair.
 *
 * Every playing round, added together. A club that has not met anybody yet
 * sits on nothing rather than being absent, because a league table with a
 * missing team reads as a bug on a clubhouse screen.
 */
export async function leagueTable(
  eventId: string,
  system: LeaguePointsSystem,
  matchBonus?: number,
): Promise<LeagueTableRow[]> {
  const clubs = await prisma.team.findMany({
    where: { eventId, stageId: null },
    select: { id: true, name: true },
    orderBy: { seed: "asc" },
  });
  if (clubs.length === 0) return [];

  const stages = await prisma.stage.findMany({
    where: { eventId },
    select: { id: true },
    orderBy: { position: "asc" },
  });

  const points = new Map(clubs.map((c) => [c.id, 0]));
  const played = new Map(clubs.map((c) => [c.id, 0]));

  for (const s of stages) {
    for (const m of await leagueMeetings(eventId, s.id, system, matchBonus)) {
      points.set(m.teamAId, (points.get(m.teamAId) ?? 0) + m.pointsA);
      points.set(m.teamBId, (points.get(m.teamBId) ?? 0) + m.pointsB);
      played.set(m.teamAId, (played.get(m.teamAId) ?? 0) + 1);
      played.set(m.teamBId, (played.get(m.teamBId) ?? 0) + 1);
    }
  }

  return clubs
    .map((c) => ({
      teamId: c.id,
      name: c.name,
      points: points.get(c.id) ?? 0,
      played: played.get(c.id) ?? 0,
    }))
    /**
     * Most points first, and a tie stays a tie — the places are worked out by
     * the reader, the same way every other board in this app does it since
     * `placesByValue`. A league table full of halves produces genuine ties,
     * which is why the real one shows T12 twice.
     */
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
