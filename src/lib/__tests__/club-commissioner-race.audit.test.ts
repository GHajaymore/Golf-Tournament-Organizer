import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Two Commissioners leave at the same moment: exactly one may, the club keeps
 * one (the membership rule asked inside a Serializable transaction). Each
 * caller gets its own cookie jar through AsyncLocalStorage so two people can
 * really act at once. Looped, because a race is not deterministic.
 */

const als = await vi.hoisted(async () => new (await import("node:async_hooks")).AsyncLocalStorage<Map<string, string>>());
vi.mock("next/headers", () => ({
  cookies: async () => {
    const jar = als.getStore()!;
    return {
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => void jar.set(name, value),
      delete: (name: string) => void jar.delete(name),
    };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { createSession, setActiveEvent } from "@/lib/auth";
import { leaveOrganization } from "@/app/actions/organization";
import { deleteMyAccount } from "@/app/actions/account";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-COMMISSIONER-RACE";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let clubId = "";
const ids: Record<string, string> = {};
const jars: Record<string, Map<string, string>> = {};
const as = <T>(who: string, f: () => Promise<T>) => als.run(jars[who], f);

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organizationMember.deleteMany({ where: { user: { email: { startsWith: TAG.toLowerCase() } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const club = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  clubId = club.id;
  const ev = await prisma.event.create({
    data: { organizationId: club.id, name: `${TAG} cup`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${Date.now()}` },
  });
  for (const who of ["a", "b"]) {
    ids[who] = (await prisma.user.create({ data: { email: at(who), name: who, password: "x", emailVerifiedAt: new Date() } })).id;
    jars[who] = new Map();
    await as(who, async () => {
      await createSession(ids[who]);
      await setActiveEvent(ev.id);
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const commissioners = () => prisma.organizationMember.count({ where: { organizationId: clubId, role: "owner" } });

describe("two Commissioners leaving at once", () => {
  it("never leaves the club with none (20 races)", async () => {
    for (let i = 0; i < 20; i++) {
      await prisma.organizationMember.deleteMany({ where: { organizationId: clubId } });
      for (const who of ["a", "b"]) await prisma.organizationMember.create({ data: { organizationId: clubId, userId: ids[who], role: "owner" } });

      // Alternate the second door: leaving, then the other's account deletion.
      const second = i % 2 === 0
        ? () => as("b", () => leaveOrganization(clubId))
        : () => as("b", () => deleteMyAccount(at("b")).catch((e) => ({ ok: /REDIRECT/.test(String(e)) })));
      const results = await Promise.all([as("a", () => leaveOrganization(clubId)), second()]);

      expect(await commissioners(), `race ${i}: the club must keep a Commissioner`).toBeGreaterThanOrEqual(1);
      expect(results.filter((r) => (r as { ok: boolean }).ok).length, `race ${i}: exactly one gets out`).toBe(1);

      if (i % 2 === 1 && (await prisma.user.count({ where: { id: ids.b } })) === 0) {
        ids.b = (await prisma.user.create({ data: { email: at("b"), name: "b", password: "x", emailVerifiedAt: new Date() } })).id;
        await as("b", async () => { await createSession(ids.b); });
      }
    }
  });
});
