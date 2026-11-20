import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A LEAGUE WEEK PLAYED AS FOURSOMES IS PRICED OFF THE SIDES' HANDICAPS, NOT SCRATCH.
 *
 * Backlog J22 (confirmed 2026-11-03). `drawLeagueWeek` accepts any team format,
 * and `leagueMeetings` priced each card by its player. A foursomes side returns
 * ONE card, filed under no player, so both sides of every pairing played off
 * nought: the league table, its holes-won countback and the play-off seeding
 * were decided at scratch while the side's own card gave strokes.
 *
 * The fixture: one rated set (the USGA's own example, 71.0 / 125, par 71), two
 * clubs, one foursomes pairing, and a four on every hole for both sides — so
 * the match turns entirely on the strokes. Worked from the Rules, by hand:
 *
 *   Rule 6.1    8.6 x 125/113 =  9.513     10.3 x 125/113 = 11.394
 *               20.4 x 125/113 = 22.566    24.0 x 125/113 = 26.549
 *   App. C      foursomes: 50% of the side's combined, UNROUNDED (Rule 6.2a)
 *               club A: 20.907 / 2 = 10.45 -> 10   (rounding each partner
 *                                                 first: 21 / 2 = 10.5 -> 11)
 *               club B: 49.115 / 2 = 24.56 -> 25   (rounding first: 50 / 2 = 25)
 *   match play  off the low SIDE: club B receives 25 - 10 = 15 strokes, on the
 *               holes of stroke index 1-15 (here, holes 1-15). Level gross, so
 *               B's net 3 beats A's 4 on each of them and 16-18 are halved.
 *
 * Chosen so that rounding each partner first moves ONE side only (A to 11,
 * B stays 25), which gives B fourteen and halves the 15th. A first draft had
 * both sides move up by one, kept the difference at fifteen, and let that
 * mutation through.
 *
 *   npx vitest run --config vitest.audit.config.ts league-shared-ball
 */

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { leagueMeetings, leagueTable } from "@/lib/services/league";

const prisma = new PrismaClient();
const TAG = "zz-league-shared-ball";

// Stroke index 1..18, so a hole's number is its difficulty; par 4 throughout.
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const PARS = new Array(18).fill(4);
const flat = (s: number) => JSON.stringify(new Array(18).fill(s));

let eventId = "";
let stageId = "";
let clubAId = "";
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
      format: "Foursomes",
      holes: 18,
      scoringBasis: "net",
      // Nought: the committee has said nothing, so Appendix C's 50% applies.
      handicapAllowance: 0,
      courseId: course.id,
    },
    select: { id: true },
  });
  stageId = stage.id;

  const clubA = await prisma.group.create({ data: { eventId, name: `${TAG} club A`, position: 0 }, select: { id: true } });
  const clubB = await prisma.group.create({ data: { eventId, name: `${TAG} club B`, position: 1 }, select: { id: true } });
  const carrier = await prisma.group.create({
    data: { eventId, name: `${TAG} fixtures`, position: 2, isCarrier: true },
    select: { id: true },
  });
  clubAId = clubA.id;
  clubBId = clubB.id;

  const sideSpecs = [
    { club: clubA.id, tag: "A", indexes: [8.6, 10.3] },
    { club: clubB.id, tag: "B", indexes: [20.4, 24.0] },
  ];
  const sideId: string[] = [];
  for (const spec of sideSpecs) {
    const side = await prisma.team.create({
      data: { eventId, stageId, name: `${TAG} ${spec.tag}`, seed: 1, clubGroupId: spec.club },
      select: { id: true },
    });
    sideId.push(side.id);
    for (let i = 0; i < spec.indexes.length; i += 1) {
      const p = await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${spec.tag}${i}`,
          email: `${TAG}.${spec.tag}${i}@example.invalid`,
          handicap: spec.indexes[i],
          handicapType: "18",
          seed: 1,
          status: "confirmed",
          groupId: spec.club,
        },
        select: { id: true },
      });
      await prisma.teamMember.create({ data: { teamId: side.id, playerId: p.id, position: i } });
    }
    // ONE card for the side, filed under no player — how a shared ball is kept.
    await prisma.teamScorecard.create({
      data: { eventId, stageId, teamId: side.id, playerId: "", strokes: flat(4) },
    });
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

/** Club B's letter in the one pairing, and the per-hole results. */
async function thePairing() {
  const meetings = await leagueMeetings(eventId, stageId, "holes");
  expect(meetings).toHaveLength(1);
  expect(meetings[0].pairings).toHaveLength(1);
  const p = meetings[0].pairings[0];
  const b = p.clubB === clubBId ? "B" : "A";
  return { holes: p.holes, b };
}

describe("a league week on foursomes is priced by Appendix C", () => {
  it("club B's side (25) receives fifteen strokes from club A's (10), on the hardest fifteen holes", async () => {
    const { holes, b } = await thePairing();
    // Holes 1-15 are stroke index 1-15: B's net 3 against A's net 4.
    expect(holes.slice(0, 15), "the fifteen holes B receives a stroke on").toEqual(new Array(15).fill(b));
    // Hole 15 is the stroke A playing off 11 (each partner rounded first) would take back.
    expect(holes.slice(15), "level on the three holes nobody receives a stroke").toEqual(["H", "H", "H"]);
  });

  it("and the league table counts them: B 15 holes won, A 15 lost — not nought on a scratch match", async () => {
    const table = await leagueTable(eventId, "holes");
    const row = (id: string) => table.rows.find((r) => r.clubId === id)!;
    expect(row(clubBId).holesWon).toBe(15);
    expect(row(clubBId).holesLost).toBe(0);
    expect(row(clubAId).holesWon).toBe(0);
    expect(row(clubAId).holesLost).toBe(15);
  });

  it("the committee's own allowance wins: at 40%, A plays off 8 and B off 20, so twelve holes", async () => {
    // 40% of 20.907 = 8.36 -> 8; 40% of 49.115 = 19.65 -> 20; difference 12.
    await prisma.stage.update({ where: { id: stageId }, data: { handicapAllowance: 40 } });
    try {
      const { holes, b } = await thePairing();
      expect(holes.slice(0, 12)).toEqual(new Array(12).fill(b));
      expect(holes.slice(12)).toEqual(new Array(6).fill("H"));
    } finally {
      await prisma.stage.update({ where: { id: stageId }, data: { handicapAllowance: 0 } });
    }
  });
});
