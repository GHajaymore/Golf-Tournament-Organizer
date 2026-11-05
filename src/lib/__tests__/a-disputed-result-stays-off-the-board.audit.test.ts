import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
 * A DISPUTED RESULT STAYS OFF THE BOARD (2026-11-04, sprint 2 part B, step 1).
 *
 * A design review read `loadEventStateUncached` and saw the live board take
 * EVERY scorecard of the event, status unasked, while the final result
 * (`roundOutcomesFor`) skips a card whose status is "disputed". Two readers of
 * one round answering "who is winning" from different sets of cards.
 *
 * Proved here on real rows rather than by reading: one stroke round, Ann's
 * card accepted at 72, Bea's DISPUTED at 70. The final result names Ann; the
 * question is what the live board names. A disputed card is a claim that the
 * numbers are wrong (Rule 20.2c: the Committee decides it), so a board that
 * ranks it puts a score nobody agrees on above one everybody does — and the
 * end-of-round check of sprint 2 makes "the other side disputes it" an
 * everyday press, not a rarity.
 *
 * The rule is `heldFromBoard` (domain/board-hold.ts), asked at every standings
 * reader. The counters that REPORT a disputed card (the review queue's
 * `disputed`, the finish gate) must still see it — asserted last.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-disputed-off-the-board";
const PARS = new Array(18).fill(4);
let eventId = "";
let stageId = "";
const ids: Record<string, string> = {};

const card = (birdies: number) => JSON.stringify(PARS.map((p, i) => (i < birdies ? p - 1 : p)));

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
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}-${Date.now()}`,
      leaderboardVisibility: "public",
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  stageId = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross", description: "" },
    })
  ).id;
  for (const [i, n] of ["Ann", "Bea"].entries()) {
    ids[n] = (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${n}`, email: `${TAG}.${n}@example.invalid`.toLowerCase(), seed: i + 1, handicap: 0, status: "confirmed" },
      })
    ).id;
  }
  // Ann: 72, accepted. Bea: 70, and somebody has said it is wrong.
  await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.Ann, strokes: card(0), status: "approved" } });
  await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.Bea, strokes: card(2), status: "disputed" } });
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

describe("a disputed card on a stroke round", () => {
  it("the final result leaves it out: Ann, 72", async () => {
    const lines = await resultLinesFor(await state());
    expect(lines[0].result).toContain(`${TAG} Ann`);
    expect(lines[0].result).not.toContain(`${TAG} Bea`);
  });

  it("and the live board agrees: Ann leads, Bea's disputed 70 is not ranked above her", async () => {
    const s = await state();
    const ranked = s.strokeStandings.filter((r) => r.thru > 0).map((r) => r.player.id);
    expect(ranked[0], "the live standings put a disputed card at the top").toBe(ids.Ann);
    expect(ranked, "the live standings rank a disputed card").not.toContain(ids.Bea);
    const rows = standingRows(s).filter((r) => r.ranked);
    expect(rows[0]?.id).toBe(ids.Ann);
    expect(rows.map((r) => r.id)).not.toContain(ids.Bea);
  });

  it("and so does the public board", async () => {
    const board = await liveBoard(eventId);
    const ranked = (board?.rows ?? []).filter((r) => r.ranked);
    expect(ranked[0]?.id).toBe(ids.Ann);
    expect(ranked.map((r) => r.id)).not.toContain(ids.Bea);
  });

  it("while the counters that REPORT a dispute still see it", async () => {
    const s = await state();
    expect(s.reviewing.disputed, "the finish gate lost sight of the disputed card").toBe(1);
  });

  it("CONTROL: once the dispute is settled (the card accepted), Bea's 70 leads", async () => {
    await prisma.scorecard.updateMany({ where: { eventId, stageId, playerId: ids.Bea }, data: { status: "approved" } });
    try {
      const s = await state();
      const ranked = s.strokeStandings.filter((r) => r.thru > 0).map((r) => r.player.id);
      expect(ranked[0]).toBe(ids.Bea);
      expect((await resultLinesFor(s))[0].result).toContain(`${TAG} Bea`);
    } finally {
      await prisma.scorecard.updateMany({ where: { eventId, stageId, playerId: ids.Bea }, data: { status: "disputed" } });
    }
  });
});
