import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * AN INTERCLUB LEAGUE FOUR-BALL IS PRICED OFF THE COURSE HANDICAP, LIKE EVERY
 * OTHER READER OF THE SAME MATCH.
 *
 * `leagueMeetings` scored the match off `Player.handicap` — the roster INDEX,
 * applying only the allowance — while the stored result (`recomputeTeamMatch`),
 * the score-entry dots and the printed card convert to the Course Handicap
 * first. On a rated tee those are different numbers, and because a team match
 * takes its strokes off the LOWEST handicap in the four and allocates them per
 * hole, the difference lands on the hardest holes and flips hole winners — so
 * the league table, the holes-won tiebreak and the play-off seeding were scored
 * off a figure the members' own cards never used.
 *
 * `league-week.audit.test.ts` cannot see this: it plays scratch (handicap 0) off
 * unrated tees, where index and Course Handicap coincide. This one gives one
 * player a real index on a slope-140 tee, so the two diverge, and pins that the
 * meeting reads the Course-Handicap answer.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { leagueMeetings } from "@/lib/services/league";

const prisma = new PrismaClient();
const TAG = "zz-league-coursehcp";

// Stroke index 1..18, so a hole's number is its difficulty; par 4 throughout.
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const PARS = new Array(18).fill(4);
const flat = (s: number) => JSON.stringify(new Array(18).fill(s));

/** Slope 140, rating = par: the only thing separating index from Course
 *  Handicap is the slope. Index 10 → Course Handicap round(10 x 140/113) = 12. */
const SLOPE = 155;
const RATING = 72;

let eventId = "";
let stageId = "";
let clubBId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });

  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} thursday`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `${TAG}-${process.pid}`,
      registrationToken: `${TAG}r-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      // One set of tees for everyone, so the conversion is unambiguous.
      teePolicy: "single",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });

  const tee = await prisma.tee.create({
    data: { courseId: course.id, name: `${TAG} blues`, courseRating: RATING, slopeRating: SLOPE, par: 72, position: 0 },
  });
  await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: tee.id } });

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Four-Ball",
      holes: 18,
      scoringBasis: "gross",
      handicapAllowance: 100,
      courseId: course.id,
    },
    select: { id: true },
  });
  stageId = stage.id;

  const clubA = await prisma.group.create({ data: { eventId, name: `${TAG} club A`, position: 0 }, select: { id: true } });
  const clubB = await prisma.group.create({ data: { eventId, name: `${TAG} club B`, position: 1 }, select: { id: true } });
  const carrier = await prisma.group.create({ data: { eventId, name: `${TAG} fixtures`, position: 2, isCarrier: true }, select: { id: true } });
  clubBId = clubB.id;

  // Side A: two scratch players. Side B: one scratch and one 10-index — the one
  // the slope conversion moves (index 10 -> Course Handicap 12). Everyone plays
  // a flat 4, so the match turns entirely on who receives a stroke where.
  const sideSpecs = [
    { club: clubA.id, tag: "A", players: [0, 0] },
    { club: clubB.id, tag: "B", players: [0, 10] },
  ];
  const sideId: string[] = [];
  for (const spec of sideSpecs) {
    const side = await prisma.team.create({
      data: { eventId, stageId, name: `${TAG} ${spec.tag}`, seed: 1, clubGroupId: spec.club },
      select: { id: true },
    });
    sideId.push(side.id);
    for (let i = 0; i < spec.players.length; i += 1) {
      const p = await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${spec.tag}${i}`,
          email: `${TAG}.${spec.tag}${i}@example.invalid`,
          handicap: spec.players[i],
          handicapType: "18",
          seed: 1,
          status: "confirmed",
          groupId: spec.club,
        },
        select: { id: true },
      });
      await prisma.teamMember.create({ data: { teamId: side.id, playerId: p.id, position: i } });
      await prisma.teamScorecard.create({
        data: { eventId, stageId, teamId: side.id, playerId: p.id, strokes: flat(4) },
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
      teamAId: sideId[0],
      teamBId: sideId[1],
      holes: JSON.stringify(new Array(18).fill(null)),
    },
  });
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a league four-ball is scored off the Course Handicap", () => {
  it("prices off the Course Handicap — the result moves with the tee's slope", async () => {
    const holesForB = async () => {
      const meetings = await leagueMeetings(eventId, stageId, "holes");
      expect(meetings).toHaveLength(1);
      const m = meetings[0];
      return m.clubBId === clubBId ? m.pointsB : m.pointsA;
    };

    // Slope 155: the 10-index player's Course Handicap is round(10 x 155/113) =
    // 14 — four strokes more than his raw index would give, so those strokes
    // reach four more holes and flip them.
    const rated = await holesForB();

    // Flatten the slope to 113 and the rating to par: a Course Handicap then
    // EQUALS the raw index. If the league scored off the raw index all along,
    // nothing about the result can change.
    await prisma.tee.updateMany({
      where: { course: { events: { some: { eventId } } } },
      data: { slopeRating: 113, courseRating: 72 },
    });
    const neutral = await holesForB();

    // The holes moved when the slope did — impossible off the raw index.
    // Reverting the fix (scoring off Player.handicap) makes these equal and
    // turns this red.
    expect(rated, "holes won under a rated tee vs a neutral one").not.toBe(neutral);
  });
});
