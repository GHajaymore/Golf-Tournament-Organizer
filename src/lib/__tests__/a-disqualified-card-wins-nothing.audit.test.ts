import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { moneyFor } from "@/lib/services/expenses";

/**
 * A DISQUALIFIED PLAYER'S CARD WINS NOTHING, AND THEIR STAKE STAYS IN
 * (2026-10-08).
 *
 * Disqualified from the competition is no score in it (Rule 3.3b), and the
 * skins are played off that same card. Ann birdies the 1st and is then DQ'd
 * for returning a card lower than she took; Cat birdies the 2nd. With Ann's
 * card out, nobody wins the 1st outright, it carries, and Cat's birdie on the
 * 2nd takes both skins and the whole $30 — with Ann's $10 still in it.
 *
 * The CONTROL is the same round with Ann not disqualified: one skin each for
 * Ann and Cat, $15 apiece. Without it, a pot that never paid Ann anything for
 * some other reason would pass the first case.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DQSKINS";
const PARS = new Array(18).fill(4);
let eventId = "";
const ids: Record<string, string> = {};

const card = (birdieAt: number | null) => JSON.stringify(PARS.map((p, i) => (i === birdieAt ? p - 1 : p)));

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
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross", closedAt: new Date() },
  });
  const pot = await prisma.skinsPot.create({ data: { eventId, stageId: stage.id, buyInCents: 1000, net: false } });
  for (const [i, [n, birdie]] of ([["Ann", 0], ["Bea", null], ["Cat", 1]] as const).entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${n}`, email: `${TAG}.${n}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed" },
    });
    ids[n] = p.id;
    await prisma.scorecard.create({ data: { eventId, stageId: stage.id, playerId: p.id, strokes: card(birdie), status: "approved" } });
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

const nets = async () => {
  const view = await moneyFor(eventId, `${TAG}.bea@example.invalid`.toLowerCase());
  const by = new Map(view.standing.map((s) => [s.playerId, s.netCents]));
  return (n: string) => by.get(ids[n]) ?? 0;
};

describe("a skins pot with a disqualified player in it", () => {
  it("pays the disqualified player nothing, and keeps their stake in the pot", async () => {
    await prisma.player.update({ where: { id: ids.Ann }, data: { status: "disqualified" } });
    try {
      const net = await nets();
      expect(net("Ann"), "a disqualified card collected a skin").toBe(-1000);
      expect(net("Bea")).toBe(-1000);
      // The 1st carries to the 2nd: Cat's birdie takes both skins and the $30.
      expect(net("Cat")).toBe(2000);
    } finally {
      await prisma.player.update({ where: { id: ids.Ann }, data: { status: "confirmed" } });
    }
  });

  it("pays Ann her skin while she is in the competition — the control", async () => {
    const net = await nets();
    expect(net("Ann")).toBe(500);
    expect(net("Cat")).toBe(500);
    expect(net("Bea")).toBe(-1000);
  });
});
