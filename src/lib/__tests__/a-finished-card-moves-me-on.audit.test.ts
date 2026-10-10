import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A FINISHED CARD MOVES ME ON TO THE NEXT ROUND ONCE IT IS READY (2026-10-10).
 *
 * Sunday morning of an undated two-round medal: Round 1 never closed (most
 * committees don't, that evening), Round 2's tee sheet published. The board
 * rightly stays on Round 1 — and so did My card and Today, which showed a
 * player their finished Round 1 card with no way to start Round 2. On a
 * three-week league the first member to score week 2 typed over week 1.
 *
 * Controls: a card still being played keeps me on it; a finished card with
 * no next round set up keeps me on it too.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FINISHEDCARD";
const PARS = new Array(18).fill(4);

const { loadEventState } = await import("@/lib/services/tournament");
const { meFor } = await import("@/lib/services/me");

let eventId = "";
let r1 = "";
let r2 = "";
let bea = "";
const beaEmail = `${TAG}.bea@example.invalid`.toLowerCase();

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${TAG} medal`, status: "live", shape: "series", scoreEntryBy: "players",
      dates: "", course: "Home", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;
  // Undated, both open: the cards are all there is to go on.
  r1 = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })).id;
  r2 = (await prisma.stage.create({ data: { eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })).id;
  bea = (await prisma.player.create({ data: { eventId, name: `${TAG} Bea`, email: beaEmail, seed: 1, status: "confirmed" } })).id;
});

beforeEach(async () => {
  await prisma.scorecard.deleteMany({ where: { eventId } });
  await prisma.stage.update({ where: { id: r2 }, data: { teeSheetPublished: false } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const myRound = async () => (await meFor((await loadEventState(eventId))!, beaEmail)).round?.stageId;
const card = (holes: number) => JSON.stringify(PARS.map((p, i) => (i < holes ? p : null)));

describe("a player whose Round 1 card is finished", () => {
  it("is on Round 2 once its sheet is published", async () => {
    await prisma.scorecard.create({ data: { eventId, stageId: r1, playerId: bea, strokes: card(18), status: "certified" } });
    await prisma.stage.update({ where: { id: r2 }, data: { teeSheetPublished: true } });
    expect(await myRound()).toBe(r2);
  });

  it("CONTROL: stays on Round 1 while nobody has set Round 2 up", async () => {
    await prisma.scorecard.create({ data: { eventId, stageId: r1, playerId: bea, strokes: card(18), status: "certified" } });
    expect(await myRound()).toBe(r1);
  });
});

describe("CONTROL: a player still out on Round 1", () => {
  it("stays on Round 1 even with Round 2's sheet out", async () => {
    await prisma.scorecard.create({ data: { eventId, stageId: r1, playerId: bea, strokes: card(12), status: "entered" } });
    await prisma.stage.update({ where: { id: r2 }, data: { teeSheetPublished: true } });
    expect(await myRound()).toBe(r1);
  });
});
