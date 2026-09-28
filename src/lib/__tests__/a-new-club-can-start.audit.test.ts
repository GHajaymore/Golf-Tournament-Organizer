import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A NEW CLUB CAN GET STARTED BEFORE ITS FIRST TOURNAMENT.
 *
 * Walked 2026-09-28, a fresh society sign-up. The checklist on /choose keeps
 * the tournament step shut until the society is named and has members — and
 * with no tournament yet, the session's role is "player" (it is derived from
 * event access), so:
 *
 *   - adding a member threw "Organizer access required" and crashed the page;
 *   - club settings rendered read-only, "Only an organization owner or admin
 *     can change these settings", to the owner who had just created the club,
 *     and every save refused — `organizationAccess` returned null without a
 *     tournament to ask.
 *
 * So a new society could never create its first tournament. Both now follow the
 * rule `requireOrgScreen` already used to let them onto those screens: with no
 * tournament, the club is the one this person owns or administers.
 *
 * The CONTROLS matter as much as the fix: a person who owns nothing, and a
 * plain member of somebody else's club, are still refused — the fallback is a
 * narrower door than the role check, never a wider one.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NEWCLUB";

const session = { email: "", name: "", eventId: "", role: "player", viewRole: "player" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/email", () => ({ sendStaffInviteEmail: async () => {}, sendJoinRequestEmail: async () => {} }));

const { addMember } = await import("@/app/actions/roster");
const { saveOrganizationGolfTerms } = await import("@/app/actions/organization");
const { organizationAccess } = await import("@/lib/services/org-access");

/** The mocked session, typed as the real one — only the fields the code reads are set. */
const current = () => session as unknown as Parameters<typeof organizationAccess>[0];

const owner = { email: `${TAG.toLowerCase()}-owner@example.invalid`, name: `${TAG} Owner` };
const nobody = { email: `${TAG.toLowerCase()}-nobody@example.invalid`, name: `${TAG} Nobody` };
const plainMember = { email: `${TAG.toLowerCase()}-member@example.invalid`, name: `${TAG} Member` };

let orgId = "";

async function scrub() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  if (orgs.length) {
    await prisma.member.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
    await prisma.event.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  }
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

const as = (who: { email: string; name: string }) => {
  // No tournament: exactly the session `getSession` hands a new club's owner.
  Object.assign(session, { email: who.email, name: who.name, eventId: "", role: "player", viewRole: "player" });
};

beforeAll(async () => {
  await scrub();
  const u = await prisma.user.create({ data: { email: owner.email, name: owner.name, password: "x:unusable" } });
  await prisma.user.create({ data: { email: nobody.email, name: nobody.name, password: "x:unusable" } });
  const m = await prisma.user.create({ data: { email: plainMember.email, name: plainMember.name, password: "x:unusable" } });
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} Newcomer Society`,
      kind: "community",
      members: { create: [{ userId: u.id, role: "owner" }, { userId: m.id, role: "member" }] },
    },
  });
  orgId = org.id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

beforeEach(() => as(owner));

describe("a club with no tournament yet", () => {
  it("its owner may administer it", async () => {
    const access = await organizationAccess(current());
    expect(access?.organizationId).toBe(orgId);
    expect(access?.canEdit).toBe(true);
  });

  it("its owner may save its settings", async () => {
    const res = await saveOrganizationGolfTerms("uk");
    expect(res.ok, res.error).toBe(true);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).golfTerms).toBe("uk");
  });

  it("its owner may add the first member — the step the checklist waits on", async () => {
    const res = await addMember({ name: `${TAG} First Member`, email: `${TAG.toLowerCase()}-m1@example.invalid` });
    expect(res.ok, res.error).toBe(true);
    expect(await prisma.member.count({ where: { organizationId: orgId, name: `${TAG} First Member` } })).toBe(1);
  });

  it("CONTROL: somebody who owns no club gets no club, and cannot add to one", async () => {
    as(nobody);
    expect(await organizationAccess(current())).toBeNull();
    await expect(addMember({ name: `${TAG} Sneaky` })).rejects.toThrow(/Organizer access required/);
    expect(await prisma.member.count({ where: { name: `${TAG} Sneaky` } })).toBe(0);
  });

  it("CONTROL: a plain member of the club is not handed it either", async () => {
    as(plainMember);
    // organizationsForOrganizer returns owner/admin clubs only, so a member
    // resolves to no club at all — not to this one with canEdit false.
    expect(await organizationAccess(current())).toBeNull();
    await expect(addMember({ name: `${TAG} Also Sneaky` })).rejects.toThrow(/Organizer access required/);
  });
});
