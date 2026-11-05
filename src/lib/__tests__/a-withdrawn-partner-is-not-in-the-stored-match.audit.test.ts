import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE STORED MATCH PRICES A SIDE OFF THE PARTNERS WHO PLAY.
 *
 * `recomputeTeamMatch` files a team match's result from the sides' cards. On a
 * shared ball it handed EVERY member's figure to `sidePlayingHandicap`, so a
 * partner who had withdrawn still made up the side's handicap — while the
 * Teams screen and the league table, through `partnersWhoPlay`, left them out.
 *
 * The fixture: tees 71.0 / 125, par 71 (so Course Handicap = Index x 125/113),
 * stroke index 1-18 on holes 1-18, a scramble match between two sides of
 * three, a four on every hole for both. Worked from the Rules, by hand:
 *
 *   side A  4.3 -> 4.757   11.8 -> 13.053   26.7 -> 29.535 (WITHDRAWN)
 *           Appendix C, scramble of two: 0.35 x 4.757 + 0.15 x 13.053
 *             = 1.665 + 1.958 = 3.62 -> 4
 *           (counting the withdrawn partner, a three at 30/20/10:
 *             1.427 + 2.611 + 2.954 = 6.99 -> 7)
 *   side B  9.4 -> 10.398  15.2 -> 16.814   21.6 -> 23.894
 *           30/20/10: 3.119 + 3.363 + 2.389 = 8.87 -> 9
 *   match   off the low side: B receives 9 - 4 = FIVE strokes, on holes 1-5,
 *           and wins them on level gross; 6-18 are halved. Counting the
 *           withdrawn partner gives B two, and B wins holes 1-2 only.
 *
 *   npx vitest run --config vitest.audit.config.ts a-withdrawn-partner
 */

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { recomputeTeamMatch } from "@/lib/services/match-from-cards";

const prisma = new PrismaClient();
const TAG = "zz-withdrawn-partner-match";

const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const PARS = new Array(18).fill(4);
const flat = (s: number) => JSON.stringify(new Array(18).fill(s));

let eventId = "";
let stageId = "";
let match = { id: "", stageId: "", teamAId: "", teamBId: "" };

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
      name: `${TAG} saturday`,
      status: "live",
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
      teePolicy: "one",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });
  const tee = await prisma.tee.create({
    data: { courseId: course.id, name: `${TAG} whites`, courseRating: 71.0, slopeRating: 125, par: 71, position: 0 },
  });
  await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: tee.id } });

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Scramble",
      holes: 18,
      scoringBasis: "net",
      // The committee has said nothing: Appendix C's table applies.
      handicapAllowance: 0,
      courseId: course.id,
    },
    select: { id: true },
  });
  stageId = stage.id;

  const sides = [
    { tag: "A", players: [{ index: 4.3 }, { index: 11.8 }, { index: 26.7, withdrawn: true }] },
    { tag: "B", players: [{ index: 9.4 }, { index: 15.2 }, { index: 21.6 }] },
  ];
  const sideId: string[] = [];
  for (const spec of sides) {
    const side = await prisma.team.create({
      data: { eventId, stageId, name: `${TAG} ${spec.tag}`, seed: 1 },
      select: { id: true },
    });
    sideId.push(side.id);
    for (let i = 0; i < spec.players.length; i += 1) {
      const p = await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${spec.tag}${i}`,
          email: `${TAG}.${spec.tag}${i}@example.invalid`,
          handicap: spec.players[i].index,
          handicapType: "18",
          seed: 1,
          status: "withdrawn" in spec.players[i] ? "withdrawn" : "confirmed",
        },
        select: { id: true },
      });
      await prisma.teamMember.create({ data: { teamId: side.id, playerId: p.id, position: i } });
    }
  }
  // A match is filed under a group; the fixtures' carrier, as a round's draw makes.
  const carrier = await prisma.group.create({
    data: { eventId, name: `${TAG} fixtures`, position: 0, isCarrier: true },
    select: { id: true },
  });
  const row = await prisma.match.create({
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
    select: { id: true },
  });
  match = { id: row.id, stageId, teamAId: sideId[0], teamBId: sideId[1] };
  // ONE card per side, filed under no player and against this match.
  for (const teamId of sideId) {
    await prisma.teamScorecard.create({
      data: { eventId, stageId, teamId, matchId: row.id, playerId: "", strokes: flat(4) },
    });
  }
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

async function storedHoles(): Promise<("A" | "B" | "H" | null)[]> {
  await recomputeTeamMatch(eventId, match, "Scramble", 18, { name: "The committee", playerId: "" });
  const row = await prisma.match.findUniqueOrThrow({ where: { id: match.id }, select: { holes: true } });
  return JSON.parse(row.holes);
}

describe("the stored match leaves a withdrawn partner out of the side's handicap", () => {
  it("B (9) receives five strokes from A (4, a scramble of two), and wins holes 1-5 — not 1-2", async () => {
    const holes = await storedHoles();
    expect(holes.slice(0, 5), "the five holes B receives a stroke on").toEqual(["B", "B", "B", "B", "B"]);
    // Holes 3-5 are the CONTROL: counting the withdrawn 26.7 (A off 7) gives B
    // two strokes, and these three would be halved.
    expect(holes.slice(5), "level on the thirteen holes nobody receives a stroke").toEqual(new Array(13).fill("H"));
  });

  it("CONTROL: with the partner reinstated, A is a scramble of three off 7 and B receives two", async () => {
    const withdrawn = await prisma.player.findFirstOrThrow({
      where: { eventId, status: "withdrawn" },
      select: { id: true },
    });
    await prisma.player.update({ where: { id: withdrawn.id }, data: { status: "confirmed" } });
    try {
      const holes = await storedHoles();
      expect(holes.slice(0, 2)).toEqual(["B", "B"]);
      expect(holes.slice(2)).toEqual(new Array(16).fill("H"));
    } finally {
      await prisma.player.update({ where: { id: withdrawn.id }, data: { status: "withdrawn" } });
    }
  });
});
