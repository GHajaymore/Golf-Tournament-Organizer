import "server-only";
import { prisma } from "../db";
import { COURSE_REF, cardForStage, courseForRound } from "./course-resolution";
import { resolveCourse } from "../courses";
import { matchHolesOffTheLow, type MatchBall } from "../domain/team";
import { playingHandicapFrom } from "../domain/handicap";
import { effectiveAllowance, effectiveCountBest } from "./teams";
import {
  meetingPoints,
  meetingsIn,
  type LeaguePointsSystem,
  type PairingResult,
} from "../domain/league-meeting";
import type { HoleResult } from "../domain/types";
import { matchIsOver } from "../domain/match";
import { needsTeams } from "../formats";
import { scoringFrom } from "./tournament";
import { tiebreakerLabel } from "../domain/types";
import { clubOrderNote, orderClubs, type HeadToHead } from "../domain/league-order";
import {
  needsPlayoffHole,
  playoffBracket,
  playoffChampion,
  splitSeason,
  type MeetingOutcome,
} from "../domain/league-playoff";

/** One meeting's outcome out of a round's list, either way round. */
function outcomeFor(round: readonly MeetingOutcome[], a: string, b: string) {
  return round.find(
    (o) => (o.clubA === a && o.clubB === b) || (o.clubA === b && o.clubB === a),
  );
}

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
  /**
   * Every pairing has a decided result, read with `matchIsOver` so an
   * unplayed card is not a finished one. A play-off meeting only sends a club
   * through once this is true.
   */
  complete: boolean;
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

  /**
   * THE CARD THIS WEEK IS PLAYED ON — the week's own course, then the club's.
   *
   * `COURSE_REF` above fixed half of this and its comment describes the other
   * half exactly: "a league is the thing that rotates venues". It makes
   * `resolveCourse` see the EVENT's linked course row; a league playing week
   * three at another club names that course on the WEEK, and `resolveCourse`
   * has never had a way to hear about it. So the round was still scored against
   * the home card — the very defect the block above says it closed.
   *
   * Scoped to courses attached to this event, the same guard every other
   * scoring path applies: a `courseId` is an id, and an id from somewhere else
   * must not resolve.
   */
  const weekVenue = stage.courseId
    ? await prisma.course.findFirst({ where: { id: stage.courseId, events: { some: { eventId } } } })
    : null;
  const card = cardForStage(courseForRound(weekVenue, event) ?? resolveCourse(event), stage);
  const countBest = effectiveCountBest(stage.format, stage.countBest);

  const cards = await prisma.teamScorecard.findMany({ where: { eventId, stageId } });
  const players = await prisma.player.findMany({
    where: { eventId },
    select: { id: true, handicap: true },
  });
  const handicapOf = new Map(players.map((p) => [p.id, p.handicap]));

  /**
   * One side as the balls of a match, for `matchHolesOffTheLow`.
   *
   * This replaces a `cardFor` that built each side with `aggregateTeamCard`
   * and handed the two to `teamMatchHoles` — full allowance each, net better
   * ball against net better ball. That is the net MEDAL method and this is a
   * MATCH; the difference lands on the hardest holes, which the domain
   * function sets out with the measurement.
   *
   * Same rows and the same handicap source as before, deliberately: the only
   * thing that changed here is the method. A side with no scores yet yields
   * balls of nulls rather than nothing, so an unplayed pairing still reads as
   * unplayed instead of as a walkover.
   */
  const allowancePct = effectiveAllowance(stage.format, stage.handicapAllowance);
  const ballsFor = (teamId: string): MatchBall[] =>
    cards
      .filter((c) => c.teamId === teamId)
      .map((c) => {
        let strokes: (number | null)[] = [];
        try {
          strokes = JSON.parse(c.strokes) as (number | null)[];
        } catch {
          strokes = [];
        }
        return {
          strokes,
          playingHandicap: playingHandicapFrom(handicapOf.get(c.playerId) ?? 0, allowancePct),
        };
      });

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
      // Off the lowest handicap in the four, not each side's full-allowance
      // net — see `matchHolesOffTheLow`. This decides the match and the league
      // points, and nothing else: the week sheet's own figures come from
      // `week-view.ts`, which still reads `aggregateTeamCard`.
      holes: matchHolesOffTheLow(
        ballsFor(a.id),
        ballsFor(b.id),
        card.strokeIndex,
        card.pars.length,
        countBest,
      ),
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
      complete: own.length > 0 && own.every((p) => matchIsOver(p.holes)),
    };
  });
}

export interface LeagueTableRow {
  clubId: string;
  name: string;
  points: number;
  /** Meetings this club has actually played, for "after six weeks". */
  played: number;
  /** Meetings won outright. A halved meeting counts to neither side. */
  won: number;
  /** Holes won and lost across every pairing — the committee's countbacks. */
  holesWon: number;
  holesLost: number;
}

