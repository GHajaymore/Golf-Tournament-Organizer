import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE FREE PLAN'S TERMS, FOR NEW CLUBS ONLY (Ajay, 2026-09-29):
 *
 *   - ten players a tournament, one tournament at a time, one organizer;
 *   - a tournament is deleted the moment it is marked Completed — after a
 *     confirmation, never without one;
 *   - every club that existed before is grandfathered: nothing capped, nothing
 *     deleted.
 *
 * Driven through the real actions against real rows, because this is the one
 * change in the app whose failure is somebody's results gone. Every deleting
 * assertion has a keeping CONTROL beside it — grandfathered, paid, held,
 * unconfirmed — so a rule that deletes everything cannot pass, and neither can
 * one that deletes nothing.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FREE-TERMS";
const session = { email: "", name: `${TAG} organizer`, eventId: "", role: "admin", viewRole: "admin", userId: "", accountId: "" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const { createEvent, setEventStatus, applyManualCount } = await import("@/app/actions/tournament");
const { createOrganizationWithOwner } = await import("@/lib/services/organization");

const emailFor = (who: string) => `zz-audit-free-terms-${who}@example.invalid`;
const WHO = ["new", "old", "paid", "held", "cap", "fresh"];

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.user.deleteMany({ where: { email: { in: WHO.map(emailFor) } } });
}

/** Sign in as `who`, with a club on `plan`, held to the terms or grandfathered. */
async function organizer(who: string, plan: string, termsApply: boolean) {
  session.email = emailFor(who);
  const user = await prisma.user.create({ data: { email: session.email, name: `${TAG} ${who}` } });
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} ${who}`,
      kind: "personal",
      subscription: { create: { plan, planTermsApply: termsApply } },
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  return org.id;
}

/** Create a tournament as the signed-in organizer and make it the session's one. */
async function tournament(name: string) {
  const res = await createEvent(`${TAG} ${name}`, "custom", "single");
  const ev = await prisma.event.findFirst({ where: { name: `${TAG} ${name}` } });
  return { res, ev };
}

const exists = async (id: string) => (await prisma.event.count({ where: { id } })) === 1;

/** Complete it, confirmed, and report whether the action deleted and redirected. */
async function completeConfirmed() {
  try {
    const res = await setEventStatus("completed", true);
    return { redirected: false, res };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.startsWith("REDIRECT")) throw e;
    return { redirected: true, res: null };
  }
}

beforeAll(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("a club created from now on is on the published terms", () => {
  it("is marked so at birth", async () => {
    session.email = emailFor("fresh");
    const orgId = await createOrganizationWithOwner({
      email: session.email,
      displayName: `${TAG} fresh`,
      orgName: `${TAG} fresh`,
    });
    const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
    expect(sub?.planTermsApply).toBe(true);
    expect(sub?.plan).toBe("free");
  });
});

describe("a new Free club", () => {
  let eventId = "";

  it("starts its tournament at ten places, not an open field", async () => {
    await organizer("new", "free", true);
    const { res, ev } = await tournament("new one");
    expect(res?.ok).toBe(true);
    expect(ev!.capacity).toBe(10);
    eventId = ev!.id;
    session.eventId = eventId;
  });

  it("cannot run a second tournament at the same time", async () => {
    const { res, ev } = await tournament("new two");
    expect(res?.ok).toBe(false);
    expect(res?.error).toMatch(/1 active tournament/);
    expect(ev).toBeNull();
  });

  it("cannot pad the field past ten", async () => {
    const res = await applyManualCount(12, true);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/up to 10 players/);
  });

  it("is ASKED before completing deletes anything, and nothing is deleted by asking", async () => {
    const res = await setEventStatus("completed");
    expect(res.ok).toBe(false);
    expect(res.needsDeleteConfirm).toBe(true);
    expect(res.error).toMatch(/deletes it for good/);
    expect(await exists(eventId), "an unconfirmed completion deleted the tournament").toBe(true);
    const ev = await prisma.event.findUnique({ where: { id: eventId } });
    expect(ev?.status, "an unconfirmed completion still completed it").not.toBe("completed");
  });

  it("deletes the tournament, and everything under it, once confirmed", async () => {
    await prisma.player.create({ data: { eventId, name: `${TAG} Ann`, handicap: 10, seed: 1, status: "confirmed" } });
    const { redirected } = await completeConfirmed();
    expect(redirected, "the organizer is sent somewhere that still exists").toBe(true);
    expect(await exists(eventId)).toBe(false);
    expect(await prisma.player.count({ where: { eventId } })).toBe(0);
  });
});

describe("the controls — every one keeps the tournament", () => {
  it("a club that predates the terms keeps its completed tournament, open field and all", async () => {
    await organizer("old", "free", false);
    const { ev } = await tournament("old one");
    expect(ev!.capacity, "a grandfathered club was capped").toBe(0);
    session.eventId = ev!.id;
    // And its second tournament is not refused.
    const second = await tournament("old two");
    expect(second.res?.ok, "a grandfathered club was refused a second tournament").toBe(true);

    session.eventId = ev!.id;
    const { redirected, res } = await completeConfirmed();
    expect(redirected).toBe(false);
    expect(res?.ok).toBe(true);
    const after = await prisma.event.findUnique({ where: { id: ev!.id } });
    expect(after?.status).toBe("completed");
  });

  it("a new club on a paid plan keeps it", async () => {
    await organizer("paid", "club", true);
    const { ev } = await tournament("paid one");
    expect(ev!.capacity, "the Club plan has no field cap").toBe(0);
    session.eventId = ev!.id;
    const { redirected } = await completeConfirmed();
    expect(redirected).toBe(false);
    expect(await exists(ev!.id)).toBe(true);
  });

  it("a tournament somebody has put a hold on is kept", async () => {
    await organizer("held", "free", true);
    const { ev } = await tournament("held one");
    await prisma.event.update({
      where: { id: ev!.id },
      data: { retainUntil: new Date(Date.now() + 30 * 24 * 3600e3) },
    });
    session.eventId = ev!.id;
    const { redirected } = await completeConfirmed();
    expect(redirected).toBe(false);
    expect(await exists(ev!.id)).toBe(true);
  });
});
