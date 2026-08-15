import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A guest organizer cannot take the club.
 *
 * S1 of the 2026-08-12 audit, run as the attack rather than described as one.
 * A club invites someone to run one event — a visiting pro, a section captain,
 * the member who volunteered for the Tuesday league — and grants them admin ON
 * THAT EVENT. `addAccount` writes an `Account` row and never an
 * `OrganizationMember`, so they held `session.role === "admin"` with no
 * membership, which the club-administration guard read as "a legitimate owner
 * whose membership row predates memberships". Two calls later the club was
 * theirs: make yourself owner, remove the real one.
 *
 * Nothing structural could see it. The id was always the right id and the row
 * was always the right row — the IDOR sweep passes across this whole surface —
 * and the role tests asserted only that one club's rights don't reach sideways
 * into another. This is the upward direction, and it needs the real session,
 * the real Account grant and the real actions to demonstrate.
 *
 * Excluded from the default run — needs a live DATABASE_URL and writes rows,
 * all of which are deleted in afterAll.
 *   npx vitest run --config vitest.audit.config.ts
 */

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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import {
  addOrganizationMember,
  removeOrganizationMember,
  setOrganizationMemberRole,
  saveOrganizationBranding,
} from "@/app/actions/organization";
import { saveOrganizationDefaults } from "@/app/actions/settings";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TAKEOVER";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let clubId = "";
let clubEventId = "";
/** A club with no members at all — the case the escape hatch is for. */
let orphanOrgId = "";
let orphanEventId = "";
let ownerMembershipId = "";
const userIds: Record<string, string> = {};

async function signIn(who: string, eventId: string) {
  jar.clear();
  await createSession(userIds[who]);
  await setActiveEvent(eventId);
}