export interface LeagueTable {
  rows: LeagueTableRow[];
  /** What decided the order, in the committee's own words. */
  orderNote: string;
}

/**
 * The tournament's team rounds, split into the season and the play-offs.
 *
 * One reader for the split, so the table, the draw and the bracket cannot
 * disagree about which week is the semi-final.
 */
export async function leagueSeason(eventId: string): Promise<{
  season: string[];
  playoffs: string[];
  size: number;
}> {
  const [event, stages] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { leaguePlayoffClubs: true } }),
    prisma.stage.findMany({
      where: { eventId },
      select: { id: true, format: true },
      orderBy: { position: "asc" },
    }),
  ]);
  const size = event?.leaguePlayoffClubs ?? 0;
  const teamRounds = stages.filter((s) => needsTeams(s.format)).map((s) => s.id);
  const { season, playoffs } = splitSeason(teamRounds, size);
  return { season, playoffs, size: playoffs.length > 0 ? size : 0 };
}

export interface LeaguePlayoffs {
  rounds: {
    stageId: string;
    name: string;
    meetings: ({ seedA: number; seedB: number; clubA: string; clubB: string } | null)[];
    /**
     * The meetings in this round that finished LEVEL and are waiting on a
     * play-off hole, as `[clubA, clubB]`. The screen asks the organizer who
     * won it; nothing advances until they say.
     */
    awaitingHole: [string, string][];
    /**
     * What was DECIDED off the course in this round, and by whom — the
     * play-off holes and the committee overrides. Carried so every screen can
     * name it: a decision nobody can see is a decision that reads as the
     * app getting the bracket wrong.
     */
    decisions: Array<{
      clubA: string;
      clubB: string;
      winner: string;
      overrode: boolean;
      note: string;
      decidedBy: string;
    }>;
  }[];
  /** Club id to name, for everything above. */
  names: Record<string, string>;
  champion: string | null;
}

/**
 * THE PLAY-OFF BRACKET, as far as the results allow.
 *
 * SEEDED BY THE TABLE ITSELF, in the order the screen prints it — points,
 * then the committee’s own tiebreak chain (see `orderClubs`), then the name.
 * One order, so the club listed above another is the club seeded above it.
 *
 * Advanced by `meetingWinner`, which reads the play-off meetings that were
 * actually played. Null when the league has no play-offs.
 */
