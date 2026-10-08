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
 * A PLAYER WHO WITHDRAWS PARTWAY THROUGH IS WD ON THE SHEET (2026-10-08).
 *
 * Walked as the tournament grid's T3: a 36-hole net medal cut to three after
 * round 1, and Bea — through the cut — going home at the turn of round 2.
 * `removeSignup` withdraws a player with history and says "their results are
 * kept", and then every board dropped her entirely, round 1 score and all,
 * because the sheet was built from the confirmed field. The dashboard went on
 * counting her nine-hole card as "still out on the course", and the round's
 * "2 of 3 cards in" waited for a card that was never coming.
 *
 * A results sheet lists her as WD, beneath everybody, over what she returned
 * and without a place. She is NOT part of the field: the cut, the draw and the
 * seeding still read the confirmed players only.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WITHDRAWN";
const PARS = new Array(18).fill(4);
let eventId = "";
let r1 = "";
let r2 = "";
const ids: Record<string, string> = {};

const strokes = (thru = 18) => JSON.stringify(PARS.map((p, i) => (i < thru ? p : null)));

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
      // Stroke index 1..18 in hole order, so a player's shots fall on the
      // first holes and nine holes played carry the hardest nine.
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  const base = { eventId, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "net", handicapAllowance: 100, description: "" };
  r1 = (await prisma.stage.create({ data: { ...base, position: 0, closedAt: new Date() } })).id;
  r2 = (await prisma.stage.create({ data: { ...base, position: 1, cutEnabled: true, cutMode: "count", cutCount: 3 } })).id;
  // Everyone pars round 1; handicaps decide the cut on net: Ann, Bea, Cat
  // (off 10) through, Dan (off 2) out.
  const field: Array<[string, number]> = [["Ann", 10], ["Bea", 10], ["Cat", 10], ["Dan", 2]];
  for (const [i, [n, hcp]] of field.entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${n}`, email: `${TAG}.${n}@example.invalid`.toLowerCase(), seed: i + 1, handicap: hcp, status: "confirmed" },
    });
    ids[n] = p.id;
    await prisma.scorecard.create({ data: { eventId, stageId: r1, playerId: p.id, strokes: strokes(), status: "approved" } });
  }
  // Round 2: the survivors' cards. Ann and Cat round in par; Bea stops at nine.
  await prisma.scorecard.create({ data: { eventId, stageId: r2, playerId: ids.Ann, strokes: strokes(), status: "approved" } });
  await prisma.scorecard.create({ data: { eventId, stageId: r2, playerId: ids.Cat, strokes: strokes(), status: "approved" } });
  await prisma.scorecard.create({ data: { eventId, stageId: r2, playerId: ids.Bea, strokes: strokes(9), status: "entered" } });
});

beforeEach(async () => {
  await prisma.player.update({ where: { id: ids.Bea }, data: { status: "withdrawn" } });
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

describe("a player who withdrew at the turn of round 2", () => {
  it("is on the sheet as WD, last, without a place, over the figures she returned", async () => {
    const rows = standingRows(await state());
    const bea = rows.find((r) => r.id === ids.Bea);
    expect(bea, "the withdrawn player vanished from the sheet").toBeDefined();
    expect(rows[rows.length - 1].id, "WD is not at the foot of the sheet").toBe(ids.Bea);
    expect(bea!.withdrew).toBe(true);
    expect(bea!.ranked).toBe(false);
    expect(bea!.rank).toBe(0);
    expect(bea!.thru).toBe(27);
    expect(bea!.gross).toBe(108);
    // Off 10 at 100%: ten shots in round 1, and nine in round 2 — the first
    // nine holes are stroke index 1..9. A net figure needs her handicap, which
    // the field's handicap map did not hold for a player outside the field.
    expect(bea!.net).toBe(89);
  });

  it("is not part of the field the cut, the draw and the seeding read", async () => {
    const s = await state();
    expect(s.strokeStandings.map((x) => x.player.id)).not.toContain(ids.Bea);
  });

  it("is not a card the round waits for, nor anybody still on the course", async () => {
    const s = await state();
    expect(s.boardProgress.total, "the withdrawn survivor is still owed a card").toBe(2);
    expect(s.boardProgress.started - s.boardProgress.certified, "a withdrawn card counted as still out").toBe(0);
    expect((await liveBoard(eventId))!.allIn, "the board waits on a player who went home").toBe(true);
    expect((await resultLinesFor(s))[1].settled).toBe(true);
  });

  it("and a player the committee DISQUALIFIES is the last line, DQ, beneath the WD", async () => {
    await prisma.player.update({ where: { id: ids.Cat }, data: { status: "disqualified" } });
    try {
      const s = await state();
      const rows = standingRows(s);
      const cat = rows.find((r) => r.id === ids.Cat)!;
      expect(cat, "the disqualified player vanished from the sheet").toBeDefined();
      expect(cat.disqualified).toBe(true);
      expect(cat.withdrew).toBe(false);
      expect(cat.ranked).toBe(false);
      expect(rows.map((r) => r.id).slice(-2), "DQ is not the last line, beneath WD").toEqual([ids.Bea, ids.Cat]);
      // Out of the field: not ranked, not drawn, not waited for.
      expect(s.strokeStandings.map((x) => x.player.id)).not.toContain(ids.Cat);
      expect(s.boardProgress.total).toBe(1);
      expect((await liveBoard(eventId))!.allIn).toBe(true);
    } finally {
      await prisma.player.update({ where: { id: ids.Cat }, data: { status: "confirmed" } });
    }
  });

  it("waits for her while she is still in the field — the control", async () => {
    await prisma.player.update({ where: { id: ids.Bea }, data: { status: "confirmed" } });
    const s = await state();
    const bea = standingRows(s).find((r) => r.id === ids.Bea)!;
    expect(bea.withdrew).toBe(false);
    expect(bea.ranked).toBe(true);
    expect(s.boardProgress.total).toBe(3);
    expect((await liveBoard(eventId))!.allIn).toBe(false);
    expect((await resultLinesFor(s))[1].settled).toBe(false);
  });
});
