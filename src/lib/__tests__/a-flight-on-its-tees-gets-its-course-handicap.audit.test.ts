import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { flightTeeByPlayer } from "../services/handicaps";
import { courseHandicap, courseHandicapExact, teeIdFor } from "../domain/handicap";
import {
  seedFlightTees,
  teardownFlightTees,
  PLAYERS,
  TEES,
} from "../../../e2e/flight-tees-fixture.mjs";

/**
 * A player on a FLIGHT'S tees is priced off that flight's rating and slope.
 *
 * The fixture is `e2e/flight-tees-fixture.mjs` (three flights that claim a set,
 * one that claims none, decimal indexes, nobody with a tee of their own). The
 * tee is read through `teeIdFor`, the one resolver, from the rows as seeded —
 * the test assumes no id. The expectations are the Rules of Handicapping
 * worked by hand (6.2a, then the 95% allowance of Appendix C on the UNROUNDED
 * figure, rounded once), and ALSO by a second route with no floating point:
 * everything counted in 1/1130ths of a stroke. Neither route is the code's.
 *
 *   npx vitest run --config vitest.audit.config.ts a-flight-on-its-tees
 */

const prisma = new PrismaClient();
type Seeded = { eventId: string; stageId: string; tees: Record<string, string>; flights: Record<string, string>; players: Record<string, string> };
let seeded: Seeded;

/**
 * Course Handicap x 1130, in whole numbers: Index x Slope / 113 + (CR - Par)
 * is (index10 x slope + 113 x (CR10 - Par10)) / 1130.
 */
const exact1130 = (index: number, t: { courseRating: number; slopeRating: number; par: number }) =>
  Math.round(index * 10) * t.slopeRating + 113 * (Math.round(t.courseRating * 10) - t.par * 10);
/** Nearest whole, a half upwards, of n / d for positive integers. */
const roundDiv = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

type TeeKey = keyof typeof TEES;
const flightOf = { champ: "blue", senior: "senior", ladies: "red", open: null } as Record<string, TeeKey | null>;

beforeAll(async () => {
  seeded = (await seedFlightTees()) as Seeded;
});
afterAll(async () => {
  try {
    await teardownFlightTees();
  } finally {
    await prisma.$disconnect();
  }
});

describe("which tee the resolver names", () => {
  it("names the flight's set, read from the rows, and the round's for a flight with none", async () => {
    const flightTee = await flightTeeByPlayer(seeded.eventId);
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId }, select: { defaultTeeId: true } });
    const players = await prisma.player.findMany({ where: { eventId: seeded.eventId }, select: { id: true, teeId: true } });
    // Nothing creates a player with a tee of their own.
    expect(players.every((p) => p.teeId === null)).toBe(true);
    for (const p of PLAYERS) {
      const id = seeded.players[p.key];
      const got = teeIdFor("flight", null, flightTee.get(id), ev.defaultTeeId, () => true, null);
      const want = flightOf[p.flight] ? seeded.tees[flightOf[p.flight]!] : ev.defaultTeeId;
      expect(got, p.name).toBe(want);
    }
    // The control: the four sets are four different rows.
    expect(new Set(Object.values(seeded.tees)).size).toBe(4);
  });
});

describe("the Course Handicap off the flight's tees", () => {
  it.each(PLAYERS)("$name: hand-worked figure, and a second whole-number route, agree with the code", (p) => {
    const tee = TEES[(flightOf[p.flight] ?? "white") as TeeKey];
    expect(courseHandicap(p.index, tee)).toBe(p.expected.course);
    expect(roundDiv(exact1130(p.index, tee), 1130)).toBe(p.expected.course);
    // The 95% is taken of the UNROUNDED figure and rounded once.
    expect(roundDiv(95 * exact1130(p.index, tee), 100 * 1130)).toBe(p.expected.playing);
    expect(courseHandicapExact(p.index, tee)).toBeCloseTo(exact1130(p.index, tee) / 1130, 9);
  });

  it("Mara is the one a double rounding gets wrong", () => {
    // 22 x 95% = 20.9 -> 21; the Rule's 21.5177 x 95% = 20.44 -> 20.
    const mara = PLAYERS.find((p) => p.key === "mara")!;
    expect(Math.round(mara.expected.course * 0.95)).toBe(21);
    expect(mara.expected.playing).toBe(20);
  });
});

describe("what the round scores each player off", () => {
  it("gives each player the playing handicap the Rules give off their flight's set", async () => {
    const state = await loadEventState(seeded.eventId);
    expect(state).toBeTruthy();
    for (const p of PLAYERS) {
      expect(state!.strokeHandicapFor(seeded.players[p.key], seeded.stageId), p.name).toBe(p.expected.playing);
    }
  });

  it("puts everybody on the round's set when the tournament says one set for all", async () => {
    // Control: the same rows under another policy give other numbers, so the
    // test above could not have passed by the flights not mattering.
    await prisma.event.update({ where: { id: seeded.eventId }, data: { teePolicy: "one" } });
    try {
      const state = await loadEventState(seeded.eventId);
      for (const p of PLAYERS) {
        const white = Math.round((95 * exact1130(p.index, TEES.white)) / (100 * 1130));
        expect(state!.strokeHandicapFor(seeded.players[p.key], seeded.stageId), p.name).toBe(white);
      }
      const ines = state!.strokeHandicapFor(seeded.players.ines, seeded.stageId);
      expect(ines).not.toBe(PLAYERS.find((p) => p.key === "ines")!.expected.playing);
    } finally {
      await prisma.event.update({ where: { id: seeded.eventId }, data: { teePolicy: "flight" } });
    }
  });
});
