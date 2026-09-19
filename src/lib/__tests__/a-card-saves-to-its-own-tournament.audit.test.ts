import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CARD SAVES TO THE TOURNAMENT IT BELONGS TO — not to whichever one the
 * switcher opened last.
 *
 * The session names one "active" tournament for every tab. A player entered in
 * two, with one card open while they look at the other, had every save refused
 * because the save asked the ACTIVE tournament about a round in the other. The
 * card actions now take their tournament from the round, and resolve the
 * person's access to it afresh. Asserted against real rows because the rule is
 * a join of session, round, field and membership:
 *
 *   - session on A, card in B where they are entered: saves and certifies;
 *   - a round in C, which they cannot reach at all: refused, nothing written;
 *   - their role in B is B's own: an organizer of A who only PLAYS in B is
 *     held to B's player rules, not waved through as staff.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-OWNCARD";
const email = `${TAG}.player@example.invalid`.toLowerCase();

let session: { eventId: string; email: string; viewRole: string; name: string; role: string; userId: string; accountId: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveScorecard, certifyScorecard } = await import("@/app/actions/tournament");

const ids = { a: "", b: "", c: "", stageB: "", stageC: "", playerB: "", playerC: "" };
const NINE = [4, 5, 3, 4, 4, 4, 3, 4, 5, null, null, null, null, null, null, null, null, null];
const FULL = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function event(name: string, orgId: string, over: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      status: "live",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}`,
      ...over,
    },
  });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const other = await prisma.organization.create({ data: { name: `${TAG} other club`, kind: "club" } });
  const a = await event("A medal", org.id);
  const b = await event("B league", org.id);
  const c = await event("C elsewhere", other.id);
  Object.assign(ids, { a: a.id, b: b.id, c: c.id });

  // Admin of A (runs it), a PLAYER in B, and nothing in C.
  await prisma.account.create({ data: { eventId: a.id, email, name: "zz player", role: "admin" } });
  await prisma.account.create({ data: { eventId: b.id, email, name: "zz player", role: "player" } });
  const stageB = await prisma.stage.create({ data: { eventId: b.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  const stageC = await prisma.stage.create({ data: { eventId: c.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  const pB = await prisma.player.create({ data: { eventId: b.id, name: `${TAG} me`, email, seed: 1, status: "confirmed" } });
  const pC = await prisma.player.create({ data: { eventId: c.id, name: `${TAG} stranger`, email: `${TAG}.x@example.invalid`.toLowerCase(), seed: 1, status: "confirmed" } });
  Object.assign(ids, { stageB: stageB.id, stageC: stageC.id, playerB: pB.id, playerC: pC.id });
});

beforeEach(async () => {
  // The switcher last opened A, where this person is an ADMIN.
  session = { eventId: ids.a, email, viewRole: "admin", name: "zz", role: "admin", userId: "zz", accountId: "" };
  await prisma.scorecard.deleteMany({ where: { stageId: { in: [ids.stageB, ids.stageC] } } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a card saves to its own tournament", () => {
  it("saves a card in B while the session is on A", async () => {
    const res = await saveScorecard(ids.stageB, ids.playerB, NINE);
    expect(res.ok).toBe(true);
    const row = await prisma.scorecard.findFirst({ where: { stageId: ids.stageB, playerId: ids.playerB } });
    expect(row?.eventId).toBe(ids.b);
  });

  it("certifies it there too", async () => {
    await saveScorecard(ids.stageB, ids.playerB, FULL);
    await certifyScorecard(ids.stageB, ids.playerB);
    const row = await prisma.scorecard.findFirst({ where: { stageId: ids.stageB, playerId: ids.playerB } });
    expect(row?.status).toBe("certified");
  });

  it("refuses a round in a tournament they cannot reach, and writes nothing", async () => {
    await expect(saveScorecard(ids.stageC, ids.playerC, NINE)).rejects.toThrow();
    expect(await prisma.scorecard.findFirst({ where: { stageId: ids.stageC } })).toBeNull();
  });

  it("holds them to B's rules: an organizer of A is only a player in B", async () => {
    // B stops taking player scores. Staff would still pass; a player may not.
    await prisma.event.update({ where: { id: ids.b }, data: { scoreEntryBy: "staff" } });
    try {
      await expect(saveScorecard(ids.stageB, ids.playerB, NINE)).rejects.toThrow(/entered by the organizer/);
    } finally {
      await prisma.event.update({ where: { id: ids.b }, data: { scoreEntryBy: "players" } });
    }
  });
});
