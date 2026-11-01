import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE ROSTER IMPORT NO LONGER WARNS A PAR CLUB ABOUT MOBILES (2026-10-21).
 *
 * From 2026-09-30 it did: Par made every entrant give a mobile, so twelve
 * members imported with no phone column were twelve names blocked on
 * Registration, and the import said so. The decisions review (A7) made the
 * mobile the organizer's choice per tournament on every plan, so a club roster
 * — which has no tournament behind it — has nothing to warn of, and the
 * sentence it printed ("every entrant in a Par tournament gives one") was
 * false.
 *
 * Through the real action, on Par and on a paid plan: the members come in,
 * and the result carries no mobile count on either.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MOBILES";

const auth = vi.hoisted(() => ({ session: null as null | Record<string, string> }));
vi.mock("@/lib/auth", () => ({ getSession: async () => auth.session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { importCsvMembers } = await import("@/app/actions/roster");

let orgId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const setPlan = (plan: string) =>
  prisma.subscription.update({ where: { organizationId: orgId }, data: { plan } });

const NO_PHONES =
  "name,email\n" +
  `${TAG} Ann Example,zz-mobiles-ann@example.invalid\n` +
  `${TAG} Ben Example,zz-mobiles-ben@example.invalid\n` +
  `${TAG} Cy Example,zz-mobiles-cy@example.invalid\n`;

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} Society`,
      kind: "community",
      subscription: { create: { plan: "free", planTermsApply: true } },
    },
  });
  orgId = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} Medal`,
      dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG.toLowerCase()}-share`,
    },
  });
  auth.session = { eventId: event.id, role: "admin", viewRole: "admin", email: "zz-mobiles@example.invalid", name: `${TAG} Secretary` };
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the roster import says nothing about mobiles, on any plan", () => {
  it("Par: three members with no phone come in, and no mobile count is returned", async () => {
    await setPlan("free");
    const r = await importCsvMembers(NO_PHONES);
    expect(r.imported).toBe(3);
    expect(r.error).toBeUndefined();
    expect(Object.keys(r)).not.toContain("missingMobile");
    const stored = await prisma.member.count({ where: { organizationId: orgId, phone: "" } });
    expect(stored, "the members are on the roster with no phone").toBe(3);
  });

  it("a paid plan: the same", async () => {
    await setPlan("society");
    const r = await importCsvMembers(NO_PHONES);
    expect(r.error).toBeUndefined();
    expect(Object.keys(r)).not.toContain("missingMobile");
  });
});
