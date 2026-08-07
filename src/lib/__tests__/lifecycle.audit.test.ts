import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  aggregateTeamCard,
  singleBallTeamCard,
  teamMatchHoles,
  resolveMatch,
  playSkins,
  playNassau,
} from "../domain";
import { teamStandings, snakeDraw } from "../services/teams";
import { retentionDecision } from "../retention";
import { courseHandicapMap, holeStrokesReceived } from "../domain";
import { chainIssues } from "../format-chain";
import { staffSeatCount, activeEventCount } from "../services/limits";
import { clubCourses } from "../services/courses";
import { unratedWarning } from "../services/handicaps";

/**
 * End-to-end audit against the real database.
 *
 * Distinct from the unit suites: those prove each rule in isolation, this
 * proves the pieces still fit once Prisma, the schema constraints and the
 * cascades are involved. It builds a throwaway four-ball tournament, plays it,
 * reads the standings back, and deletes it — asserting no orphans survive.
 *
 * Excluded from the default run (`*.audit.test.ts`) because it needs a live
 * DATABASE_URL and writes real rows. Run deliberately:
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LIFECYCLE";
const PARS = Array(18).fill(4) as number[];
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

let eventId = "";
let stageId = "";
let orgId = "";
let sides: { id: string; handicap: number }[][] = [];
let teamIds: string[] = [];
let matchId = "";

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("no organization to attach to");
  orgId = org.id;

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} four-ball`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "draft",
      shape: "series",
      shareToken: `audit-${Date.now()}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(SI),
    },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Four-Ball",
      holes: 18,
      scoringBasis: "net",
    },
  });
  stageId = stage.id;

  const hcps = [4, 12, 8, 20];
  const players = [];
  for (let i = 0; i < 4; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId,
          name: `Audit ${i + 1}`,
          handicap: hcps[i],
          seed: i + 1,
          status: "confirmed",
          email: `audit${i}@example.invalid`,
        },
      }),
    );
  }

  sides = snakeDraw(players.map((x) => ({ id: x.id, handicap: x.handicap })), 2);
  for (let i = 0; i < sides.length; i += 1) {
    const t = await prisma.team.create({
      data: { eventId, stageId, name: `Side ${i + 1}`, seed: i + 1 },
    });
    await prisma.teamMember.createMany({
      data: sides[i].map((pl, pos) => ({ teamId: t.id, playerId: pl.id, position: pos })),
    });
    teamIds.push(t.id);
  }

  const group = await prisma.group.create({ data: { eventId, name: "Four-Ball", position: 0 } });
  const match = await prisma.match.create({
    data: {
      eventId,
      stageId,
      groupId: group.id,
      round: 1,
      playerAId: "",
      playerBId: "",
      teamAId: teamIds[0],
      teamBId: teamIds[1],
      holes: JSON.stringify(Array(18).fill(null)),
    },
  });
  matchId = match.id;

  for (const [ti, stroke] of [[0, 4], [1, 5]] as Array<[number, number]>) {
    for (const m of sides[ti]) {
      await prisma.teamScorecard.create({
        data: {
          eventId,
          stageId,
          teamId: teamIds[ti],
          matchId,
          playerId: m.id,
          strokes: JSON.stringify(Array(18).fill(stroke)),
        },
      });
    }
  }
}, 120_000);

afterAll(async () => {
  if (eventId) await prisma.event.deleteMany({ where: { id: eventId } });
  await prisma.$disconnect();
}, 60_000);

describe("setup writes what it claims", () => {
  it("stores the tournament shape", async () => {
    const e = await prisma.event.findUnique({ where: { id: eventId } });
    expect(e?.shape).toBe("series");
  });

  it("draws the most balanced pairs available", () => {
    // Handicaps 4, 8, 12, 20 cannot split evenly: the three possible pairings
    // give spreads of 4, 12 and 20. Asserting exact equality would be testing
    // an arithmetic accident rather than the algorithm, so this asserts the
    // snake picks the best split that exists.
    expect(sides.map((s) => s.length)).toEqual([2, 2]);
    const totals = sides.map((s) => s.reduce((t, x) => t + x.handicap, 0));
    const spread = Math.abs(totals[0] - totals[1]);

    const all = [4, 8, 12, 20];
    let best = Infinity;
    for (let i = 1; i < 4; i += 1) {
      const pair = [all[0], all[i]];
      const rest = all.filter((_, j) => j !== 0 && j !== i);
      best = Math.min(best, Math.abs(pair[0] + pair[1] - (rest[0] + rest[1])));
    }
    expect(spread).toBe(best);
  });

  it("puts the teams on the match and leaves the player columns empty", async () => {
    const m = await prisma.match.findUnique({ where: { id: matchId } });
    expect(m?.teamAId).toBe(teamIds[0]);
    expect(m?.teamBId).toBe(teamIds[1]);
    expect([m?.playerAId, m?.playerBId]).toEqual(["", ""]);
  });

  it("stores one card per partner", async () => {
    expect(await prisma.teamScorecard.count({ where: { stageId } })).toBe(4);
  });
});

describe("schema constraints hold against real writes", () => {
  it("refuses a second card for the same partner in the same match", async () => {
    await expect(
      prisma.teamScorecard.create({
        data: { eventId, stageId, teamId: teamIds[0], matchId, playerId: sides[0][0].id, strokes: "[]" },
      }),
    ).rejects.toThrow();
  });

  it("refuses the same player on a side twice", async () => {
    await expect(
      prisma.teamMember.create({ data: { teamId: teamIds[0], playerId: sides[0][0].id, position: 9 } }),
    ).rejects.toThrow();
  });
});

describe("scoring the round", () => {
  const cardFor = (i: number, stroke: number) =>
    aggregateTeamCard(
      sides[i].map((m) => ({
        playerId: m.id,
        strokes: Array(18).fill(stroke),
        courseHandicap: m.handicap,
      })),
      PARS,
      SI,
      90,
    );

  it("resolves a four-ball as a match the singles engine understands", () => {
    const res = resolveMatch(teamMatchHoles(cardFor(0, 4), cardFor(1, 5)));
    expect(res.holesWonA).toBe(18);
    expect(res.winner).toBe("A");
    expect(res.resultText.length).toBeGreaterThan(0);
  });

  it("ranks the sides from the stored cards", async () => {
    const rows = await teamStandings(eventId, stageId, "Four-Ball", PARS, SI, "net", 0);
    expect(rows).toHaveLength(2);
    expect(rows[0].net).toBeLessThanOrEqual(rows[1].net);
    expect(rows[0].playingHandicap).toBeGreaterThanOrEqual(0);
    expect(rows[0].played).toBe(18);
  });

  it("honours a committee allowance override in the standings", async () => {
    const standard = await teamStandings(eventId, stageId, "Four-Ball", PARS, SI, "net", 0);
    const generous = await teamStandings(eventId, stageId, "Four-Ball", PARS, SI, "net", 100);
    expect(generous[0].net).not.toBe(standard[0].net);
  });
});

describe("the other format engines", () => {
  it("carries skins across tied holes", () => {
    const out = playSkins(
      [
        { playerId: "a", strokes: [4, 4, 3], courseHandicap: 0 },
        { playerId: "b", strokes: [4, 4, 4], courseHandicap: 0 },
      ],
      3,
    );
    expect(out.holes[2].value).toBe(3);
  });

  it("splits a Nassau into three bets", () => {
    const n = playNassau(
      ([] as ("A" | "B")[]).concat(Array(9).fill("A"), Array(9).fill("B")),
    );
    expect(n.segments).toHaveLength(3);
    expect(n.segments[2].result!.winner).toBe("H");
  });

  it("scores a shared-ball card", () => {
    expect(singleBallTeamCard(Array(18).fill(4), PARS, 0, SI).grossTotal).toBe(72);
  });
});

describe("cross-cutting rules", () => {
  it("flags an incompatible chain into the next round", () => {
    const issues = chainIssues([
      { position: 0, format: "Four-Ball", scoringBasis: "net", carryForwardEnabled: false, cutEnabled: false },
      { position: 1, format: "Stroke Play", scoringBasis: "gross", carryForwardEnabled: true, cutEnabled: true },
    ]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.kind === "cut-team-to-individual")).toBe(true);
  });

  it("never selects a running tournament for deletion", () => {
    expect(
      retentionDecision({ id: eventId, status: "draft", completedAt: null, plan: "free" }).purge,
    ).toBe(false);
  });

  it("selects a finished free tournament past its window", () => {
    expect(
      retentionDecision({
        id: "x",
        status: "completed",
        completedAt: new Date(Date.now() - 60 * 3600e3),
        plan: "free",
      }).purge,
    ).toBe(true);
  });

  it("keeps the demo tournament held", async () => {
    const demo = await prisma.event.findFirst({ where: { name: { contains: "Ajay More" } } });
    expect(demo?.retainUntil).not.toBeNull();
    expect(
      retentionDecision({
        id: demo!.id,
        status: "completed",
        completedAt: new Date(Date.now() - 1000 * 3600e3),
        plan: "free",
        retainUntil: demo!.retainUntil,
      }).purge,
    ).toBe(false);
  });

  it("counts a per-event organizer as a staff seat", async () => {
    // The seat rule that matters: per-event Accounts count, not just club
    // membership, or the limit is bypassed by granting roles event by event.
    const before = await staffSeatCount(orgId);
    await prisma.account.create({
      data: { eventId, name: "Audit Organizer", email: "audit-staff@example.invalid", role: "admin" },
    });
    expect(await staffSeatCount(orgId)).toBe(before + 1);
  });

  it("does not count a player as a staff seat", async () => {
    const before = await staffSeatCount(orgId);
    await prisma.account.create({
      data: { eventId, name: "Audit Player", email: "audit-player@example.invalid", role: "player" },
    });
    expect(await staffSeatCount(orgId)).toBe(before);
  });

  it("counts the tournament as active while it is unfinished", async () => {
    expect(await activeEventCount(orgId)).toBeGreaterThanOrEqual(1);
  });
});

describe("teardown leaves nothing behind", () => {
  it("cascades every child row", async () => {
    await prisma.event.delete({ where: { id: eventId } });
    const orphans = {
      players: await prisma.player.count({ where: { eventId } }),
      teams: await prisma.team.count({ where: { eventId } }),
      teamCards: await prisma.teamScorecard.count({ where: { eventId } }),
      matches: await prisma.match.count({ where: { eventId } }),
      groups: await prisma.group.count({ where: { eventId } }),
      stages: await prisma.stage.count({ where: { eventId } }),
      teamMembers: await prisma.teamMember.count({ where: { teamId: { in: teamIds } } }),
      accounts: await prisma.account.count({ where: { eventId } }),
    };
    expect(orphans).toEqual({
      players: 0,
      teams: 0,
      teamCards: 0,
      matches: 0,
      groups: 0,
      stages: 0,
      teamMembers: 0,
      accounts: 0,
    });
    eventId = "";
  });

  it("leaves the club roster intact", async () => {
    expect(await prisma.member.count()).toBeGreaterThan(0);
  });
});

describe("Course Handicap changes real strokes end to end", () => {
  let courseId = "";
  let hardTeeId = "";
  let easyTeeId = "";

  it("creates a rated course with two very different sets of tees", async () => {
    const course = await prisma.course.create({
      data: {
        organizationId: orgId,
        name: `${TAG} rated course`,
        city: "",
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(Array(18).fill(400)),
        strokeIndex: JSON.stringify(SI),
      },
    });
    courseId = course.id;

    const hard = await prisma.tee.create({
      data: { courseId, name: "Championship", courseRating: 74.5, slopeRating: 145, par: 72, position: 0 },
    });
    const easy = await prisma.tee.create({
      data: { courseId, name: "Forward", courseRating: 66.8, slopeRating: 95, par: 72, position: 1 },
    });
    hardTeeId = hard.id;
    easyTeeId = easy.id;
    expect(await prisma.tee.count({ where: { courseId } })).toBe(2);
  });

  it("gives the same index materially more strokes off the harder tees", async () => {
    // The whole point. A 14.0 index is not worth 14 strokes everywhere, and
    // a member-guest with mixed tees cannot be settled fairly without this.
    const tees = await prisma.tee.findMany({ where: { courseId } });
    const ratings = new Map(
      tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
    );
    const field = [
      { id: "off-hard", handicap: 14.0, teeId: hardTeeId },
      { id: "off-easy", handicap: 14.0, teeId: easyTeeId },
    ];
    const map = courseHandicapMap(field, ratings, null, 18);

    const hard = map.get("off-hard")!;
    const easy = map.get("off-easy")!;
    expect(hard).toBeGreaterThan(14);
    expect(easy).toBeLessThan(14);
    expect(hard - easy).toBeGreaterThanOrEqual(6);
  });

  it("allocates those extra strokes to real holes", async () => {
    const tees = await prisma.tee.findMany({ where: { courseId } });
    const ratings = new Map(
      tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
    );
    const map = courseHandicapMap([{ id: "p", handicap: 14.0, teeId: hardTeeId }], ratings, null, 18);
    const ch = map.get("p")!;
    const total = SI.reduce((sum, si) => sum + holeStrokesReceived(ch, si), 0);
    expect(total).toBe(ch);
    // A stroke index that gets nothing off a raw 14 does get one off the
    // championship tees, which is the shot the old code was losing.
    expect(holeStrokesReceived(14, 17)).toBe(0);
    expect(holeStrokesReceived(ch, 17)).toBe(1);
  });

  it("leaves an unrated tee scoring exactly as before", async () => {
    const plain = await prisma.tee.create({
      data: { courseId, name: "Unrated", slopeRating: 0, courseRating: 0, par: 72, position: 2 },
    });
    const map = courseHandicapMap(
      [{ id: "p", handicap: 14.4, teeId: plain.id }],
      new Map([[plain.id, { courseRating: 0, slopeRating: 0, par: 72 }]]),
      null,
      18,
    );
    expect(map.get("p")).toBe(14);
  });

  it("cleans up the course and nulls nobody's entry", async () => {
    await prisma.course.delete({ where: { id: courseId } });
    expect(await prisma.tee.count({ where: { courseId } })).toBe(0);
    courseId = "";
  });
});

describe("the tee editor's data path works end to end", () => {
  let courseId = "";

  it("surfaces tees on the course library the editor renders from", async () => {
    const course = await prisma.course.create({
      data: {
        organizationId: orgId,
        name: `${TAG} library course`,
        city: "",
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(Array(18).fill(400)),
        strokeIndex: JSON.stringify(SI),
      },
    });
    courseId = course.id;
    await prisma.tee.create({
      data: { courseId, name: "Blue", courseRating: 71.5, slopeRating: 125, par: 72, position: 0 },
    });
    await prisma.tee.create({
      data: { courseId, name: "Yellow", slopeRating: 0, courseRating: 0, par: 72, position: 1 },
    });

    const rows = await clubCourses(orgId, "no-such-event");
    const mine = rows.find((c) => c.id === courseId)!;
    expect(mine.tees.map((t) => t.name)).toEqual(["Blue", "Yellow"]);
    expect(mine.tees.find((t) => t.name === "Blue")!.rated).toBe(true);
    expect(mine.tees.find((t) => t.name === "Yellow")!.rated).toBe(false);
  });

  it("warns about the unrated set by name, and only for net scoring", async () => {
    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} warn`,
        dates: "", course: "", city: "", address: "", regDeadline: "",
        capacity: 0, status: "draft", shareToken: `audit-warn-${Date.now()}`,
      },
    });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId } });

    expect(await unratedWarning(event.id, "gross")).toBeNull();
    const net = await unratedWarning(event.id, "net");
    expect(net).toContain("Yellow");
    expect(net).not.toContain("Blue");

    await prisma.event.delete({ where: { id: event.id } });
  });

  it("says nothing once every set is rated", async () => {
    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} rated`,
        dates: "", course: "", city: "", address: "", regDeadline: "",
        capacity: 0, status: "draft", shareToken: `audit-rated-${Date.now()}`,
      },
    });
    await prisma.tee.updateMany({ where: { courseId, slopeRating: 0 }, data: { slopeRating: 113, courseRating: 70 } });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId } });
    expect(await unratedWarning(event.id, "net")).toBeNull();
    await prisma.event.delete({ where: { id: event.id } });
  });

  it("removes the course and its tees together", async () => {
    await prisma.course.delete({ where: { id: courseId } });
    expect(await prisma.tee.count({ where: { courseId } })).toBe(0);
    courseId = "";
  });
});
