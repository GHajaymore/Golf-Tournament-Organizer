import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { memberHandicapRecord } from "@/lib/services/handicap-record";

/**
 * A DIFFERENTIAL IS WORKED FROM THE TEES THE ROUND WAS PLAYED OFF — AT THE
 * COURSE IT WAS PLAYED ON.
 *
 * Rules of Handicapping, Rule 5.1: a score differential is (113 / Slope Rating)
 * × (adjusted gross score − Course Rating), from the tees played. It goes into
 * a member's index and stays there, so a rating from the wrong course is the
 * one mistake the club cannot later correct by re-scoring.
 *
 * The board prices a round through `teeForPlay`: the round's own tees, then the
 * tournament's, then a set ON THE COURSE BEING PLAYED. The record asked
 * `teeIdFor` with the tournament's default tees and the tournament's own course
 * — so on a round played away, the away course's tees were refused as "not on
 * this course" and the home set was used. Measured below, before the fix.
 *
 * Three cards, all 90 on a par-72 card (fives on fours: no hole reaches net
 * double bogey, so the adjusted gross is the gross), dated in order:
 *
 *   away, no tees named   Ardmore White 74.0 / 135   (113/135)(90 − 74) = 13.39 → 13.4
 *   away, the round's own Carrick Red   70.0 / 115   (113/115)(90 − 70) = 19.65 → 19.7
 *                          (Carrick also has Gold, which the fallback would take)
 *   home — the CONTROL    Braid White   68.0 / 113   (113/113)(90 − 68) = 22.0
 *
 *   npx vitest run --config vitest.audit.config.ts
 */
const prisma = new PrismaClient();
const TAG = "zz-diff-round-tees";
const PARS = new Array(18).fill(4);
let orgId = "";
let memberId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  if (ids.length) {
    const courses = await prisma.course.findMany({ where: { organizationId: { in: ids } }, select: { id: true } });
    await prisma.tee.deleteMany({ where: { courseId: { in: courses.map((c) => c.id) } } });
    await prisma.course.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.member.deleteMany({ where: { organizationId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  }
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  const course = async (name: string) =>
    (
      await prisma.course.create({
        data: { organizationId: orgId, name: `${TAG} ${name}`, city: "", pars: JSON.stringify(PARS), yards: JSON.stringify(new Array(18).fill(400)), strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)) },
        select: { id: true },
      })
    ).id;
  const tee = async (courseId: string, name: string, courseRating: number, slopeRating: number) =>
    (await prisma.tee.create({ data: { courseId, name, courseRating, slopeRating, par: 72 }, select: { id: true } })).id;

  const braid = await course("Braid Hollow");
  const ardmore = await course("Ardmore");
  const carrick = await course("Carrick");
  const braidWhite = await tee(braid, "White", 68.0, 113);
  await tee(ardmore, "White", 74.0, 135);
  await tee(carrick, "Gold", 72.0, 125);
  const carrickRed = await tee(carrick, "Red", 70.0, 115);

  memberId = (
    await prisma.member.create({ data: { organizationId: orgId, name: `${TAG} Morven Lyle`, email: `${TAG}-morven@example.invalid`, handicap: 10 }, select: { id: true } })
  ).id;

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} Autumn Series`,
      status: "live",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
      courseId: braid,
      defaultTeeId: braidWhite,
    },
    select: { id: true },
  });
  for (const c of [braid, ardmore, carrick]) await prisma.eventCourse.create({ data: { eventId: event.id, courseId: c } });
  const player = await prisma.player.create({
    data: { eventId: event.id, memberId, name: `${TAG} Morven Lyle`, email: `${TAG}-morven@example.invalid`, handicap: 10, seed: 1, status: "confirmed" },
    select: { id: true },
  });
  const rounds: Array<{ on: string; courseId?: string; teeId?: string }> = [
    { on: "2026-09-01", courseId: ardmore },
    { on: "2026-09-08", courseId: carrick, teeId: carrickRed },
    { on: "2026-09-15" },
  ];
  for (const [i, r] of rounds.entries()) {
    const stage = await prisma.stage.create({
      data: { eventId: event.id, position: i, description: `Round ${i + 1}`, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross", playedOn: r.on, ...(r.courseId ? { courseId: r.courseId } : {}), ...(r.teeId ? { teeId: r.teeId } : {}) },
      select: { id: true },
    });
    await prisma.scorecard.create({ data: { eventId: event.id, stageId: stage.id, playerId: player.id, strokes: JSON.stringify(new Array(18).fill(5)), status: "approved" } });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a member's record", () => {
  it("works each differential from the tees of the course that round was played on", async () => {
    const record = await memberHandicapRecord(orgId, memberId);
    expect(record?.cardsFound).toBe(3);
    const [away, own, home] = record!.differentials;
    expect(home, "CONTROL: a round at home, off the tournament's tees").toBeCloseTo(22.0, 1);
    expect(away, "a round away was rated off the home course's tees").toBeCloseTo(13.4, 1);
    expect(own, "a round that named its own tees was rated off others").toBeCloseTo(19.7, 1);
  });
});
