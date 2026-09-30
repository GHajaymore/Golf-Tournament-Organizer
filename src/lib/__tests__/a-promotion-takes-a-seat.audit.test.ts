import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A PROMOTION TAKES A SEAT (2026-09-30).
 *
 * The staff-seat limit was asked only when somebody was ADDED as staff. Two
 * doors went round it: add a person to a tournament as a player and promote
 * them on Access & staff, or promote a club Member to admin. A Par club's one
 * organizer seat could hold as many as anybody cared to promote.
 *
 * And the other direction, which a per-person check fixes as a side effect:
 * somebody who ALREADY holds a seat takes no new one (the count is by email),
 * so the secretary made organizer of a second tournament must not be refused.
 *
 * Through the real actions, Par with its terms (one seat), Birdie as control.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SEATS";
const SECRETARY = "zz-seats-secretary@example.invalid";

const auth = vi.hoisted(() => ({ session: null as null | Record<string, string> }));
vi.mock("@/lib/auth", () => ({ getSession: async () => auth.session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { addAccount, setAccountRole } = await import("@/app/actions/tournament");
const { addOrganizationMember, setOrganizationMemberRole } = await import("@/app/actions/organization");

let orgId = "";
let eventId = "";
let secondEventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz-seats-" } } });
}

const setPlan = (plan: string) =>
  prisma.subscription.update({ where: { organizationId: orgId }, data: { plan } });

const event = (name: string) =>
  prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG.toLowerCase()}-${name.toLowerCase().replace(/\s+/g, "-")}`,
    },
  });

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: SECRETARY, name: `${TAG} Secretary` } });
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} Society`,
      kind: "community",
      subscription: { create: { plan: "free", planTermsApply: true } },
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  orgId = org.id;
  eventId = (await event("Medal")).id;
  secondEventId = (await event("Foursomes")).id;
  await prisma.account.create({ data: { eventId, name: `${TAG} Secretary`, email: SECRETARY, role: "admin" } });
});

beforeEach(async () => {
  await setPlan("free");
  auth.session = { eventId, role: "admin", viewRole: "admin", email: SECRETARY, name: `${TAG} Secretary` };
  // Back to one seat held: only the secretary.
  await prisma.account.deleteMany({ where: { eventId: { in: [eventId, secondEventId] }, email: { not: SECRETARY } } });
  await prisma.account.deleteMany({ where: { eventId: secondEventId } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId, user: { email: { not: SECRETARY } } } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const roleOn = async (evId: string, email: string) =>
  (await prisma.account.findFirst({ where: { eventId: evId, email }, select: { role: true } }))?.role;

describe("the seat limit holds on a promotion", () => {
  it("adding as a player and promoting to Assistant is refused on Par", async () => {
    expect((await addAccount(`${TAG} Helper`, "zz-seats-helper@example.invalid", "player")).ok).toBe(true);
    const acct = await prisma.account.findFirst({ where: { eventId, email: "zz-seats-helper@example.invalid" } });
    const r = await setAccountRole(acct!.id, "assistant");
    expect(r.ok, "the promotion went round the seat limit").toBe(false);
    expect(r.error).toMatch(/1 staff seat/);
    expect(await roleOn(eventId, "zz-seats-helper@example.invalid")).toBe("player");
  });

  it("promoting a club Member to admin is refused on Par", async () => {
    expect((await addOrganizationMember("zz-seats-member@example.invalid", `${TAG} Member`, "member")).ok).toBe(true);
    const m = await prisma.organizationMember.findFirst({ where: { organizationId: orgId, user: { email: "zz-seats-member@example.invalid" } } });
    const r = await setOrganizationMemberRole(m!.id, "admin");
    expect(r.ok).toBe(false);
    expect((await prisma.organizationMember.findUnique({ where: { id: m!.id } }))!.role).toBe("member");
  });

  it("the secretary, already holding the seat, is made organizer of a second tournament", async () => {
    auth.session = { ...auth.session!, eventId: secondEventId };
    const r = await addAccount(`${TAG} Secretary`, SECRETARY, "admin");
    expect(r.ok, "a seat-holder was refused a seat they already hold").toBe(true);
    expect(await roleOn(secondEventId, SECRETARY)).toBe("admin");
  });

  it("CONTROL: on Birdie (three seats) the same promotion goes through", async () => {
    await setPlan("society");
    await addAccount(`${TAG} Helper`, "zz-seats-helper@example.invalid", "player");
    const acct = await prisma.account.findFirst({ where: { eventId, email: "zz-seats-helper@example.invalid" } });
    expect((await setAccountRole(acct!.id, "assistant")).ok).toBe(true);
    expect(await roleOn(eventId, "zz-seats-helper@example.invalid")).toBe("assistant");
  });
});
