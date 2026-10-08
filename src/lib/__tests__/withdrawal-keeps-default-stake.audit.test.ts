import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * WITHDRAWING IS NOT A REFUND — FOR A STAKE PAID BY DEFAULT TOO (2026-10-07).
 *
 * An "everyone in the field" pot counts a player with no entry row as in and
 * paid. Taking them out of the field left nothing to say they had paid, and
 * the stake vanished: walked on a casual round, Cat paid into a $10 birdie
 * pot, birdied the 3rd, left at the turn — and read "square". Now the default
 * stake is written down as TAKEN when they leave.
 *
 * The half that must not move is asserted beside it: only on a round they
 * have a card in (a tournament entrant who withdraws before round 2 never put
 * money into round 2's pot), never over a decision already made, and never on
 * a Nassau, which is settled by the match rather than a pot.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LEAVERSTAKE";
const email = `${TAG}.host@example.invalid`.toLowerCase();

let session: { eventId: string; email: string; viewRole: string; name: string; role: string; userId: string; accountId: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { removeSignup } = await import("@/app/actions/tournament");

const ids = { event: "", r1: "", r2: "", cat: "", birdies1: "", birdies2: "", lowGross1: "", nassau1: "" };
const NINE = [4, 5, 2, 4, 4, 4, 3, 4, 5, null, null, null, null, null, null, null, null, null];

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
      name: `${TAG} two rounds`,
      status: "live",
      configUnlocked: true,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  await prisma.account.create({ data: { eventId: event.id, email, name: "zz host", role: "admin" } });
  const r1 = await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  const r2 = await prisma.stage.create({ data: { eventId: event.id, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  for (const [i, n] of ["Ann", "Bea", "Dot"].entries()) {
    await prisma.player.create({ data: { eventId: event.id, name: `${TAG} ${n}`, email: `${TAG}.${n}@example.invalid`.toLowerCase(), seed: i + 2, status: "confirmed" } });
  }
  const cat = await prisma.player.create({ data: { eventId: event.id, name: `${TAG} Cat`, email: `${TAG}.cat@example.invalid`.toLowerCase(), seed: 1, status: "confirmed" } });
  const game = (stageId: string, kind: string) =>
    prisma.sideGame.create({ data: { eventId: event.id, stageId, kind, buyInCents: 1000, entryMode: "opt-out" } });
  const [b1, b2, lg1, n1] = await Promise.all([game(r1.id, "birdies"), game(r2.id, "birdies"), game(r1.id, "low-gross"), game(r1.id, "nassau")]);
  Object.assign(ids, { event: event.id, r1: r1.id, r2: r2.id, cat: cat.id, birdies1: b1.id, birdies2: b2.id, lowGross1: lg1.id, nassau1: n1.id });
});

beforeEach(async () => {
  session = { eventId: ids.event, email, viewRole: "admin", name: "zz host", role: "admin", userId: "zz", accountId: "" };
  await prisma.player.update({ where: { id: ids.cat }, data: { status: "confirmed" } });
  await prisma.sideGameEntry.deleteMany({ where: { playerId: ids.cat } });
  await prisma.scorecard.deleteMany({ where: { eventId: ids.event } });
  // Cat played the front nine of round 1 and nothing of round 2.
  await prisma.scorecard.create({ data: { eventId: ids.event, stageId: ids.r1, playerId: ids.cat, strokes: JSON.stringify(NINE) } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const entryOf = (sideGameId: string) => prisma.sideGameEntry.findFirst({ where: { sideGameId, playerId: ids.cat } });

describe("a player who leaves keeps the stake they were in by default", () => {
  it("is kept in every everyone-in pot on a round they played", async () => {
    expect(await removeSignup(ids.cat)).toBe("withdrawn");
    expect(await entryOf(ids.birdies1)).toMatchObject({ confirmed: true, excluded: false });
    expect(await entryOf(ids.lowGross1)).toMatchObject({ confirmed: true, excluded: false });
  });

  it("CONTROL: is not charged into a round they never started", async () => {
    await removeSignup(ids.cat);
    expect(await entryOf(ids.birdies2)).toBeNull();
  });

  it("CONTROL: leaves a decision already made as it is", async () => {
    await prisma.sideGameEntry.create({ data: { sideGameId: ids.birdies1, playerId: ids.cat, confirmed: true, excluded: true } });
    await removeSignup(ids.cat);
    expect(await entryOf(ids.birdies1)).toMatchObject({ excluded: true });
  });

  it("CONTROL: writes nothing to a Nassau, which the match settles", async () => {
    await removeSignup(ids.cat);
    expect(await entryOf(ids.nassau1)).toBeNull();
  });
});
