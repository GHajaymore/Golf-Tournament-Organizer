import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState, standingRows } from "../services/tournament";
import { stablefordTableFor } from "../formats";
import { stablefordPointsForHole, modifiedStablefordForHole } from "../domain/stroke";

/**
 * A Modified Stableford round is ranked on the Modified table.
 *
 * From the 2026-08-27 exploratory audit. `strokeStandings` accumulated points
 * with `stablefordPointsForHole` — the STANDARD table, floored at zero — and
 * then ranked on them whenever the unit said "modified Stableford points".
 * `modifiedStablefordForHole` had exactly one caller: the leaderboard.
 *
 * The two tables order a field differently on purpose. Modified has no floor
 * and pays a birdie double what a par is worth against a bogey, which is the
 * entire point of the format: it makes going for a green worth the risk.
 *
 * So the leaderboard put one player first and the standings — which feed the
 * cut, the honours-board champion, the season table and play-off seeding — put
 * another. A club's honours board recorded the wrong champion for a round its
 * own leaderboard had scored correctly.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MODSTBL";

let eventId = "";
const player: Record<string, string> = {};

const PARS = new Array(18).fill(4);

/**
 * The two cards from the report, off scratch.
 *
 *   charger: 6 birdies, 3 doubles, 9 pars → 36 standard, +3 modified
 *   plodder: 1 birdie, 17 pars           → 37 standard, +2 modified
 *
 * Standard ranks the plodder first by a single point; modified ranks the
 * charger first. One round, two orders, and only one of them is the format the
 * club chose to play.
 */
const CHARGER = [
  3, 3, 3, 3, 3, 3, // six birdies
  6, 6, 6, // three doubles
  4, 4, 4, 4, 4, 4, 4, 4, 4, // nine pars
];
const PLODDER = [3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];

const totalOn = (
  card: number[],
  table: (s: number, par: number, hs: number) => number,
) => card.reduce((sum, s, i) => sum + table(s, PARS[i], 0), 0);

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
      name: `${TAG} medal`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      format: "stroke",
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Stroke Play Round",
      format: "Modified Stableford",
      holes: 18,
    },
  });

  for (const [i, [who, card]] of ([["charger", CHARGER], ["plodder", PLODDER]] as const).entries()) {
    // Off scratch, so the handicap plays no part and the tables are the only
    // thing separating them.
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
    });
    player[who] = p.id;
    await prisma.scorecard.create({
      data: { eventId, stageId: stage.id, playerId: p.id, strokes: JSON.stringify(card) },
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the two tables really do disagree", () => {
  it("ranks the plodder first on the standard table", () => {
    // If this stopped being true the standings test below would pass for the
    // wrong reason.
    expect(totalOn(PLODDER, stablefordPointsForHole)).toBeGreaterThan(
      totalOn(CHARGER, stablefordPointsForHole),
    );
  });

  it("ranks the charger first on the modified table", () => {
    expect(totalOn(CHARGER, modifiedStablefordForHole)).toBeGreaterThan(
      totalOn(PLODDER, modifiedStablefordForHole),
    );
  });
});

describe("the standings that feed the cut, the honours board and the season", () => {
  it("put the charger first, the way the round's own leaderboard does", async () => {
    const state = await loadEventState(eventId);
    expect(state).toBeTruthy();
    const rows = standingRows(state!);

    const charger = rows.find((r) => r.id === player.charger);
    const plodder = rows.find((r) => r.id === player.plodder);
    expect(charger, "the charger should be on the board").toBeTruthy();
    expect(plodder).toBeTruthy();
    expect(charger!.rank).toBeLessThan(plodder!.rank);
  });

  it("scores the cards on the modified table, not merely orders them", async () => {
    const state = await loadEventState(eventId);
    const agg = state!.strokeStandings.find((s) => s.player.id === player.charger);
    expect(agg, "the charger should have an aggregate").toBeTruthy();
    expect(agg!.points).toBe(totalOn(CHARGER, modifiedStablefordForHole));
    expect(agg!.points).not.toBe(totalOn(CHARGER, stablefordPointsForHole));
  });
});

describe("the table chooser itself", () => {
  const pick = stablefordTableFor(
    (stageId) => (stageId === "mod" ? "Modified Stableford" : "Stableford"),
    stablefordPointsForHole,
    modifiedStablefordForHole,
  );

  it("uses the modified table for a modified round", () => {
    // A birdie: 2 on the standard table, 2 on the modified one — so use a
    // DOUBLE, where they differ (0 floored vs -3).
    expect(pick(6, 4, 0, "mod")).toBe(modifiedStablefordForHole(6, 4, 0));
    expect(pick(6, 4, 0, "mod")).toBe(-3);
  });

  it("leaves an ordinary Stableford round exactly as it was", () => {
    expect(pick(6, 4, 0, "ordinary")).toBe(stablefordPointsForHole(6, 4, 0));
    expect(pick(6, 4, 0, "ordinary")).toBe(0);
  });

  it("treats an unknown round as ordinary rather than guessing", () => {
    const unknown = stablefordTableFor(() => null, stablefordPointsForHole, modifiedStablefordForHole);
    expect(unknown(6, 4, 0, "whatever")).toBe(stablefordPointsForHole(6, 4, 0));
  });
});
