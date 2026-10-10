import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * COMPLETING A TOURNAMENT KEEPS THE CONSOLE ON IT (2026-10-10).
 *
 * With no active-event cookie — a fresh device — the console shows the
 * organizer's tournament being played now (`landingEvent`). Walked as a club
 * secretary with two live tournaments: Complete on one, and the next screen was
 * the OTHER one's leaderboard, at the moment the prizes were to be awarded.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { createSession, getSession } from "@/lib/auth";
import { setEventStatus } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-COMPLETE-STAYS";
const at = `${TAG}.org@example.invalid`.toLowerCase();
const ids: Record<string, string> = {};
let userId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: at } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  userId = (await prisma.user.create({ data: { email: at, name: "Secretary", password: "x:unusable" }, select: { id: true } })).id;
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId, role: "owner" } });
  for (const key of ["older", "newer"]) {
    ids[key] = (
      await prisma.event.create({
        data: { name: `${TAG} ${key}`, organizationId: org.id, status: "live", format: "stroke", dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${key}` },
        select: { id: true },
      })
    ).id;
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("completing the tournament the console landed on", () => {
  it("stays on that tournament afterwards", async () => {
    jar.clear();
    await createSession(userId);
    // No active-event cookie: the console lands on one of the two live ones.
    const landed = (await getSession())!.eventId;
    expect([ids.older, ids.newer]).toContain(landed);
    expect((await setEventStatus("completed")).ok).toBe(true);
    expect((await prisma.event.findUnique({ where: { id: landed }, select: { status: true } }))?.status).toBe("completed");
    expect((await getSession())!.eventId, "the console moved to the other live tournament").toBe(landed);
  });
});
