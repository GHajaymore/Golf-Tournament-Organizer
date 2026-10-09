import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { roundMoneyFor, sidePotResults } from "@/lib/services/expenses";

/**
 * THE ORGANIZER SEES WHAT A CARD-SETTLED POT PAID (2026-10-09, grid cell T59).
 *
 * A $5 Twos pot, four in, the round closed: Ann made two twos, Bea one. Each
 * player's Money screen had the right figure; the committee's Prizes screen
 * showed only the stake and who was in, so whoever pays out at the bar had no
 * screen naming who made the twos. `sidePotResults` reads the same pass that
 * pays the players, and this pins the two to each other.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-POTPAID";
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const at = (n: string) => `${TAG}.${n}@example.invalid`.toLowerCase();
let eventId = "";
let stageId = "";
let gameId = "";
const ids: Record<string, string> = {};

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
        organizationId: org.id, name: `${TAG} medal`, status: "live", dates: "", course: "Home", city: "", address: "",
        regDeadline: "", shareToken: `${TAG}-${process.pid}`, customPars: JSON.stringify(PARS),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    })
  ).id;
  stageId = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross", closedAt: new Date() },
    })
  ).id;
  // Par 3s are holes 3, 7, 12 and 16 (indexes 2, 6, 11, 15).
  const twos: Record<string, number[]> = { Ann: [2, 11], Bea: [6], Cat: [], Dan: [] };
  for (const [i, n] of ["Ann", "Bea", "Cat", "Dan"].entries()) {
    const p = await prisma.player.create({ data: { eventId, name: `${TAG} ${n}`, email: at(n), seed: i + 1, status: "confirmed" } });
    ids[n] = p.id;
    await prisma.scorecard.create({
      data: { eventId, stageId, playerId: p.id, strokes: JSON.stringify(PARS.map((par, h) => (twos[n].includes(h) ? 2 : par))), status: "approved" },
    });
  }
  gameId = (
    await prisma.sideGame.create({ data: { eventId, stageId, kind: "twos", buyInCents: 500, entryMode: "opt-out", groupKey: "" } })
  ).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a Twos pot once the round is closed", () => {
  it("is on the organizer's screen, paying exactly what each player's own screen says", async () => {
    const nets = (await sidePotResults(eventId, stageId)).get(gameId);
    expect(nets, "the organizer has no result for the pot").toBeDefined();
    const of = (n: string) => nets!.find((x) => x.playerId === ids[n])?.netCents ?? 0;
    expect(of("Ann")).toBeGreaterThan(of("Bea"));
    expect(of("Bea")).toBeGreaterThan(0);
    expect(of("Cat")).toBe(-500);
    expect(of("Dan")).toBe(-500);
    expect(nets!.reduce((s, x) => s + x.netCents, 0), "the pot does not balance").toBe(0);
    for (const n of ["Ann", "Bea", "Cat", "Dan"]) {
      expect((await roundMoneyFor(eventId, at(n))).yourTotalCents, `${n}'s own screen disagrees`).toBe(of(n));
    }
  });

  it("is absent while the round can still change — the control", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { closedAt: null } });
    await prisma.scorecard.updateMany({
      where: { stageId, playerId: ids.Dan },
      data: { strokes: JSON.stringify(PARS.map((p, h) => (h < 9 ? p : null))), status: "entered" },
    });
    try {
      expect((await sidePotResults(eventId, stageId)).has(gameId)).toBe(false);
    } finally {
      await prisma.scorecard.updateMany({ where: { stageId, playerId: ids.Dan }, data: { strokes: JSON.stringify(PARS), status: "approved" } });
      await prisma.stage.update({ where: { id: stageId }, data: { closedAt: new Date() } });
    }
  });
});
