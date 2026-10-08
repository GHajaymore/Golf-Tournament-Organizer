import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { moneyFor } from "@/lib/services/expenses";

/**
 * AN OPT-OUT POT CHARGES THE PLAYERS WHO PLAYED THE ROUND (2026-10-08).
 *
 * Walked as the tournament grid's T7, and decided as standard practice: a
 * sweep is taken on the first tee, so you pay into a round's pot only for a
 * round you played. An opt-out pot read "everyone in the field" off the field
 * as it stands NOW, so:
 *
 *   - a player entered after round 1 was charged round 1's birdie pot, and
 *   - a member who never turned up paid into a pot for a round they did not
 *     play — and both stakes went to the player who made the birdie.
 *
 * A stake the organizer has RECORDED as taken still stands: that is cash in
 * hand, and a stake is paid or it is not.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-POTPLAYED";
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
  stageId = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross", closedAt: new Date() },
    })
  ).id;
  // Ann made the only birdie. Bea played. Dan never turned up. Cat entered
  // after the round. Eve did not turn up either — but the organizer recorded
  // her stake as taken.
  for (const [i, n] of ["Ann", "Bea", "Dan", "Cat", "Eve"].entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${n}`, email: `${TAG}.${n}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed" },
    });
    ids[n] = p.id;
  }
  await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.Ann, strokes: card(1), status: "approved" } });
  await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.Bea, strokes: card(0), status: "approved" } });
  const pot = await prisma.sideGame.create({
    data: { eventId, stageId, kind: "birdies", buyInCents: 1000, entryMode: "opt-out", groupKey: "" },
  });
  await prisma.sideGameEntry.create({ data: { sideGameId: pot.id, playerId: ids.Eve, confirmed: true } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const netOf = async () => {
  const view = await moneyFor(eventId, `${TAG}.ann@example.invalid`.toLowerCase());
  const by = new Map(view.standing.map((s) => [s.playerId, s.netCents]));
  return (n: string) => by.get(ids[n]) ?? 0;
};

describe("an opt-out birdie pot on a closed round", () => {
  it("charges nobody who did not play it — a no-show or a late entrant", async () => {
    const net = await netOf();
    expect(net("Dan"), "a no-show paid into the pot").toBe(0);
    expect(net("Cat"), "a late entrant paid into the pot").toBe(0);
  });

  it("pays the birdie out of the stakes of those who played, and a stake recorded as taken", async () => {
    const net = await netOf();
    // Ann, Bea and Eve's recorded stake: $30, all to Ann's birdie.
    expect(net("Ann")).toBe(2000);
    expect(net("Bea")).toBe(-1000);
    expect(net("Eve"), "cash the organizer took is still in the pot").toBe(-1000);
  });

  it("shows the pot as the settle-up charges it", async () => {
    const view = await moneyFor(eventId, `${TAG}.ann@example.invalid`.toLowerCase());
    const pot = view.sideGames.find((g) => g.kind === "birdies");
    expect(pot?.entrants).toBe(3);
    expect(pot?.potCents).toBe(3000);
  });
});
