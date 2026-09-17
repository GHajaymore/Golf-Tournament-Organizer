import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { leagueMeetings, leagueTable } from "@/lib/services/league";
import { flightsIn } from "@/lib/services/league-nomination";

/**
 * A REAL WEEK OF AN INTERCLUB LEAGUE, AGAINST REAL ROWS.
 *
 * Twelve club teams, each fielding six pairs, every pair playing a four-ball
 * against an opposing pair — six meetings running at once on a shotgun, which
 * is 144 players on the course. Round robin, so every club meets every other
 * once.
 *
 * WHY THIS IS AN AUDIT TEST AND NOT A UNIT ONE. `league-meeting.test.ts`
 * proves the arithmetic on hand-made cards. This proves the thing that cannot
 * be checked without a database: that six meetings on ONE ROUND are kept
 * apart, that a pair is matched to its club through `clubGroupId`, and that
 * the scores come out of the same `aggregateTeamCard` every other four-ball in
 * the app uses.
 *
 * THE SHAPE IS THE TEST. Twelve clubs is not decoration — with two, a rule
 * that pooled every pairing in the round would still produce the right answer,
 * and the defect this is most likely to have is exactly that.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-league-week";

const CLUBS = 12;
const PAIRS_PER_CLUB = 6;

let eventId = "";
let stageId = "";
const clubId: string[] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A card where the side scores `s` on every hole. Lower wins. */
const flat = (s: number) => JSON.stringify(new Array(18).fill(s));

