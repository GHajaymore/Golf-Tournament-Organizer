import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { potStatusFor } from "@/lib/services/money-settle";
import { potStatusLine } from "@/lib/domain/pot-status";
import { potMembership } from "@/lib/domain/pot-entry";

/**
 * THE POT STATUS LINE ON WINNERS & MONEY AGREES WITH THE CARDS BESIDE IT (R8b, PE item 8).
 *
 * The line says how far the field's pots and contests have got ("1 of 2 contests have a winner. 6 of 7 stakes paid."). The cards
 * decide who is in through \`potMembership\`; a line that counted ROWS would contradict them. Four games on real rows:
 *   - an OPT-OUT paid contest: its members have no row at all (one took themselves out);
 *   - a FREE contest with a winner: a contest, but no stake;
 *   - a paid side game with a PENDING request: pending is owed, not paid;
 *   - a normal paid skins pot: two stakes in.
 * The expected figures are worked out here from the cards' own question and then written out by hand.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-POTSTATUS";
const at = (n: string) => `${TAG}.${n}@example.invalid`.toLowerCase();
let eventId = "";
const ids: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: { organizationId: org.id, name: `${TAG} medal`, status: "live", dates: "", course: "Home", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}` },
  });
  eventId = event.id;
  const stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } })).id;
  for (const [i, n] of ["Ann", "Bea", "Cat", "Dan"].entries()) {
    ids[n] = (await prisma.player.create({ data: { eventId, name: `${TAG} ${n}`, email: at(n), seed: i + 1, status: "confirmed", handicap: 0 } })).id;
  }
  // 1. Opt-out, paid: Dan took himself out; nobody else has a row.
  const optOut = await prisma.contest.create({ data: { eventId, stageId, kind: "closest-pin", name: `${TAG} KP`, hole: 3, buyInCents: 500, entryMode: "opt-out" } });
  await prisma.contestEntry.create({ data: { contestId: optOut.id, playerId: ids.Dan, excluded: true, confirmed: true } });
  // 2. Free, with a winner.
  const free = await prisma.contest.create({ data: { eventId, stageId, kind: "long-drive", name: `${TAG} LD`, hole: 5, buyInCents: 0 } });
  await prisma.contestEntry.create({ data: { contestId: free.id, playerId: ids.Ann, won: true, confirmed: true } });
  // 3. Paid side game, opt-in: Ann has paid, Bea has only asked.
  const game = await prisma.sideGame.create({ data: { eventId, stageId, kind: "birdies", groupKey: "", buyInCents: 500 } });
  await prisma.sideGameEntry.createMany({
    data: [
      { sideGameId: game.id, playerId: ids.Ann, confirmed: true },
      { sideGameId: game.id, playerId: ids.Bea, confirmed: false },
    ],
  });
  // 4. A normal paid skins pot, two in.
  const pot = await prisma.skinsPot.create({ data: { eventId, stageId, buyInCents: 1000, net: false } });
  await prisma.skinsEntry.createMany({
    data: [
      { potId: pot.id, playerId: ids.Ann, confirmed: true },
      { potId: pot.id, playerId: ids.Cat, confirmed: true },
    ],
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the line Winners & money draws", () => {
  it("counts each game the way its card does, and says so", async () => {
    const field = Object.values(ids);
    // What the cards show, asked of the same function they ask.
    const kp = await prisma.contest.findFirstOrThrow({ where: { eventId, kind: "closest-pin" }, include: { entrants: true } });
    const kpCard = potMembership("opt-out", field, kp.entrants, field);
    expect(kpCard.entrants.length, "the opt-out contest's card lists the whole field but the one who left").toBe(3);
    const sg = await prisma.sideGame.findFirstOrThrow({ where: { eventId }, include: { entrants: true } });
    const sgCard = potMembership("opt-in", field, sg.entrants, field);
    expect([sgCard.entrants.length, sgCard.pending.length], "the side game's card shows one paid and one pending").toEqual([1, 1]);

    const status = await potStatusFor(eventId);
    expect(status).toEqual({
      contests: 2,
      contestsWithWinner: 1,
      // opt-out KP 3 + side game (1 paid + 1 pending) + skins 2; the free contest is no stake.
      stakes: 3 + 2 + 2,
      // 3 + 1 + 2: the pending request is owed, not paid.
      stakesPaid: 3 + 1 + 2,
    });
    expect(potStatusLine(status)).toBe("1 of 2 contests have a winner. 6 of 7 stakes paid.");
  });
});
