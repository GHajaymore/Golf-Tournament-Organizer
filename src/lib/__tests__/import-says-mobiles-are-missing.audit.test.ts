import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A PAR CLUB IS TOLD AT THE IMPORT THAT ITS MEMBERS NEED A MOBILE (2026-09-30).
 *
 * Walked as a new society: twelve members imported from a list with no phone
 * column, "12 added", and then on Registration every one of them read "Needs a
 * mobile number" — Par makes every entrant give one. The fix was one re-upload
 * with a phone column, and nothing on the import had said so.
 *
 * Through the real action, on both sides of the plan rule: Par counts the gap,
 * a plan that lets the club choose is told nothing.
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

describe("the roster import says when Par members have no mobile", () => {
  it("counts them on Par", async () => {
    await setPlan("free");
    const r = await importCsvMembers(NO_PHONES);
    expect(r.imported).toBe(3);
    expect(r.missingMobile).toBe(3);
  });

  it("stops counting once a re-upload fills them in — the fix it points at", async () => {
    await setPlan("free");
    const r = await importCsvMembers(
      "name,email,phone\n" +
        `${TAG} Ann Example,zz-mobiles-ann@example.invalid,+1 202 555 0121\n` +
        `${TAG} Ben Example,zz-mobiles-ben@example.invalid,+1 202 555 0122\n`,
    );
    expect(r.updated).toBe(2);
    expect(r.missingMobile, "Cy is still missing one").toBe(1);
  });

  it("CONTROL: a plan that lets the club choose is told nothing", async () => {
    await setPlan("society");
    const r = await importCsvMembers(NO_PHONES);
    expect(r.missingMobile).toBeUndefined();
  });
});
