import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState, standingRows } from "@/lib/services/tournament";

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
