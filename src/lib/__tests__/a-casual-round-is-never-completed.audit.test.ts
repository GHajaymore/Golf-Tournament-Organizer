import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CASUAL ROUND IS NEVER COMPLETED (the Tournament Director, 16 Nov).
 *
 * A casual round has no Committee: nobody signs its cards off and it has no
 * result to release. It is kept, or it ends when its time runs out. The state
 * machine already said so — no Complete and no Reopen for one (`nextAction` is
 * null) — and no screen draws Complete for it: the dashboard sends it to Score
 * entry and the casual screen has no such button.
 *
 * But `setEventStatus` is a `"use server"` export, a public endpoint, and
 * `refusals.complete` never asked the family. Called with "completed" on a
 * casual round it closed every round (scores and the field then refused) and
 * left no Reopen: a dead end. The refusal is now the machine's, so the action
 * refuses in its words and writes nothing.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CASUAL-COMPLETE";
const EMAIL = `${TAG}.host@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} host`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { setEventStatus } = await import("@/app/actions/tournament");
const { CASUAL_IS_NEVER_COMPLETED } = await import("@/lib/domain/tournament-status");

let orgId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** An event of `shape` at `status`, one match-play round, two invented players, the host on it. */
async function eventOf(name: string, shape: string, status: string) {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      status,
      shape,
      dates: "Saturday",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}`.slice(0, 60),
      ...(status === "live" ? { launchedAt: new Date() } : {}),
    },
  });
  await prisma.account.create({ data: { eventId: event.id, email: EMAIL, name: `${TAG} host`, role: "admin" } });
  await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  for (let i = 0; i < 2; i += 1) {
    await prisma.player.create({
      data: { eventId: event.id, name: `${TAG} player ${i + 1}`, email: `${TAG}.p${i}@example.invalid`.toLowerCase(), handicap: 10, seed: i + 1, status: "confirmed" },
    });
  }
  session.eventId = event.id;
  return event.id;
}

const read = async (id: string) => {
  const e = await prisma.event.findUnique({ where: { id }, select: { status: true, completedAt: true } });
  const rounds = await prisma.stage.findMany({ where: { eventId: id }, select: { closedAt: true } });
  return { status: e?.status, completedAt: e?.completedAt ?? null, closed: rounds.filter((r) => r.closedAt !== null).length };
};

beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the public action refuses to complete a casual round, and stores nothing", () => {
  it("a live casual round: refused in the machine's words; still live, no round closed, no completion stamped", async () => {
    const id = await eventOf("casual", "match", "live");
    const before = await read(id);
    expect(before.status).toBe("live");
    const res = await setEventStatus("completed");
    expect(res).toEqual({ ok: false, error: CASUAL_IS_NEVER_COMPLETED });
    // Even with every confirmation a caller could send.
    expect(await setEventStatus("completed", true, true)).toEqual({ ok: false, error: CASUAL_IS_NEVER_COMPLETED });
    expect(await read(id)).toEqual(before);
  });

  it("CONTROL: the same press on a tournament of the same round is not refused for being casual", async () => {
    // A stroke-play tournament, launched: the refusal above is the family's, not the round's or the action's.
    await eventOf("tournament", "stroke", "live");
    const res = await setEventStatus("completed");
    expect(res.error ?? "").not.toBe(CASUAL_IS_NEVER_COMPLETED);
  });
});
