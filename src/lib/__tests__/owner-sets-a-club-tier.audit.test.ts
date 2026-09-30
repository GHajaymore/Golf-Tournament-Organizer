import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The owner puts a club on a tier — the only way a plan changes, since nothing
 * in the app could before (2026-09-29). Owner only; one club by exact name or
 * nothing; and the club's standing under the terms is never touched by it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-OWNER-TIER";
const OWNER = "zz-audit-owner-tier-owner@example.invalid";
const session = { email: OWNER, name: `${TAG} owner`, eventId: "", role: "admin", viewRole: "admin", userId: "", accountId: "" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("@/lib/owner", () => ({ isOwner: (email: string) => email === OWNER }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { setClubPlan } = await import("@/app/actions/owner");

async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const planOf = async (orgId: string) => prisma.subscription.findUnique({ where: { organizationId: orgId } });

beforeAll(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("the owner puts a club on a tier", () => {
  it("moves the one club of that name, and leaves its standing under the terms alone", async () => {
    const old = await prisma.organization.create({
      data: { name: `${TAG} Old Links`, subscription: { create: { plan: "free", planTermsApply: false } } },
    });
    const res = await setClubPlan(`${TAG} old links`, "enterprise");
    expect(res.ok).toBe(true);
    const sub = await planOf(old.id);
    expect(sub?.plan).toBe("enterprise");
    expect(sub?.planTermsApply, "moving a grandfathered club put it on the new terms").toBe(false);
  });

  it("gives a club with no subscription row one, still grandfathered", async () => {
    const bare = await prisma.organization.create({ data: { name: `${TAG} Bare Club` } });
    expect((await setClubPlan(`${TAG} Bare Club`, "club")).ok).toBe(true);
    const sub = await planOf(bare.id);
    expect(sub?.plan).toBe("club");
    expect(sub?.planTermsApply).toBe(false);
  });

  it("changes nothing when two clubs share the name", async () => {
    const a = await prisma.organization.create({ data: { name: `${TAG} Twin`, subscription: { create: { plan: "free" } } } });
    await prisma.organization.create({ data: { name: `${TAG} Twin`, subscription: { create: { plan: "free" } } } });
    const res = await setClubPlan(`${TAG} Twin`, "club");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/More than one club/);
    expect((await planOf(a.id))?.plan).toBe("free");
  });

  it("refuses a tier that does not exist, and anybody who is not the owner", async () => {
    const c = await prisma.organization.create({ data: { name: `${TAG} Gate`, subscription: { create: { plan: "free" } } } });
    expect((await setClubPlan(`${TAG} Gate`, "platinum")).ok).toBe(false);
    session.email = "zz-audit-owner-tier-stranger@example.invalid";
    try {
      const res = await setClubPlan(`${TAG} Gate`, "club");
      expect(res.ok).toBe(false);
      expect(res.error).toBe("Not found.");
    } finally {
      session.email = OWNER;
    }
    expect((await planOf(c.id))?.plan).toBe("free");
  });
});
