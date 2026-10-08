import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE BOARD NAMES THE FLIGHT THE CLUB NAMED (2026-10-08).
 *
 * `standingRows` feeds the console leaderboard, the public /live board and
 * the player's own board. It labelled every flight by position, "Flight 1",
 * "Flight 2", whatever the organizer had called it — so a member of the
 * "Seniors" flight read "Flight 2" beside their name. Against real rows: one
 * flight renamed, one left with the letter generating gave it, one with no
 * name at all, in that order — so a label read by position cannot pass.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FLIGHTNAME";
let eventId = "";
const ids: string[] = [];
const PARS = new Array(18).fill(4);

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      status: "live",
      shape: "single",
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
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" },
  });
  // Positions 0, 1, 2 — named, a bare letter, nothing.
  const flights = [];
  for (const [i, name] of ["Seniors", "B", ""].entries()) {
    flights.push(await prisma.group.create({ data: { eventId, name, position: i } }));
  }
  // One player per flight, over par by their flight's position (0, 1, 2) …
  // … then a fourth in Flight B who beats the first player there by a shot,
  // and a fifth in Seniors level with the first: a tie INSIDE a flight, and a
  // flight place that differs from the overall one.
  const field: [number, number][] = [[0, 0], [1, 1], [2, 2], [1, 0], [0, 0]];
  for (const [i, [flight, over]] of field.entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} P${i}`, email: `${TAG}.p${i}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed", groupId: flights[flight].id },
    });
    ids.push(p.id);
    await prisma.scorecard.create({
      data: { eventId, stageId: stage.id, playerId: p.id, strokes: JSON.stringify(PARS.map((par, h) => par + (h < over ? 1 : 0))), status: "approved" },
    });
  }
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("the boards' rows", () => {
  it("carry each flight's own name", async () => {
    const { loadEventState, standingRows } = await import("@/lib/services/tournament");
    const state = await loadEventState(eventId);
    const rows = standingRows(state!);
    const flightOf = (id: string) => rows.find((r) => r.id === id)?.flight;
    expect(rows.length, "the board is empty — the fixture reached nothing").toBe(5);
    expect(flightOf(ids[0])).toBe("Seniors");
    expect(flightOf(ids[1])).toBe("Flight B");
    expect(flightOf(ids[2])).toBe("Flight 3");
  });
});

describe("Today's flight place", () => {
  /**
   * "2nd in Flight B" beside the overall place — the flight a medal is won in.
   * P1 is 4th overall (three players on level par ahead of him) and 2nd in
   * Flight B, behind P3. P0 and P4 share the lead of Seniors.
   */
  it("is the place within the player's own flight, by the flight's name", async () => {
    const { loadEventState } = await import("@/lib/services/tournament");
    const { flightPlaceFor } = await import("@/lib/services/me");
    const state = (await loadEventState(eventId))!;
    expect(flightPlaceFor(state, ids[3])).toBe("1st in Flight B");
    expect(flightPlaceFor(state, ids[1])).toBe("2nd in Flight B");
    expect(flightPlaceFor(state, ids[0])).toBe("T1 in Seniors");
    expect(flightPlaceFor(state, ids[4])).toBe("T1 in Seniors");
    expect(flightPlaceFor(state, ids[2])).toBe("1st in Flight 3");
  });
});
