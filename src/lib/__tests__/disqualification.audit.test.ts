import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

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

import { createSession, setActiveEvent } from "@/lib/auth";
import { disqualifyPlayer, reinstatePlayer } from "@/app/actions/disqualify";

/**
 * THE COMMITTEE'S RULING, AS AN ACTION (2026-10-08).
 *
 * Staff only — a player cannot disqualify somebody, nor reinstate themselves.
 * A reason is required, because it is the first thing anybody asks and it has
 * to be on the record. Not behind the setup lock: rulings are made live.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DQ";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let eventId = "";
const player: Record<string, string> = {};
const user: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function signIn(who: string) {
  jar.clear();
  await createSession(user[who]);
  await setActiveEvent(eventId);
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  // Live, so configuration is LOCKED — the state a ruling is made in.
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      status: "live",
      configUnlocked: false,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  eventId = event.id;
  for (const [i, who] of ["ann", "bea"].entries()) {
    player[who] = (
      await prisma.player.create({ data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed" } })
    ).id;
  }
  for (const [who, role] of [["org", "admin"], ["bea", "player"]] as const) {
    user[who] = (await prisma.user.create({ data: { email: at(who), name: who, password: "x" } })).id;
    await prisma.account.create({ data: { eventId, email: at(who), name: who, role } });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const statusOf = async (who: string) => (await prisma.player.findUnique({ where: { id: player[who] } }))!.status;

describe("disqualifying a player", () => {
  it("is refused to a player", async () => {
    await signIn("bea");
    await expect(disqualifyPlayer(player.ann, "Signed for a wrong score")).rejects.toThrow();
    expect(await statusOf("ann")).toBe("confirmed");
  });

  it("needs a reason", async () => {
    await signIn("org");
    const res = await disqualifyPlayer(player.ann, "   ");
    expect(res.ok).toBe(false);
    expect(await statusOf("ann")).toBe("confirmed");
  });

  it("is the committee's to make, on a live locked tournament, with the reason on the record", async () => {
    await signIn("org");
    const res = await disqualifyPlayer(player.ann, "Returned a score lower than actually taken (Rule 3.3b)");
    expect(res.ok).toBe(true);
    expect(await statusOf("ann")).toBe("disqualified");
    const line = await prisma.auditLog.findFirst({ where: { eventId, action: "disqualified" } });
    expect(line?.detail).toMatch(/Rule 3\.3b/);
  });

  it("and reinstating undoes it — refused to a player, and recorded", async () => {
    await signIn("bea");
    await expect(reinstatePlayer(player.ann)).rejects.toThrow();
    await signIn("org");
    expect((await reinstatePlayer(player.ann)).ok).toBe(true);
    expect(await statusOf("ann")).toBe("confirmed");
    expect(await prisma.auditLog.count({ where: { eventId, action: "reinstated" } })).toBe(1);
  });
});
