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
 * Club teams, each fielding pairs, every pair playing a four-ball against an
 * opposing pair — several meetings at once on a shotgun, round robin over a
 * season. The golf is ordinary and already worked: this finds which pairs met,
 * scores each four-ball the way the app scores every other one, and adds the
 * results up to the clubs.
 *
 * THE CLUB IS A FLIGHT. `Group` is already the thing a club team is — named,
 * belonging to the tournament rather than a round, its roster is
 * `Player.groupId`, and it carries the optional captain the organizer appoints
 * in flights setup. `Team.clubGroupId` says which flight a weekly pair plays
 * for.
 *
 * THE MEETING IS DERIVED. Two pairs on one round playing for different clubs
 * ARE a meeting. Nothing stores a tie, which is why six pairings need no model
 * of their own and why a club can nominate different pairs every week without
 * anything being rebuilt.
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
  /** The flights they play for. */
  clubA: string;
  clubB: string;
  clubAName: string;
  clubBName: string;
  /** Per-hole winner, for the running match line. */
  holes: HoleResult[];
}

export interface LeagueMeeting {
  clubAId: string;
  clubBId: string;
  clubAName: string;
  clubBName: string;
  pointsA: number;
  pointsB: number;
  pairings: LeaguePairing[];
  /**
   * How many pairings this meeting SHOULD have, from the league's own setting,
   * and whether it has them.
   *
   * Six is a club's choice rather than a constant — some leagues play four,
   * some eight — so `Event.leaguePairs` carries it and zero means nobody has
   * said, in which case nothing is checked and `short` is false.
   *
   * It exists because being short is a state somebody has to ACT on: a captain
   * who has nominated five of six needs telling on Thursday afternoon, not
   * discovering it on the first tee, and no count of the rows can tell five
   * deliberate pairings from six with one missing.
   */
  expectedPairings: number;
  short: boolean;
}

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
     */
    prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF }),
    prisma.stage.findUnique({ where: { id: stageId } }),
    prisma.team.findMany({
      where: { eventId, stageId, clubGroupId: { not: null } },
      include: { club: { select: { id: true, name: true } } },
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
    if (!a || !b || !a.club || !b.club) continue;

    pairings.push({
      aName: a.name,
      bName: b.name,
      clubA: a.club.id,
      clubB: b.club.id,
      clubAName: a.club.name,
      clubBName: b.club.name,
      parentA: a.club.id,
      parentB: b.club.id,
      holes: teamMatchHoles(cardFor(a.id), cardFor(b.id)),
    });
  }

  const nameOfClub = new Map<string, string>();
  for (const p of pairings) {
    nameOfClub.set(p.clubA, p.clubAName);
    nameOfClub.set(p.clubB, p.clubBName);
  }

  return meetingsIn(pairings).map(([clubAId, clubBId]) => {
    const own = pairings.filter(
      (p) =>
        (p.clubA === clubAId && p.clubB === clubBId) ||
        (p.clubA === clubBId && p.clubB === clubAId),
    );
    const scored = meetingPoints(own, system, matchBonus);
    const by = new Map(scored.map((s) => [s.teamId, s.points]));
    const expectedPairings = event.leaguePairs;
    return {
      clubAId,
      clubBId,
      clubAName: nameOfClub.get(clubAId) ?? "—",
      clubBName: nameOfClub.get(clubBId) ?? "—",
      pointsA: by.get(clubAId) ?? 0,
      pointsB: by.get(clubBId) ?? 0,
      pairings: own,
      expectedPairings,
      // Zero means the league has not said, so nothing is checked. Only FEWER
      // is a problem: a meeting with an extra pairing is an organizer doing
      // something deliberate, and refusing it would be the app arguing with a
      // club about its own league.
      short: expectedPairings > 0 && own.length < expectedPairings,
    };
  });
}

export interface LeagueTableRow {
  clubId: string;
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
 * Every round, added together. A club that has not met anybody yet sits on
 * nothing rather than being absent, because a league table with a missing team
 * reads as a bug on a clubhouse screen.
 */
export async function leagueTable(
  eventId: string,
  system: LeaguePointsSystem,
  matchBonus?: number,
): Promise<LeagueTableRow[]> {
  /**
   * The clubs are the flights that actually field a side. An ordinary
   * tournament's flights are not clubs, and listing them would turn every
   * member-guest into a league of four.
   */
  const clubs = await prisma.group.findMany({
    where: { eventId, sides: { some: {} } },
    select: { id: true, name: true },
    orderBy: { position: "asc" },
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
      points.set(m.clubAId, (points.get(m.clubAId) ?? 0) + m.pointsA);
      points.set(m.clubBId, (points.get(m.clubBId) ?? 0) + m.pointsB);
      played.set(m.clubAId, (played.get(m.clubAId) ?? 0) + 1);
      played.set(m.clubBId, (played.get(m.clubBId) ?? 0) + 1);
    }
  }

  return clubs
    .map((c) => ({
      clubId: c.id,
      name: c.name,
      points: points.get(c.id) ?? 0,
      played: played.get(c.id) ?? 0,
    }))
    /**
     * Most points first, and a tie stays a tie — the places are worked out by
     * the reader, the same way every other board in this app does it since
     * `placesByValue`. A league table full of halves produces genuine ties,
     * which is why a real one shows T12 twice.
     */
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