export async function leaguePlayoffs(
  eventId: string,
  system: LeaguePointsSystem,
  matchBonus?: number,
): Promise<LeaguePlayoffs | null> {
  const { playoffs, size } = await leagueSeason(eventId);
  if (size === 0) return null;

  const table = await leagueTable(eventId, system, matchBonus);
  const seeded = table.rows.map((r) => r.clubId);
  /**
   * The play-off holes the organizer has recorded, because a level meeting
   * is settled on the course and the app cannot see that happen.
   */
  const decided = await prisma.leaguePlayoffHole.findMany({
    where: { eventId, stageId: { in: playoffs } },
    select: {
      stageId: true, clubLowId: true, clubHighId: true, winnerId: true,
      overrode: true, note: true, decidedBy: true,
    },
  });
  const holeKey = (stageId: string, a: string, b: string) =>
    [stageId, ...[a, b].sort()].join(":");
  const decisions = new Map(
    decided.map((d) => [holeKey(d.stageId, d.clubLowId, d.clubHighId), d]),
  );

  const outcomes: MeetingOutcome[][] = [];
  for (const stageId of playoffs) {
    const played = await leagueMeetings(eventId, stageId, system, matchBonus);
    outcomes.push(
      played.map((m) => ({
        clubA: m.clubAId,
        clubB: m.clubBId,
        pointsA: m.pointsA,
        pointsB: m.pointsB,
        complete: m.complete,
        ...(() => {
          const d = decisions.get(holeKey(stageId, m.clubAId, m.clubBId));
          return {
            holeWinner: d?.winnerId ?? null,
            overrode: d?.overrode ?? false,
            note: d?.note ?? "",
            decidedBy: d?.decidedBy ?? "",
          };
        })(),
      })),
    );
  }

  const bracket = playoffBracket(seeded, size, outcomes);
  if (bracket.length === 0) return null;
  return {
    rounds: bracket.map((r, i) => ({
      stageId: playoffs[i],
      name: r.name,
      meetings: r.meetings,
      awaitingHole: r.meetings
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .filter((m) => needsPlayoffHole(m, outcomeFor(outcomes[i] ?? [], m.clubA, m.clubB)))
        .map((m): [string, string] => [m.clubA, m.clubB]),
      decisions: r.meetings
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .flatMap((m) => {
          const o = outcomeFor(outcomes[i] ?? [], m.clubA, m.clubB);
          if (!o?.holeWinner) return [];
          return [{
            clubA: m.clubA,
            clubB: m.clubB,
            winner: o.holeWinner,
            overrode: o.overrode ?? false,
            note: o.note ?? "",
            decidedBy: o.decidedBy ?? "",
          }];
        }),
    })),
    names: Object.fromEntries(table.rows.map((r) => [r.clubId, r.name])),
    champion: playoffChampion(bracket, outcomes.at(-1) ?? []),
  };
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
): Promise<LeagueTable> {
  /**
   * THE CLUBS ARE THE FLIGHTS — every one, including a club that has not
   * nominated a pair yet. The same list the team sheets and the draw use.
   *
   * This used to be "flights that field a side", to keep an ordinary
   * tournament's flights from reading as a league of four. The league is a
   * switch now (`Event.leaguePoints`) and the screen only asks when it is on,
   * so that filter only emptied the table — and with it the play-off seeding —
   * until the first pairs were in.
   */
  const clubs = await prisma.group.findMany({
    where: { eventId, stageId: null, isCarrier: false },
    select: { id: true, name: true },
    orderBy: { position: "asc" },
  });
  if (clubs.length === 0) return { rows: [], orderNote: "" };

  /**
   * THE SEASON ONLY. A play-off meeting decides who goes through, not where
   * a club finished — counting it would let the semi-final reorder the very
   * table that seeded it.
   */
  const { season } = await leagueSeason(eventId);

  const points = new Map(clubs.map((c) => [c.id, 0]));
  const played = new Map(clubs.map((c) => [c.id, 0]));
  const won = new Map(clubs.map((c) => [c.id, 0]));
  const holesWon = new Map(clubs.map((c) => [c.id, 0]));
  const holesLost = new Map(clubs.map((c) => [c.id, 0]));
  const add = (m: Map<string, number>, id: string, n: number) => m.set(id, (m.get(id) ?? 0) + n);
  /** Who beat whom, for the head-to-head key. See `HeadToHead`. */
  const h2h: HeadToHead = new Map(clubs.map((c) => [c.id, new Map<string, number>()]));
  const met = (a: string, b: string, result: number) => {
    h2h.get(a)?.set(b, result);
    h2h.get(b)?.set(a, -result);
  };

  for (const stageId of season) {
    for (const m of await leagueMeetings(eventId, stageId, system, matchBonus)) {
      add(points, m.clubAId, m.pointsA);
      add(points, m.clubBId, m.pointsB);
      add(played, m.clubAId, 1);
      add(played, m.clubBId, 1);

      /**
       * HOLES WON AND LOST, for the committee's countbacks — counted from
       * the same per-hole results the points come from, so the two can
       * never disagree about what happened on a hole.
       */
      for (const p of m.pairings) {
        const aIsHome = p.clubA === m.clubAId;
        for (const h of p.holes) {
          if (h === null || h === "H") continue;
          const homeWon = (h === "A") === aIsHome;
          add(homeWon ? holesWon : holesLost, m.clubAId, 1);
          add(homeWon ? holesLost : holesWon, m.clubBId, 1);
        }
      }

      // Won outright, and only once it is over.
      if (m.complete && m.pointsA > m.pointsB) {
        add(won, m.clubAId, 1);
        met(m.clubAId, m.clubBId, 1);
      } else if (m.complete && m.pointsB > m.pointsA) {
        add(won, m.clubBId, 1);
        met(m.clubAId, m.clubBId, -1);
      } else if (m.complete) {
        met(m.clubAId, m.clubBId, 0);
      }
    }
  }

  /**
   * Most points first, then the COMMITTEE'S OWN CHAIN — the one set on
   * Scoring & rules and applied to players by `tiebreakerCompare`. The
   * league table used to go straight to the club's name, so a four-way tie
   * at the top of a twelve-club league seeded the play-offs alphabetically.
   *
   * The same order the play-offs are seeded in, so the row above a club is
   * the club seeded above it. A tie on POINTS still shows as a shared place
   * — `placesByValue` works that out on the points alone, as every other
   * board does — and the columns beside it say what separated them.
   */
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  const chain = event ? scoringFrom(event).tiebreakers : [];
  const rows = orderClubs(
    clubs.map((c) => ({
      clubId: c.id,
      name: c.name,
      points: points.get(c.id) ?? 0,
      played: played.get(c.id) ?? 0,
      won: won.get(c.id) ?? 0,
      holesWon: holesWon.get(c.id) ?? 0,
      holesLost: holesLost.get(c.id) ?? 0,
    })),
    chain,
    h2h,
  );
  return { rows, orderNote: clubOrderNote(chain, tiebreakerLabel) };
}
