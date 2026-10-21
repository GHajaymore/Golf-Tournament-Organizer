import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CONFIRMED DRAW MOVES NOBODY, AND A LOCKED ONE SAYS SO (2026-10-21).
 *
 * The flights board hides "move" once the draw is confirmed, and nothing on the SERVER refused it:
 * `movePlayerToGroup` is a public endpoint, and a stale tab or a posted request moved a player out
 * of a confirmed draw. And on a launched tournament the three board actions THREW, which turned the
 * whole board into "This screen didn't load" — a co-organizer launching from another tab was enough.
 * Both found while writing the first browser test of the board; the board cannot press a hidden
 * control, so the refusal is asserted here, against real rows.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CONFIRMEDDRAW";
const email = `${TAG}.secretary@example.invalid`.toLowerCase();

let session: { eventId: string; email: string; viewRole: string; name: string; role: string; userId: string; accountId: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { movePlayerToGroup, renameGroup, setFlightsConfirmed } = await import("@/app/actions/tournament");

const ids = { event: "", a: "", b: "", ann: "" };

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: { organizationId: org.id, name: `${TAG} matchplay`, status: "draft", dates: "", course: "Home", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}` },
  });
  ids.event = event.id;
  await prisma.account.create({ data: { eventId: event.id, email, name: "zz secretary", role: "admin" } });
  const a = await prisma.group.create({ data: { eventId: event.id, name: "Flight A", position: 0 } });
  const b = await prisma.group.create({ data: { eventId: event.id, name: "Flight B", position: 1 } });
  ids.a = a.id;
  ids.b = b.id;
  const ann = await prisma.player.create({ data: { eventId: event.id, name: `${TAG} Ann`, email: `${TAG}.ann@example.invalid`.toLowerCase(), seed: 1, status: "confirmed", groupId: a.id } });
  ids.ann = ann.id;
});

beforeEach(async () => {
  session = { eventId: ids.event, email, viewRole: "admin", name: "zz", role: "admin", userId: "zz", accountId: "" };
  await prisma.event.update({ where: { id: ids.event }, data: { status: "draft", configUnlocked: false, flightsConfirmed: false } });
  await prisma.player.update({ where: { id: ids.ann }, data: { groupId: ids.a } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const annIn = async () => (await prisma.player.findUniqueOrThrow({ where: { id: ids.ann } })).groupId;

describe("a confirmed draw", () => {
  it("CONTROL: an open draw moves a player", async () => {
    const res = await movePlayerToGroup(ids.ann, ids.b);
    expect(res.ok).toBe(true);
    expect(await annIn()).toBe(ids.b);
  });

  it("refuses a move once confirmed, in the board's own words, and moves nobody", async () => {
    await prisma.event.update({ where: { id: ids.event }, data: { flightsConfirmed: true } });
    const res = await movePlayerToGroup(ids.ann, ids.b, true);
    expect(res).toMatchObject({ ok: false, error: "Draw confirmed. Reopen it to move anyone." });
    expect(await annIn(), "a confirmed draw moved a player").toBe(ids.a);
  });
});

describe("a launched tournament's flights board", () => {
  it("answers each press with a sentence rather than an error, and changes nothing", async () => {
    await prisma.event.update({ where: { id: ids.event }, data: { status: "live" } });
    const want = { ok: false, error: "Configuration is locked. Unlock the tournament to change the flights." };
    await expect(movePlayerToGroup(ids.ann, ids.b, true)).resolves.toMatchObject(want);
    await expect(renameGroup(ids.a, "Renamed")).resolves.toMatchObject(want);
    await expect(setFlightsConfirmed(true)).resolves.toMatchObject(want);
    expect(await annIn()).toBe(ids.a);
    expect((await prisma.group.findUniqueOrThrow({ where: { id: ids.a } })).name).toBe("Flight A");
  });
});
