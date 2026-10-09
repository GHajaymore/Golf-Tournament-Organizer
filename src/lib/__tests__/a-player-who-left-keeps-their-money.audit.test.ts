import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { roundMoneyFor } from "@/lib/services/expenses";

/**
 * A PLAYER WHO LEFT THE FIELD STILL HAS THEIR MONEY (2026-10-08).
 *
 * Walked as grid cell T44: $10 gross skins, four in, the round closed. Cat
 * made the only birdie of the day and was then disqualified. Her card cannot
 * win — the 1st carries and Ann's birdie on the 2nd takes both skins, $40 —
 * and she forfeits her stake, the standard ruling: the console's settle-up
 * read "Cat pays Ann $10.00". Cat's own Money screen bounced her to Today,
 * because only CONFIRMED players were looked for, and every other player's
 * round listing called her "Unknown".
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LEFTMONEY";
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const at = (n: string) => `${TAG}.${n}@example.invalid`.toLowerCase();
const card = (birdies: number[]) => JSON.stringify(PARS.map((p, i) => (birdies.includes(i) ? p - 1 : p)));
let eventId = "";

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
  const stageId = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross", closedAt: new Date() },
    })
  ).id;
  const pot = await prisma.skinsPot.create({ data: { eventId, stageId, buyInCents: 1000, net: false } });
  const field: Array<[string, string, number[]]> = [
    ["Ann", "confirmed", [1]],
    ["Bea", "confirmed", []],
    ["Cat", "disqualified", [0, 1]],
    ["Dan", "confirmed", []],
  ];
  for (const [i, [name, status, birdies]] of field.entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${name}`, email: at(name), seed: i + 1, status, handicap: 0 },
    });
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: p.id, strokes: card(birdies), status: "approved" } });
    await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: p.id, confirmed: true } });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a disqualified player who paid into the skins", () => {
  it("is found on their own Money screen, owing the stake they forfeited", async () => {
    const cat = await roundMoneyFor(eventId, at("Cat"));
    expect(cat.playerId, "Cat's Money screen bounces her to Today").not.toBe("");
    expect(cat.yourTotalCents).toBe(-1000);
  });

  it("is named on everybody else's, not 'Unknown'", async () => {
    const ann = await roundMoneyFor(eventId, at("Ann"));
    expect(ann.yourTotalCents, "Ann holds both skins, $40 less her $10").toBe(3000);
    const names = ann.rounds.flatMap((r) => r.standing.map((s) => s.name));
    expect(names).toContain(`${TAG} Cat`);
    expect(names).not.toContain("Unknown");
  });

  it("and somebody with no entry at all is still nobody — the control", async () => {
    expect((await roundMoneyFor(eventId, at("stranger"))).playerId).toBe("");
  });
});
