import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// The board is `unstable_cache`d in production. Identity here, so each read
// reflects the rows as they stand rather than a minute ago.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { liveBoard } from "@/lib/services/live-board";
import { loadEventState, standingRows } from "@/lib/services/tournament";
import { resultLinesFor } from "@/lib/services/tournament-result";

/**
 * A 36-HOLE MEDAL WITH A CUT, WHILE ROUND 2 IS BEING PLAYED (2026-10-08).
 *
 * Walked as the tournament grid's T3: five players, round 1 closed, the cut
 * made to the top three. With round 2 under way:
 *
 *   - Dan, who missed the cut on 75 (+3 over 18), was ranked 3rd — above Cat,
 *     who made it and went round in 80 (+10 over 36). Every results sheet
 *     lists the players who made the cut first and those who missed it
 *     beneath them, without a place. The board only did that once round 2
 *     was CLOSED; the cut is decided the moment it is made.
 *   - `/live` read "Final · these scores no longer change" over Bea, nine
 *     holes into round 2. It asked each row's aggregate `thru` (27) whether it
 *     had reached the round's 18.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MISSEDCUT";
const PARS = new Array(18).fill(4);
let eventId = "";
let r1 = "";
let r2 = "";
const ids: Record<string, string> = {};

/** A card at par plus one stroke on each of the first `over` holes; blank past `thru`. */
const strokes = (over: number, thru = 18) => JSON.stringify(PARS.map((p, i) => (i < thru ? p + (i < over ? 1 : 0) : null)));

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
      name: `${TAG} championship`,
      status: "live",
      shape: "series",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      leaderboardVisibility: "public",
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  const base = { eventId, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross", description: "" };
  r1 = (await prisma.stage.create({ data: { ...base, position: 0, closedAt: new Date() } })).id;
  r2 = (await prisma.stage.create({ data: { ...base, position: 1, cutEnabled: true, cutMode: "count", cutCount: 3 } })).id;
  // Round 1: Ann 70, Bea 72, Cat 73 make the cut; Dan 75 and Eve 78 miss it.
  const r1Over: Record<string, number> = { Ann: -2, Bea: 0, Cat: 1, Dan: 3, Eve: 6 };
  for (const [i, n] of Object.keys(r1Over).entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${n}`, email: `${TAG}.${n}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed" },
    });
    ids[n] = p.id;
    const over = r1Over[n];
    const card = over >= 0 ? strokes(over) : JSON.stringify(PARS.map((par, h) => (h < -over ? par - 1 : par)));
    await prisma.scorecard.create({ data: { eventId, stageId: r1, playerId: p.id, strokes: card, status: "approved" } });
  }
});

beforeEach(async () => {
  await prisma.scorecard.deleteMany({ where: { eventId, stageId: r2 } });
  await prisma.stage.update({ where: { id: r1 }, data: { closedAt: new Date() } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** Round 2's cards — the cut's survivors and nobody else, as `applyStrokeCut` leaves it. */
async function roundTwo(bea: number) {
  await prisma.scorecard.create({ data: { eventId, stageId: r2, playerId: ids.Ann, strokes: strokes(0), status: "approved" } });
  await prisma.scorecard.create({ data: { eventId, stageId: r2, playerId: ids.Bea, strokes: strokes(0, bea), status: "entered" } });
  await prisma.scorecard.create({ data: { eventId, stageId: r2, playerId: ids.Cat, strokes: strokes(9), status: "approved" } });
}

const order = async () => {
  const state = await loadEventState(eventId);
  if (!state) throw new Error("the event did not load");
  const rows = standingRows(state);
  return rows.map((r) => ({ name: Object.keys(ids).find((n) => ids[n] === r.id)!, ranked: r.ranked, rank: r.rank, cut: r.missedCut ?? "" }));
};

describe("a player who missed the cut", () => {
  it("sits beneath every player who made it, without a place, while round 2 is played", async () => {
    await roundTwo(9);
    const rows = await order();
    const at = (n: string) => rows.findIndex((r) => r.name === n);
    // Cat is +10 over 36; Dan is +3 over 18 and missed the cut.
    expect(at("Dan"), JSON.stringify(rows)).toBeGreaterThan(at("Cat"));
    expect(at("Eve")).toBeGreaterThan(at("Cat"));
    for (const n of ["Dan", "Eve"]) {
      const r = rows[at(n)];
      expect(r.ranked, `${n} holds a place`).toBe(false);
      expect(r.rank).toBe(0);
      expect(r.cut).toMatch(/Round 1/);
    }
    expect(rows.filter((r) => r.ranked).map((r) => r.name)).toEqual(["Ann", "Bea", "Cat"]);
  });

  it("is not marked before the cut is made — the control", async () => {
    // Round 1 still open: nobody has been cut, whatever cards exist.
    await prisma.stage.update({ where: { id: r1 }, data: { closedAt: null } });
    await roundTwo(9);
    const dan = (await order()).find((r) => r.name === "Dan")!;
    expect(dan.cut).toBe("");
    expect(dan.ranked).toBe(true);
  });
});

describe("the round-by-round result on the player's board", () => {
  const roundTwoLine = async () => {
    const state = await loadEventState(eventId);
    if (!state) throw new Error("the event did not load");
    return (await resultLinesFor(state))[1];
  };

  it("names no round 2 winner while a survivor is still on the course", async () => {
    await roundTwo(9);
    const line = await roundTwoLine();
    expect(line.settled, line.result).toBe(false);
    expect(line.result).toMatch(/still on the course/);
  });

  it("names the winner once every card that began is finished — the control", async () => {
    await roundTwo(18);
    const line = await roundTwoLine();
    expect(line.settled).toBe(true);
    expect(line.result).toMatch(/Ann/);
  });

  it("settles on what was returned once the committee closes the round", async () => {
    await roundTwo(9);
    await prisma.stage.update({ where: { id: r2 }, data: { closedAt: new Date() } });
    try {
      expect((await roundTwoLine()).settled).toBe(true);
    } finally {
      await prisma.stage.update({ where: { id: r2 }, data: { closedAt: null } });
    }
  });
});

describe("the public board over a two-round event", () => {
  it("is not Final while a survivor is nine holes into round 2", async () => {
    await roundTwo(9);
    const b = await liveBoard(eventId);
    expect(b).not.toBeNull();
    expect(b!.allIn, "Final over a player on the 10th").toBe(false);
  });

  it("is all in once every survivor is round, without waiting on those cut — the control", async () => {
    await roundTwo(18);
    const b = await liveBoard(eventId);
    expect(b!.allIn).toBe(true);
    // Every card in is not the official result: the round is still open.
    expect(b!.official, "Final before the committee closed the round").toBe(false);
  });

  it("is Final — official — once the committee closes the round", async () => {
    await roundTwo(18);
    await prisma.stage.update({ where: { id: r2 }, data: { closedAt: new Date() } });
    try {
      expect((await liveBoard(eventId))!.official).toBe(true);
    } finally {
      await prisma.stage.update({ where: { id: r2 }, data: { closedAt: null } });
    }
  });
});
