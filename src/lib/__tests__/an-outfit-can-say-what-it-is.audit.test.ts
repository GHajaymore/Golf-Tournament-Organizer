import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { orgProfile } from "@/lib/domain/org-profile";

/**
 * AN OUTFIT CAN SAY WHAT IT IS.
 *
 * `Organization.kind` was written once, when the organization came into being,
 * and updated nowhere in the codebase. An organization is created lazily for
 * anybody whose tenant came from a casual round or a first tournament rather
 * than from the sign-up question, and that path defaults to `personal` —
 * measured 2026-09-17 in the development database, three of six were personal,
 * two of them belonging to somebody plainly running a club.
 *
 * AND IT IS NOT A LABEL. `orgProfile` reads the kind for `sharedRoster`,
 * `ledger` and `ownsCourse`, so a society born personal has no
 * members list at all — and had no way to ask for one.
 *
 * The cells below are the rules that need real rows: that the change sticks,
 * that only staff may make it, that an unknown kind is refused rather than
 * stored, and the one direction that HIDES something — moving to personal with
 * people on the roster asks first and names the number.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ORGKIND";

const session = { email: "", name: "", eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/email", () => ({ sendStaffInviteEmail: async () => {}, sendJoinRequestEmail: async () => {} }));

const { saveOrganizationKind } = await import("@/app/actions/organization");

const owner = { email: `${TAG.toLowerCase()}-owner@example.invalid`, name: `${TAG} Owner` };
const bystander = { email: `${TAG.toLowerCase()}-bystander@example.invalid`, name: `${TAG} Bystander` };

let orgId = "";
let eventId = "";

async function scrub() {
  const orgs = await prisma.organization.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  if (orgs.length) {
    await prisma.event.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  }
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

const kindOf = async () =>
  (await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { kind: true } })).kind;

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: owner.email, name: owner.name, password: "x:unusable" } });
  await prisma.user.create({ data: { email: bystander.email, name: bystander.name, password: "x:unusable" } });
  const org = await prisma.organization.create({
    data: {
      // Born personal, which is the state this whole file is about.
      name: `${TAG} Thursday Society`,
      kind: "personal",
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  orgId = org.id;
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} Week 1`,
        status: "registration", shape: "series", format: "stroke", formationRule: "balanced",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: `${TAG.toLowerCase()}-share`,
        registrationToken: `${TAG.toLowerCase()}-reg`,
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.organization.update({ where: { id: orgId }, data: { kind: "personal" } });
  await prisma.member.deleteMany({ where: { organizationId: orgId } });
  session.email = owner.email;
  session.name = owner.name;
  session.eventId = eventId;
  session.role = "admin";
  session.viewRole = "admin";
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("saying what the outfit is", () => {
  it("changes it, which nothing in the app could do before", async () => {
    expect(await kindOf()).toBe("personal");
    expect(await saveOrganizationKind("community")).toMatchObject({ ok: true });
    expect(await kindOf()).toBe("community");
  });

  it("turns the members list ON, which is the part that is not cosmetic", async () => {
    /**
     * The point of the whole change. `sharedRoster` is read off the kind, so a
     * society stored as `personal` has no roster screen — not a wrong word, a
     * missing feature.
     */
    expect(orgProfile(await kindOf()).sharedRoster).toBe(false);
    expect(await saveOrganizationKind("club")).toMatchObject({ ok: true });
    expect(orgProfile(await kindOf()).sharedRoster).toBe(true);
  });

  it("refuses a kind nobody has heard of rather than storing it", async () => {
    const res = await saveOrganizationKind("superclub");
    expect(res.ok).toBe(false);
    expect(await kindOf(), "an unknown kind reached the database").toBe("personal");
  });

  it("refuses somebody in the outfit who is not staff", async () => {
    session.email = bystander.email;
    session.name = bystander.name;
    session.role = "player";
    session.viewRole = "player";

    const res = await saveOrganizationKind("club");
    expect(res.ok, "a player changed what the whole outfit is").toBe(false);
    expect(res.error).toMatch(/owner or admin/i);
    expect(await kindOf()).toBe("personal");
  });
});

describe("the one direction that hides something", () => {
  beforeEach(async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { kind: "club" } });
    await prisma.member.createMany({
      data: [1, 2, 3].map((n) => ({
        organizationId: orgId,
        name: `${TAG} Member ${n}`,
        email: `${TAG.toLowerCase()}-m${n}@example.invalid`,
      })),
    });
  });

  it("asks before hiding a roster that has people on it, and names the number", async () => {
    const res = await saveOrganizationKind("personal");

    expect(res.ok, "the roster was hidden without asking").toBe(false);
    expect(res.hidesRoster).toBe(3);
    expect(res.error).toContain("3");
    // The number is the fact that makes the decision; "nothing is deleted" is
    // the fact that makes it survivable.
    expect(res.error).toMatch(/nothing is deleted/i);
    expect(await kindOf()).toBe("club");
  });

  it("goes through once they say so, and the rows are still there", async () => {
    expect(await saveOrganizationKind("personal", true)).toMatchObject({ ok: true });
    expect(await kindOf()).toBe("personal");
    // HIDDEN, NOT DELETED — which is exactly what the question promised. The
    // roster comes back the moment they switch again.
    expect(await prisma.member.count({ where: { organizationId: orgId } })).toBe(3);

    expect(await saveOrganizationKind("club")).toMatchObject({ ok: true });
    expect(orgProfile(await kindOf()).sharedRoster).toBe(true);
    expect(await prisma.member.count({ where: { organizationId: orgId } })).toBe(3);
  });

  it("does not ask when there is nobody on the roster", async () => {
    await prisma.member.deleteMany({ where: { organizationId: orgId } });
    expect(await saveOrganizationKind("personal")).toMatchObject({ ok: true });
    expect(await kindOf()).toBe("personal");
  });

  it("never asks in the direction that only reveals", async () => {
    // club → community keeps the roster, so there is nothing to warn about.
    expect(await saveOrganizationKind("community")).toMatchObject({ ok: true });
    expect(await kindOf()).toBe("community");
  });
});
