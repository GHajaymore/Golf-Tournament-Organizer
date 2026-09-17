import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * SOMEBODY IN FOR ONE EVENT IS NOT A MEMBER OF THE CLUB.
 *
 * A charity day brings in a field that is not the membership; a Thursday
 * league borrows a substitute when a pair is short. Ajay asked for a flag and
 * then for a generic one — they are the same person to the app, in for one
 * event, and two flags meaning one thing drift apart.
 *
 * `ORG_GUEST_ROLES` already held the rule and nothing could set it: the club
 * had three roles to give and none of them meant this. So the guest role is
 * offered now, and these are the two halves that matter — they see their own
 * event, they see nothing else of the club's, and upgrading them to Member
 * opens the calendar the moment they join.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-GUEST";

const session = {
  email: `${TAG.toLowerCase()}-org@example.invalid`,
  name: `${TAG} organizer`,
  eventId: "",
  role: "admin",
  viewRole: "admin",
};
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/email", () => ({ sendStaffInviteEmail: async () => {} }));

const { addOrganizationMember, setOrganizationMemberRole } = await import("@/app/actions/organization");
const { accessibleEvents, effectiveAccess } = await import("@/lib/services/access");
const { staffSeatCount } = await import("@/lib/services/limits");

let orgId = "";
let charityId = "";
let medalId = "";
const guestEmail = `${TAG.toLowerCase()}-guest@example.invalid`;

const eventData = (organizationId: string, name: string) => ({
  organizationId,
  name: `${TAG} ${name}`,
  status: "registration",
  shape: "series",
  format: "stroke",
  formationRule: "balanced",
  dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
  registrationOpen: true,
  shareToken: randomBytes(12).toString("hex"),
  registrationToken: randomBytes(8).toString("hex"),
});

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

/** Which of this club's events this person can open, by name. */
async function canOpen(email: string): Promise<string[]> {
  const rows = await accessibleEvents(email);
  const events = await prisma.event.findMany({
    where: { id: { in: rows.map((r) => r.eventId) } },
    select: { name: true },
  });
  return events.map((e) => e.name.replace(`${TAG} `, "")).sort();
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  charityId = (await prisma.event.create({ data: eventData(orgId, "charity day") })).id;
  medalId = (await prisma.event.create({ data: eventData(orgId, "members medal") })).id;
  session.eventId = charityId;

  // The organizer running it.
  const owner = await prisma.user.create({ data: { email: session.email, name: session.name, password: "x" } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: owner.id, role: "owner" } });

  // The guest: entered in the charity day, and nothing else.
  await prisma.player.create({
    data: {
      eventId: charityId, name: `${TAG} guest`, email: guestEmail,
      handicap: 20, seed: 1, status: "confirmed",
    },
  });
  await prisma.account.create({
    data: { eventId: charityId, name: `${TAG} guest`, email: guestEmail, role: "player" },
  });
  await prisma.user.create({ data: { email: guestEmail, name: `${TAG} guest`, password: "x" } });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a guest of the club", () => {
  it("can be added as a guest, which is a role the club can actually give", async () => {
    // It was in ORG_GUEST_ROLES and in nothing an organizer could reach.
    expect(await addOrganizationMember(guestEmail, `${TAG} guest`, "guest")).toEqual({ ok: true });
    const row = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: orgId, user: { email: guestEmail } },
      select: { role: true },
    });
    expect(row.role).toBe("guest");
  });

  it("sees the event they are in, and nothing else the club runs", async () => {
    expect(await canOpen(guestEmail)).toEqual(["charity day"]);
    // And the check the other way round agrees — the two must, or a member
    // gets a list of doors that refuse to open.
    expect(await effectiveAccess(guestEmail, charityId)).toMatchObject({ role: "player" });
    expect(await effectiveAccess(guestEmail, medalId), "the club's medal opened for a guest").toBeNull();
  });

  it("costs no staff seat — a charity day is a hundred of them", async () => {
    /**
     * Owners and admins are seats; a guest is somebody in for one night. So
     * the seat LIMIT must not refuse one either — measured with enforcement
     * actually on and the free plan at its single seat, because a plan check
     * that never runs proves nothing about the rule.
     */
    expect(await staffSeatCount(orgId)).toBe(1);
    await prisma.subscription.create({
      data: { organizationId: orgId, plan: "free", status: "active", provider: "stripe" },
    });
    try {
      // The cap is one seat, and the owner is it.
      const asAdmin = await addOrganizationMember(
        `${TAG.toLowerCase()}-second@example.invalid`,
        `${TAG} second`,
        "admin",
      );
      expect(asAdmin.ok, "the seat limit is not being enforced at all").toBe(false);

      const asGuest = await addOrganizationMember(
        `${TAG.toLowerCase()}-visitor@example.invalid`,
        `${TAG} visitor`,
        "guest",
      );
      expect(asGuest, "a guest was charged a staff seat").toEqual({ ok: true });
      expect(await staffSeatCount(orgId), "a guest counted as staff").toBe(1);
    } finally {
      await prisma.subscription.deleteMany({ where: { organizationId: orgId } });
    }
  });

  it("sees the whole calendar the moment they are upgraded to member", async () => {
    const membership = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: orgId, user: { email: guestEmail } },
      select: { id: true },
    });
    expect(await setOrganizationMemberRole(membership.id, "member")).toEqual({ ok: true });

    expect(await canOpen(guestEmail)).toEqual(["charity day", "members medal"]);
    expect(await effectiveAccess(guestEmail, medalId)).toMatchObject({ role: "player", source: "organization" });

    // And back again, for somebody added as a member by mistake.
    expect(await setOrganizationMemberRole(membership.id, "guest")).toEqual({ ok: true });
    expect(await canOpen(guestEmail)).toEqual(["charity day"]);
  });

  it("refuses a role nobody has heard of rather than storing it", async () => {
    const membership = await prisma.organizationMember.findFirstOrThrow({
      where: { organizationId: orgId, user: { email: guestEmail } },
      select: { id: true },
    });
    expect(await setOrganizationMemberRole(membership.id, "superuser")).toEqual({ ok: true });
    const row = await prisma.organizationMember.findUniqueOrThrow({
      where: { id: membership.id },
      select: { role: true },
    });
    // Falls back to the least surprising real role, never the string sent.
    expect(row.role).toBe("member");
    await prisma.organizationMember.update({ where: { id: membership.id }, data: { role: "guest" } });
  });
});
