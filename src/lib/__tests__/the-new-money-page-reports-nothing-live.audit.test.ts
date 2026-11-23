import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { settleHalfFor } from "@/lib/services/money-settle";

/**
 * WINNERS & MONEY REPORTS NOTHING THAT CAN STILL CHANGE (R8b).
 *
 * Money is final only, never live (`docs/claude/money.md`): a skins pot that is still being played is not a figure anybody
 * may read off a screen, because the next hole can reverse it. The rule is held at the sink (`gameNets`), so a screen written
 * later cannot forget it; the new Winners & money page reads through `settleHalfFor` and draws only what that returns. This
 * asks the page's own loader on a LIVE round and expects no money, and (the control) asks it again once the round is closed
 * and expects the skin Ann has won. A test that could not see money would pass on both.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MONEYLIVE";
const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const at = (n: string) => `${TAG}.${n}@example.invalid`.toLowerCase();
const card = (birdies: number[], through = 18) => JSON.stringify(PARS.map((p, i) => (i >= through ? null : birdies.includes(i) ? p - 1 : p)));

let eventId = "";
let stageId = "";

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
      moneyMode: "split",
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
  // The round is LIVE: nine holes are in and nobody has closed it, so what is on the cards can still change.
  stageId = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" },
    })
  ).id;
  const pot = await prisma.skinsPot.create({ data: { eventId, stageId, buyInCents: 1000, net: false } });
  const field: Array<[string, number[]]> = [
    ["Ann", [1]],
    ["Bea", []],
    ["Cat", []],
    ["Dan", []],
  ];
  for (const [i, [name, birdies]] of field.entries()) {
    const p = await prisma.player.create({ data: { eventId, name: `${TAG} ${name}`, email: at(name), seed: i + 1, status: "confirmed", handicap: 0 } });
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: p.id, strokes: card(birdies, 9), status: "approved" } });
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

const settle = () => settleHalfFor({ eventId, email: at("Ann"), name: `${TAG} Ann`, isStaff: true, moneyMode: "split" });

describe("the loader Winners & money reads through", () => {
  it("reports no money for a round that is still being played", async () => {
    const live = await settle();
    expect(live.ledger, "the ledger is not read for a split tournament").not.toBeNull();
    expect(live.ledger!.gamesCents, "a live pot's money reached the ledger").toBe(0);
    expect(live.ledger!.standing.map((s) => s.netCents), "somebody is up or down on a pot nobody has finished").toEqual(live.ledger!.standing.map(() => 0));
    expect(live.ledger!.transfers, "a handover was worked out for a live round").toEqual([]);
  });

  it("CONTROL: the same loader sees the money once the cards are in and the round is closed", async () => {
    // The cards come in whole and the committee closes the round.
    for (const [name, birdies] of [["Ann", [1]], ["Bea", []], ["Cat", []], ["Dan", []]] as Array<[string, number[]]>) {
      const p = await prisma.player.findFirstOrThrow({ where: { eventId, email: at(name) } });
      await prisma.scorecard.updateMany({ where: { eventId, stageId, playerId: p.id }, data: { strokes: card(birdies) } });
    }
    await prisma.stage.update({ where: { id: stageId }, data: { closedAt: new Date() } });
    const final = await settle();
    const ann = final.ledger!.standing.find((s) => s.name === `${TAG} Ann`);
    expect(ann, "Ann is not on the ledger").toBeTruthy();
    expect(ann!.netCents, "Ann's skin is not in a closed round's ledger, so this test cannot see money").toBeGreaterThan(0);
    expect(final.ledger!.transfers.length, "a closed round has handovers to make").toBeGreaterThan(0);
  });
});
