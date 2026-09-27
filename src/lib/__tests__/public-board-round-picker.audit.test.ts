import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readSource } from "./source";

/**
 * THE PUBLIC BOARD GETS THE ROUND PICKER (Ajay, 2026-09-27: "yes add the round
 * picker to both").
 *
 * The console leaderboard got it on 2026-09-26. The public board — the link a
 * club sends its members — still showed only the board's own round, so the
 * finished Festival of Formats, whose last round is scored by hand, showed its
 * members "This round is scored by hand" and nothing else, with ten scored
 * rounds behind it.
 *
 * The fixture is that shape: a scored stroke round, then a hand-scored last
 * round. By default the board is the hand-scored one; picked, it is round 1,
 * ranked. And the picked round is part of the cache key, so the page must turn
 * an id that is not this tournament's into the board's own round rather than a
 * cache entry of its own.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { liveBoard } from "@/lib/services/live-board";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROUND-PICKER";
let eventId = "";
let scored = "";
let byHand = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} festival`,
        status: "completed",
        format: "stroke",
        shape: "series",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        leaderboardVisibility: "public",
        shareToken: `${TAG}-${Date.now()}`,
        customPars: JSON.stringify(new Array(18).fill(4)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    })
  ).id;
  scored = (
    await prisma.stage.create({
      data: { eventId, position: 0, description: "The medal", type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" },
    })
  ).id;
  byHand = (
    await prisma.stage.create({
      data: { eventId, position: 1, description: "The flag day", type: "Stroke Play Round", format: "Other (scored by hand)", holes: 18 },
    })
  ).id;
  for (const [i, who] of ["ann", "bo"].entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: `${TAG}-${who}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed", handicap: 10 },
    });
    await prisma.scorecard.create({
      data: { eventId, stageId: scored, playerId: p.id, strokes: JSON.stringify(new Array(18).fill(4 + i)) },
    });
    // A hand-scored round still files cards — which is what makes it the
    // board's own round (the newest with results), exactly as on the festival.
    await prisma.scorecard.create({
      data: { eventId, stageId: byHand, playerId: p.id, strokes: JSON.stringify(new Array(18).fill(5)) },
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

describe("the public board's round picker", () => {
  it("opens on the board's own round, and offers both", async () => {
    const board = await liveBoard(eventId);
    expect(board!.manualFormat, "the last round is the hand-scored one").toBe(true);
    expect(board!.shownStageId).toBe(byHand);
    expect(board!.rounds.map((r) => r.stageId)).toEqual([scored, byHand]);
  });

  it("shows the picked round, ranked", async () => {
    const board = await liveBoard(eventId, scored);
    expect(board!.manualFormat).toBe(false);
    expect(board!.shownStageId).toBe(scored);
    expect(board!.roundLabel).toBe("The medal");
    expect(board!.rows.map((r) => r.name)).toEqual([`${TAG} ann`, `${TAG} bo`]);
  });

  it("the page only asks the cache for a round of this tournament", () => {
    const page = readSource("src", "app", "live", "[token]", "page.tsx");
    expect(page).toMatch(/prisma\.stage\.findFirst\(\{ where: \{ id: round, eventId: event\.id \}/);
    expect(page).toMatch(/liveBoard\(event\.id, picked\)/);
  });

  it("and the player's Board reads the same picked round", () => {
    const page = readSource("src", "app", "(player)", "me", "board", "page.tsx");
    expect(page).toMatch(/const state = withBoardRound\(loaded, round\)/);
    // In both branches: the special boards and the standard one.
    expect(page.split("{picker}").length - 1).toBe(2);
  });
});
