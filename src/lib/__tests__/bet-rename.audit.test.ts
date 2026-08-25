import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Renaming a side bet, against real rows.
 *
 * The name is not a label on a bet — it IS the bet's key. Every game hangs off
 * `(round, kind, name)`, the settle-up groups by it, and `potAudience` reads it
 * to decide who a pot may charge. So every case here is about money moving, or
 * failing to.
 *
 * The reason the feature exists is the first test below: delete-and-recreate
 * was the only way to fix a typo, and both entry tables are `onDelete:
 * Cascade`, so it destroyed the entrant rows INCLUDING `confirmed` — the record
 * of who actually handed over cash.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-RENAME";

let session: { eventId: string; email: string; viewRole: string; name: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { renameBet } = await import("@/app/actions/bet-name");

let eventId = "";
let stageId = "";
const player: Record<string, string> = {};
const email: Record<string, string> = {};

const OURS = "Satrday sweep"; // the typo the feature exists for
const FIXED = "Saturday sweep";

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
      name: `${TAG} open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  stageId = stage.id;

  for (const [i, who] of ["ann", "bob", "cat"].entries()) {
    const addr = `${TAG}.${who}@example.invalid`.toLowerCase();
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: addr, seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    email[who] = addr;
  }

  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheet: JSON.stringify({
        savedAt: "",
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [player.ann] },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [player.bob, player.cat] },
        ],
      }),
    },
  });
});

/**
 * Ann and Bob's bet, misspelled: a skins pot AND a birdie pot under one name,
 * with a paid stake and an unpaid one, which is what a rename has to carry.
 */
beforeEach(async () => {
  await prisma.skinsPot.deleteMany({ where: { stageId } });
  await prisma.sideGame.deleteMany({ where: { eventId } });

  const pot = await prisma.skinsPot.create({
    data: { eventId, stageId, buyInCents: 2000, net: true, scope: "full", groupKey: OURS },
  });
  await prisma.skinsEntry.createMany({
    data: [player.ann, player.bob].map((playerId) => ({ potId: pot.id, playerId })),
  });

  const game = await prisma.sideGame.create({
    data: { eventId, stageId, kind: "birdies", buyInCents: 500, groupKey: OURS },
  });
  await prisma.sideGameEntry.createMany({
    data: [
      { sideGameId: game.id, playerId: player.ann, confirmed: true },
      { sideGameId: game.id, playerId: player.bob, confirmed: false },
    ],
  });

  session = { eventId, email: email.ann, viewRole: "player", name: "ann" };
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const namesOn = async () => {
  const pots = await prisma.skinsPot.findMany({ where: { stageId }, select: { groupKey: true } });
  const games = await prisma.sideGame.findMany({ where: { eventId }, select: { groupKey: true } });
  return [...pots, ...games].map((r) => r.groupKey).sort();
};

describe("renaming a bet keeps the money and the record of it", () => {
  it("carries the entrants across, and WHO HAD PAID", async () => {
    /**
     * THE REASON THE FEATURE EXISTS.
     *
     * Delete-and-recreate was the only way to fix a typo, and both entry
     * tables cascade — so it destroyed `confirmed`, which is the only record
     * that somebody handed over cash. Asking four people who has paid and
     * re-ticking them from memory is not a way to fix a spelling.
     */
    const before = await prisma.sideGameEntry.findMany({
      where: { sideGame: { groupKey: OURS } },
      select: { playerId: true, confirmed: true },
      orderBy: { playerId: "asc" },
    });

    expect(await renameBet(stageId, OURS, FIXED)).toEqual({ ok: true });

    const after = await prisma.sideGameEntry.findMany({
      where: { sideGame: { groupKey: FIXED } },
      select: { playerId: true, confirmed: true },
      orderBy: { playerId: "asc" },
    });
    expect(after).toEqual(before);
    expect(after.filter((e) => e.confirmed)).toHaveLength(1);

    const skins = await prisma.skinsEntry.count({ where: { pot: { groupKey: FIXED } } });
    expect(skins, "the skins entrants came too").toBe(2);
  });

  it("moves EVERY game under the name, not the one you were looking at", async () => {
    // A crew running skins and a birdie pot as one bet settles as one bet.
    // Moving one row splits their money into two labels and leaves half of it
    // under a name nobody recognises.
    await renameBet(stageId, OURS, FIXED);
    expect(await namesOn()).toEqual([FIXED, FIXED]);
  });

  it("refuses a name another game already has, whatever kind it is", async () => {
    // The unique keys would not catch this: a skins pot moving onto a name
    // that only holds a birdie pot violates nothing, and the two would
    // silently become one crew's money under one label.
    await prisma.sideGame.create({
      data: { eventId, stageId, kind: "eagles", buyInCents: 100, groupKey: "Nassau crew" },
    });
    expect(await renameBet(stageId, OURS, "Nassau crew")).toMatchObject({ ok: false });
    expect(await namesOn()).toEqual([OURS, OURS, "Nassau crew"].sort());
  });

  it("refuses to point a bet at a fourball the renamer is not in", async () => {
    // THE HOLE THIS CLOSES: rename as a way to acquire an identity you could
    // not have created. Pointed at "Group 2", `potAudience` resolves the
    // audience to Bob and Cat — and in opt-out mode that charges them.
    expect(await renameBet(stageId, OURS, "Group 2")).toEqual({
      ok: false,
      error: "Only somebody in that group can run its game",
    });
    expect(await namesOn()).toEqual([OURS, OURS]);
  });

  it("refuses somebody who is not in the bet", async () => {
    session = { eventId, email: email.cat, viewRole: "player", name: "cat" };
    expect(await renameBet(stageId, OURS, FIXED)).toMatchObject({ ok: false });
    expect(await namesOn()).toEqual([OURS, OURS]);
  });

  it("refuses to rename the club's own pot, which has no name to change", async () => {
    // An empty key is the tournament's money. Naming it would make
    // `potAudience` resolve it against the tee sheet — the field's pot
    // quietly becoming one fourball's.
    expect(await renameBet(stageId, "", "Anything")).toMatchObject({ ok: false });
  });

  it("refuses an empty new name and one too long to be a name", async () => {
    expect(await renameBet(stageId, OURS, "   ")).toMatchObject({ ok: false });
    expect(await renameBet(stageId, OURS, "x".repeat(41))).toMatchObject({ ok: false });
    expect(await namesOn()).toEqual([OURS, OURS]);
  });

  it("says so when there is no bet by that name", async () => {
    expect(await renameBet(stageId, "Never existed", FIXED)).toMatchObject({ ok: false });
  });

  it("treats renaming to the same name as nothing to do", async () => {
    expect(await renameBet(stageId, OURS, OURS)).toEqual({ ok: true });
    expect(await namesOn()).toEqual([OURS, OURS]);
  });

  it("writes it down, because it moved somebody's money to a new label", async () => {
    await renameBet(stageId, OURS, FIXED);
    const log = await prisma.auditLog.findFirst({
      where: { eventId, action: "bet.rename" },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.detail).toContain(OURS);
    expect(log?.detail).toContain(FIXED);
  });

  it("lets staff rename a fourball's bet", async () => {
    session = { eventId, email: `${TAG}.staff@example.invalid`, viewRole: "admin", name: "Staff" };
    expect(await renameBet(stageId, OURS, FIXED)).toEqual({ ok: true });
  });
});