const newEvent = (organizationId: string, name: string) => ({
  organizationId,
  name: `${TAG} ${name}`,
  dates: "",
  course: "",
  city: "",
  address: "",
  regDeadline: "",
  shareToken: `${TAG}-${name}-${Date.now()}`,
});

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organizationMember.deleteMany({
    where: { user: { email: { startsWith: TAG.toLowerCase() } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  // BY ID as well as by name, because this file's whole subject is renaming a
  // club: a test that proves branding was changed has, by then, changed the
  // very prefix the tag-based cleanup matches on. A fixture left behind is a
  // fixture somebody later mistakes for real — and one of these did survive a
  // run, under the name the attack gave it.
  const ids = [clubId, orphanOrgId].filter(Boolean);
  if (ids.length) await prisma.organization.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();

  const [club, orphan] = await Promise.all([
    prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } }),
    prisma.organization.create({ data: { name: `${TAG} orphan club`, kind: "personal" } }),
  ]);
  clubId = club.id;
  orphanOrgId = orphan.id;

  const [clubEvent, orphanEvent] = await Promise.all([
    prisma.event.create({ data: newEvent(club.id, "invitational") }),
    prisma.event.create({ data: newEvent(orphan.id, "legacy") }),
  ]);
  clubEventId = clubEvent.id;
  orphanEventId = orphanEvent.id;

  for (const who of ["owner", "guest", "legacy"]) {
    const user = await prisma.user.create({ data: { email: at(who), name: who, password: "x" } });
    userIds[who] = user.id;
  }

  // The real owner of the real club.
  const membership = await prisma.organizationMember.create({
    data: { organizationId: club.id, userId: userIds.owner, role: "owner" },
  });
  ownerMembershipId = membership.id;

  await prisma.account.createMany({
    data: [
      // The grant at the centre of this: admin ON ONE EVENT, nothing more.
      { eventId: clubEvent.id, email: at("guest"), name: "Guest Organizer", role: "admin" },
      // The same shape, but on a club that has no members at all.
      { eventId: orphanEvent.id, email: at("legacy"), name: "Legacy Organizer", role: "admin" },
    ],
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the guest organizer's two calls", () => {
  beforeAll(() => signIn("guest", clubEventId));

  it("still runs their own event", async () => {
    // The grant is real and must keep working. Refusing it would be a
    // different product, not a safer one — the fix belongs at the club
    // boundary, not on the invitation.
    const access = await prisma.account.findFirst({
      where: { eventId: clubEventId, email: at("guest") },
    });
    expect(access?.role).toBe("admin");
  });

  it("cannot make themselves an owner of the club", async () => {
    const res = await addOrganizationMember(at("guest"), "Guest", "owner");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/owner or admin/i);
    expect(
      await prisma.organizationMember.count({ where: { organizationId: clubId } }),
      "the club's staff list must be untouched",
    ).toBe(1);
  });

  it("cannot remove the real owner", async () => {
    const res = await removeOrganizationMember(ownerMembershipId);
    expect(res.ok).toBe(false);
    const owner = await prisma.organizationMember.findUnique({ where: { id: ownerMembershipId } });
    expect(owner, "the owner is still the owner").not.toBeNull();
    expect(owner?.role).toBe("owner");
  });

  it("cannot demote the real owner either", async () => {
    const res = await setOrganizationMemberRole(ownerMembershipId, "member");
    expect(res.ok).toBe(false);
    expect((await prisma.organizationMember.findUnique({ where: { id: ownerMembershipId } }))?.role).toBe("owner");
  });

  it("cannot rebrand the club", async () => {
    // The quieter half of the same hole: branding is what every player, email
    // and public board carries.
    const res = await saveOrganizationBranding("Totally Different Golf Club", "TDGC", "");
    expect(res.ok).toBe(false);
    expect((await prisma.organization.findUnique({ where: { id: clubId } }))?.name).toBe(`${TAG} club`);
  });

  it("cannot change the club's house defaults", async () => {
    // settings.ts carried its own copy of the same condition, so fixing only
    // organization.ts would have left the club's scoring defaults reachable.
    const res = await saveOrganizationDefaults({ scoreEntryBy: "players" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/owner or admin/i);
  });
});

describe("the people who actually hold the club", () => {
  it("lets the real owner do all of it", async () => {
    // Proves the refusals above are the rule and not a broken action.
    await signIn("owner", clubEventId);

    expect(await addOrganizationMember(at("guest"), "Guest Organizer", "admin")).toEqual({ ok: true });
    expect(await saveOrganizationDefaults({ scoreEntryBy: "players" })).toEqual({ ok: true });
    expect(await prisma.organizationMember.count({ where: { organizationId: clubId } })).toBe(2);
  });

  it("and then the guest, now a real club admin, may too", async () => {
    // The invitation the club actually meant to extend. Same person, same
    // event grant — what changed is that somebody with the authority to say so
    // said so.
    await signIn("guest", clubEventId);
    expect(await saveOrganizationBranding(`${TAG} club`, "TDGC", "")).toEqual({ ok: true });
  });
});

describe("a club nobody holds is still administrable", () => {
  it("lets its event organizer administer it", async () => {
    // Why the fallback existed at all. An organization created before
    // memberships — or by the code path that skipped creating one — has no
    // owner, and refusing outright locks a real organizer out of their own
    // tenant. The narrowing is that this asks about the CLUB ("nobody holds
    // it") rather than about the caller ("I am not a member"), and a club
    // being taken from someone always has someone to take it from.
    await signIn("legacy", orphanEventId);
    expect(await prisma.organizationMember.count({ where: { organizationId: orphanOrgId } })).toBe(0);
    expect(await saveOrganizationBranding(`${TAG} orphan renamed`, "ORC", "")).toEqual({ ok: true });
  });

  it("and stops being a free-for-all the moment it has an owner", async () => {
    // The backfill's whole purpose: once every club has an owner, the hatch
    // applies to nothing. Here that transition is exercised directly — the
    // same session, refused the moment somebody holds the club.
    await prisma.organizationMember.create({
      data: { organizationId: orphanOrgId, userId: userIds.owner, role: "owner" },
    });
    const res = await saveOrganizationBranding("Taken", "T", "");
    expect(res.ok).toBe(false);
    expect((await prisma.organization.findUnique({ where: { id: orphanOrgId } }))?.name).toBe(
      `${TAG} orphan renamed`,
    );
  });
});