beforeAll(async () => {
  await cleanup();

  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} thursday night`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Four-Ball",
      holes: 18,
      scoringBasis: "gross",
      // Scratch, so the meeting is decided by the scores rather than by an
      // allowance this file is not about.
      handicapAllowance: 100,
    },
    select: { id: true },
  });
  stageId = stage.id;

  /**
   * TWELVE CLUBS, WHICH ARE FLIGHTS.
   *
   * A `Group` is already everything a league's club team is — named, belonging
   * to the tournament rather than a round, its roster is `Player.groupId`, and
   * it carries the optional captain the organizer appoints in flights setup.
   * A league is a tournament whose flights are clubs.
   */
  for (let c = 0; c < CLUBS; c += 1) {
    const club = await prisma.group.create({
      data: { eventId, name: `${TAG} club ${c}`, position: c },
      select: { id: true },
    });
    clubId.push(club.id);
  }

  /**
   * The fixtures' carrier, which is NOT one of the clubs.
   *
   * `Match.groupId` files a fixture; using a club's own flight for it would
   * make the carrier one of the competing sides and read as a club playing
   * host to its own matches.
   *
   * Marked as a carrier, and deliberately WITHOUT a stage — the legacy shape
   * `tournament.ts` still repairs — so `stageId: null` alone cannot keep it
   * out of the club list and only `isCarrier` can.
   */
  const carrier = await prisma.group.create({
    data: { eventId, name: `${TAG} fixtures`, position: CLUBS, isCarrier: true },
    select: { id: true },
  });

  /**
   * Six meetings: club 0 v 1, 2 v 3, and so on. Each meeting is six four-balls.
   * The EVEN club always scores 4s and the odd club 5s, so the even club wins
   * every hole of every pairing — an answer a wrong grouping cannot produce by
   * accident.
   */
  for (let m = 0; m < CLUBS / 2; m += 1) {
    const home = clubId[m * 2];
    const away = clubId[m * 2 + 1];

    for (let p = 0; p < PAIRS_PER_CLUB; p += 1) {
      const sides: string[] = [];
      for (const [which, parent] of [["home", home], ["away", away]] as const) {
        const side = await prisma.team.create({
          data: {
            eventId,
            stageId,
            name: `${TAG} m${m} p${p} ${which}`,
            seed: p + 1,
            clubGroupId: parent,
          },
          select: { id: true },
        });
        sides.push(side.id);

        // Two players a side — a four-ball.
        for (let i = 0; i < 2; i += 1) {
          const player = await prisma.player.create({
            data: {
              eventId,
              name: `${TAG} m${m}p${p}${which}${i}`,
              email: `${TAG}-m${m}p${p}${which}${i}@example.invalid`,
              handicap: 0,
              seed: 1,
              status: "confirmed",
              groupId: parent,
            },
            select: { id: true },
          });
          await prisma.teamMember.create({
            data: { teamId: side.id, playerId: player.id, position: i },
          });
          await prisma.teamScorecard.create({
            data: {
              eventId,
              stageId,
              teamId: side.id,
              playerId: player.id,
              strokes: flat(which === "home" ? 4 : 5),
            },
          });
        }
      }

      await prisma.match.create({
        data: {
          eventId,
          stageId,
          groupId: carrier.id,
          round: 1,
          playerAId: "",
          playerBId: "",
          teamAId: sides[0],
          teamBId: sides[1],
          holes: JSON.stringify(new Array(18).fill(null)),
        },
      });
    }
  }
}, 240_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("one week of a twelve-club league", () => {
  it("finds six meetings, not one big pool", async () => {
    /**
     * THE DEFECT MOST LIKELY TO EXIST. Six meetings run simultaneously on a
     * shotgun; a rule that read the round as one contest would hand a single
     * club every point on the night.
     */
    const meetings = await leagueMeetings(eventId, stageId, "match");
    expect(meetings).toHaveLength(CLUBS / 2);
  });

  it("puts six pairings in each meeting", async () => {
    const meetings = await leagueMeetings(eventId, stageId, "match");
    for (const m of meetings) {
      expect(m.pairings, `${m.clubAName} v ${m.clubBName}`).toHaveLength(PAIRS_PER_CLUB);
    }
  });

  it("gives the winning club all six points and the other none", async () => {
    /**
     * The even club scores 4s against 5s on every hole, so it wins all eighteen
     * of every pairing. Under match play a meeting is worth six points.
     */
    const meetings = await leagueMeetings(eventId, stageId, "match");
    for (const m of meetings) {
      const total = m.pointsA + m.pointsB;
      expect(total, "six four-balls, six points").toBe(PAIRS_PER_CLUB);
      expect(Math.max(m.pointsA, m.pointsB), "a clean sweep").toBe(PAIRS_PER_CLUB);
      expect(Math.min(m.pointsA, m.pointsB)).toBe(0);
    }
  });

  it("never pairs a club against itself", async () => {
    const meetings = await leagueMeetings(eventId, stageId, "match");
    for (const m of meetings) expect(m.clubAId).not.toBe(m.clubBId);
  });

  it("scores the same pairings differently under another system", async () => {
    /**
     * The control on the setting. Under "holes" a clean sweep is eighteen
     * holes rather than one point, so a service ignoring `system` and always
     * scoring match play reads the same under both.
     */
    const asHoles = await leagueMeetings(eventId, stageId, "holes");
    const sweep = Math.max(asHoles[0].pointsA, asHoles[0].pointsB);
    expect(sweep, "six pairings, eighteen holes each").toBe(PAIRS_PER_CLUB * 18);
  });
});

describe("the league table", () => {
  it("lists every club, including ones yet to score", async () => {
    // A league table with a missing team reads as a bug on a clubhouse screen.
    const table = await leagueTable(eventId, "match");
    expect(table).toHaveLength(CLUBS);
  });

  it("puts the six winners on six points and the six losers on none", async () => {
    const table = await leagueTable(eventId, "match");
    const winners = table.filter((r) => r.points === PAIRS_PER_CLUB);
    const losers = table.filter((r) => r.points === 0);
    expect(winners).toHaveLength(CLUBS / 2);
    expect(losers).toHaveLength(CLUBS / 2);
  });

  it("counts one meeting played for everybody", async () => {
    const table = await leagueTable(eventId, "match");
    for (const r of table) expect(r.played, r.name).toBe(1);
  });

  it("ranks the table by points", async () => {
    const table = await leagueTable(eventId, "match");
    for (let i = 1; i < table.length; i += 1) {
      expect(table[i - 1].points).toBeGreaterThanOrEqual(table[i].points);
    }
  });
});

describe("how many pairs a meeting should have is the LEAGUE's choice", () => {
  /**
   * Six is one club's number, not a rule. Some leagues play four a side, some
   * eight, and the app has no business insisting — so `Event.leaguePairs`
   * carries it and zero means nobody has said.
   *
   * It is stored at all because being SHORT is a state somebody must act on: a
   * captain who has nominated five of six needs telling on Thursday afternoon,
   * and no count of the rows can tell five deliberate pairings from six with
   * one missing.
   */
  it("says nothing when the league has not declared a number", async () => {
    // The default, and every tournament that exists today.
    await prisma.event.update({ where: { id: eventId }, data: { leaguePairs: 0 } });
    const meetings = await leagueMeetings(eventId, stageId, "match");
    expect(meetings.every((m) => m.short), "nobody declared a number").toBe(false);
  });

  it("is content when the meetings match the number", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { leaguePairs: PAIRS_PER_CLUB } });
    const meetings = await leagueMeetings(eventId, stageId, "match");
    expect(meetings.every((m) => m.short)).toBe(false);
    expect(meetings[0].expectedPairings).toBe(PAIRS_PER_CLUB);
  });

  it("flags every meeting as short when the league expects more", async () => {
    // A league of eight pairs, played with six.
    await prisma.event.update({ where: { id: eventId }, data: { leaguePairs: 8 } });
    const meetings = await leagueMeetings(eventId, stageId, "match");
    expect(meetings.every((m) => m.short), "six of eight is short").toBe(true);
    expect(meetings[0].pairings).toHaveLength(PAIRS_PER_CLUB);
  });

  it("does not complain about a meeting with MORE than expected", async () => {
    /**
     * Only fewer is a problem. An extra pairing is an organizer doing
     * something deliberate, and refusing it would be the app arguing with a
     * club about its own league.
     */
    await prisma.event.update({ where: { id: eventId }, data: { leaguePairs: 4 } });
    const meetings = await leagueMeetings(eventId, stageId, "match");
    expect(meetings.every((m) => m.short), "six of four is not short").toBe(false);
  });

  it("does not change the points, only what is said about them", async () => {
    /**
     * The control. A setting about the SHAPE must not touch the scoring — a
     * league that declares the wrong number would otherwise silently rescore
     * its own season.
     */
    await prisma.event.update({ where: { id: eventId }, data: { leaguePairs: 8 } });
    const short = await leagueMeetings(eventId, stageId, "match");
    await prisma.event.update({ where: { id: eventId }, data: { leaguePairs: PAIRS_PER_CLUB } });
    const exact = await leagueMeetings(eventId, stageId, "match");
    expect(short[0].pointsA).toBe(exact[0].pointsA);
    expect(short[0].pointsB).toBe(exact[0].pointsB);
  });
});

describe("an ordinary four-ball that is not league play", () => {
  it("is no meeting at all", async () => {
    /**
     * THE CONTROL FOR THE WHOLE FILE. Every four-ball in every ordinary
     * tournament has sides with no parent, and reading those as a league would
     * invent meetings across the entire app. The rule has to find nothing
     * here.
     */
    const plain = await prisma.event.create({
      data: {
        organizationId: (await prisma.organization.findFirstOrThrow({
          where: { name: { startsWith: TAG } },
          select: { id: true },
        })).id,
        name: `${TAG} ordinary fourball`,
        status: "live",
        shape: "series",
        format: "stroke",
        formationRule: "balanced",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: randomBytes(12).toString("hex"),
        registrationToken: randomBytes(8).toString("hex"),
      },
      select: { id: true },
    });
    const s = await prisma.stage.create({
      data: { eventId: plain.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 },
      select: { id: true },
    });
    // Two sides, no parents — exactly what every existing team in the app is.
    await prisma.team.create({ data: { eventId: plain.id, stageId: s.id, name: `${TAG} x`, seed: 1 } });
    await prisma.team.create({ data: { eventId: plain.id, stageId: s.id, name: `${TAG} y`, seed: 2 } });

    expect(await leagueMeetings(plain.id, s.id, "match"), "not a league").toEqual([]);
    expect(await leagueTable(plain.id, "match"), "and no table").toEqual([]);
  });

  it("lists the twelve clubs as the team sheets, and never the fixtures carrier", async () => {
    const ids = (await flightsIn(eventId)).map((c) => c.id);
    expect(ids).toEqual(clubId);
  });
});
