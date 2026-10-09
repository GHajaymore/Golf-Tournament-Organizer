import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// The public board is `unstable_cache`d in production; identity here.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { loadEventState, standingRows } from "@/lib/services/tournament";
import { meFor } from "@/lib/services/me";
import { liveBoard } from "@/lib/services/live-board";

/**
 * A LEAGUE WEEK IS COUNTED AGAINST WHO IS IN IT (2026-10-08).
 *
 * Walked as the grid's L1: a weekly league, opt-out sign-up, Dan out of
 * week 1, the other three cards in and approved. The public board read
 * "All in" with Dan "not playing this week" — only it asked the attendance —
 * while Reports, the dashboard and Today said "3 of 4 cards in — these
 * standings will change", the close-the-round prompt could never appear, and
 * the player's board called Dan "not started".
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LEAGUEWEEK";
const PARS = new Array(18).fill(4);
let eventId = "";
let week1 = "";
const ids: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      status: "live",
      shape: "series",
      attendanceMode: "opt-out",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  const base = { eventId, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross", description: "" };
  week1 = (await prisma.stage.create({ data: { ...base, position: 0 } })).id;
  await prisma.stage.create({ data: { ...base, position: 1 } });
  for (const [i, n] of ["Ann", "Bea", "Cat", "Dan"].entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${n}`, email: `${TAG}.${n}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed" },
    });
    ids[n] = p.id;
    if (n !== "Dan") {
      await prisma.scorecard.create({ data: { eventId, stageId: week1, playerId: p.id, strokes: JSON.stringify(PARS), status: "approved" } });
    }
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const state = async () => {
  const s = await loadEventState(eventId);
  if (!s) throw new Error("the event did not load");
  return s;
};

describe("a league week with somebody out of it", () => {
  it("is all in once everybody who is IN has returned a card", async () => {
    await prisma.roundAttendance.create({ data: { eventId, stageId: week1, playerId: ids.Dan, status: "out", decidedBy: "player" } });
    try {
      const s = await state();
      expect(s.boardProgress.total, "waiting on a card from somebody out of the week").toBe(3);
      expect(s.boardProgress.certified).toBe(3);
      const dan = standingRows(s).find((r) => r.id === ids.Dan)!;
      expect(dan.absent, "the player's board must say 'not playing this week', as /live does").toBe(true);
    } finally {
      await prisma.roundAttendance.deleteMany({ where: { eventId } });
    }
  });

  it("still waits for Dan's card when he is in — the control", async () => {
    const s = await state();
    expect(s.boardProgress.total).toBe(4);
    expect(standingRows(s).find((r) => r.id === ids.Dan)!.absent).toBeFalsy();
  });
});

describe("the player who is out of the week, on their own screen", () => {
  /**
   * Walked as the grid's L2: Dan played week 1, the committee closed it, and
   * Dan said he can't make week 2. Today showed "YOUR CARD · FINAL · NET E" —
   * last week's result — over week 2's empty tiles with "Start my card".
   */
  it("is told he is not playing this week, and is not offered the card", async () => {
    await prisma.stage.update({ where: { id: week1 }, data: { closedAt: new Date() } });
    await prisma.scorecard.create({ data: { eventId, stageId: week1, playerId: ids.Dan, strokes: JSON.stringify(PARS), status: "approved" } });
    const week2 = (await prisma.stage.findFirst({ where: { eventId, position: 1 } }))!.id;
    await prisma.roundAttendance.create({ data: { eventId, stageId: week2, playerId: ids.Dan, status: "out", decidedBy: "player" } });
    // Week 2 under way: the other three are out on the course.
    for (const n of ["Ann", "Bea", "Cat"]) {
      await prisma.scorecard.create({
        data: { eventId, stageId: week2, playerId: ids[n], strokes: JSON.stringify(PARS.map((p, i) => (i < 9 ? p : null))) },
      });
    }
    try {
      const me = await meFor(await state(), `${TAG}.dan@example.invalid`.toLowerCase());
      expect(me.round?.stageId).toBe(week2);
      expect(me.round?.outThisWeek, "not told he is out of the week").toBeTruthy();
      expect(me.round?.ownCard, "offered the card for a week he said he can't make").toBe(false);
      // And the control: once he says he is playing, the card is his again.
      await prisma.roundAttendance.updateMany({ where: { eventId, stageId: week2, playerId: ids.Dan }, data: { status: "in" } });
      const back = await meFor(await state(), `${TAG}.dan@example.invalid`.toLowerCase());
      expect(back.round?.outThisWeek).toBe("");
      expect(back.round?.ownCard).toBe(true);
    } finally {
      await prisma.roundAttendance.deleteMany({ where: { eventId } });
      await prisma.scorecard.deleteMany({ where: { eventId, OR: [{ playerId: ids.Dan }, { stageId: week2 }] } });
      await prisma.stage.update({ where: { id: week1 }, data: { closedAt: null } });
    }
  });
});

describe("a captains league whose list was never sent", () => {
  /**
   * Walked as the grid's L3. Under captains (and opt-in) a player nobody has
   * answered for resolves OUT — and the captain's list is often late or never
   * sent. Three cards in for week 1 and no list at all: the public board read
   * "not playing this week" on every row, the three who PLAYED included, and
   * stayed LIVE, while Reports and the dashboard said all in. A card is proof
   * of playing.
   */
  it("calls only the player with no card absent, and reads all in", async () => {
    await prisma.event.update({ where: { id: eventId }, data: { attendanceMode: "captains" } });
    try {
      const board = (await liveBoard(eventId, week1))!;
      const absent = board.rows.filter((r) => r.absent).map((r) => r.id);
      expect(absent, "a player with a card called absent").toEqual([ids.Dan]);
      expect(board.allIn, "the board waits on nobody — the three who are in have returned cards").toBe(true);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { attendanceMode: "opt-out" } });
    }
  });
});
