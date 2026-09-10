import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { weekViewFor } from "@/lib/services/week-view";

/**
 * Whether the night is finished, which the week sheet could not say.
 *
 * The sheet drops anybody who did not play — right for the ranking, and the
 * comment on that filter says exactly why: somebody who did not play this week
 * is not last, they are absent. What it left was a row count, and a row count
 * is the same sentence on two different nights. Sixteen rows on a week
 * eighteen were in for is two cards outstanding and somebody to ring; sixteen
 * rows on a week sixteen were in for is done.
 *
 * `weekReturnsNote` does the wording and is unit-tested. What needs real rows
 * is the COUNTING: `expected` comes from resolving the mode against explicit
 * rows AND their absence, `returned` from cards aggregated to a `thru`, and
 * the interesting cases are the ones no fixture of stored rows can express —
 * a player who is out by saying nothing, and a card from somebody who was not
 * expected at all.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WEEKRET";
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const A_ROUND = [4, 5, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];

let eventId = "";
let stageId = "";
const player: Record<string, string> = {};
const WHO = ["ann", "bea", "cal", "dee"] as const;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const setMode = (mode: string) =>
  prisma.event.update({ where: { id: eventId }, data: { attendanceMode: mode } });

const mark = (who: string, status: "in" | "out") =>
  prisma.roundAttendance.create({
    data: { eventId, stageId, playerId: player[who], status, decidedBy: "Club office" },
  });

const card = (who: string) =>
  prisma.scorecard.create({
    data: { eventId, stageId, playerId: player[who], strokes: JSON.stringify(A_ROUND) },
  });

const attendanceOf = async () => (await weekViewFor(eventId))?.attendance ?? null;

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "community" } });
  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} heath`,
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} winter league`,
      dates: "",
      course: `${TAG} heath`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      attendanceMode: "opt-out",
      format: "stroke",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      courseId: course.id,
      playedOn: "2026-06-02",
    },
  });
  stageId = stage.id;
  for (const [i, who] of WHO.entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: 12,
      },
    });
    player[who] = p.id;
  }
});

beforeEach(async () => {
  await prisma.scorecard.deleteMany({ where: { eventId } });
  await prisma.roundAttendance.deleteMany({ where: { eventId } });
  await setMode("opt-out");
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("an opt-out week, where silence means playing", () => {
  it("expects everybody who said nothing", async () => {
    await card("ann");
    expect(await attendanceOf()).toEqual({ expected: 4, returned: 1, out: 0 });
  });

  it("stops expecting somebody who opted out", async () => {
    await mark("dee", "out");
    await card("ann");
    await card("bea");
    // Three in, two cards — one still to come, and Dee is not one of them.
    expect(await attendanceOf()).toEqual({ expected: 3, returned: 2, out: 1 });
  });

  it("reads as finished when the last of the three is in", async () => {
    await mark("dee", "out");
    for (const who of ["ann", "bea", "cal"]) await card(who);
    expect(await attendanceOf()).toEqual({ expected: 3, returned: 3, out: 1 });
  });
});

describe("a card from somebody who was not expected", () => {
  it("does not count toward the expected total", async () => {
    /**
     * The walk-up. Score entry deliberately still records a card for a player
     * marked out — somebody who turned up unannounced played — so `returned`
     * has to be counted among the players who were IN, or a four-player week
     * with one absentee reports three of three while a card is genuinely
     * outstanding.
     */
    await mark("dee", "out");
    await card("dee");
    expect(await attendanceOf()).toEqual({ expected: 3, returned: 0, out: 1 });
  });
});

describe("an opt-in week, where silence means absent", () => {
  it("expects only those who put their name down", async () => {
    await setMode("opt-in");
    await mark("ann", "in");
    await mark("bea", "in");
    await card("ann");
    // Cal and Dee are out having done nothing at all — the case no fixture of
    // stored rows can express, because there are no rows for them.
    expect(await attendanceOf()).toEqual({ expected: 2, returned: 1, out: 2 });
  });
});

describe("a tournament, which has no week to be in for", () => {
  it("reports nothing rather than a count of the whole field", async () => {
    await setMode("everyone");
    await card("ann");
    expect(await attendanceOf()).toBeNull();
  });
});
