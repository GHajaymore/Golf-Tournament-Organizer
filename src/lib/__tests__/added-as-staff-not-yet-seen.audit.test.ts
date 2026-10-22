import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * ADDED AS STAFF: STAFF AT ONCE, NAMED ONLY ONCE THEY HAVE BEEN BACK, AND FREE
 * TO LEAVE (2026-10-11).
 *
 * Ajay's ruling: an invitation needs no acceptance — "we just need to send a
 * communication with link". So typing an address makes that person staff at
 * once. Two things follow, and both are here against real rows:
 *
 *   1. AN ADDRESS MUST NOT BUY AN ACCOUNT. The staff list printed the account's
 *      own name, and whether it had ever signed in, beside an address the
 *      inviter had only typed — so adding a stranger told you who they were and
 *      that they were a customer. Until the person next signs in, or opens one
 *      of the club's tournaments, the list carries the address alone.
 *   2. WHOEVER WAS ADDED CAN UNDO IT. Only the club's officers could remove
 *      anybody; a person added by mistake had to write to whoever added them.
 *
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
// Being added sends an email; nothing here is about the email.
vi.mock("@/lib/email", () => ({
  sendStaffInviteEmail: async () => ({ ok: true }),
  sendPasswordResetEmail: async () => ({ ok: true }),
  emailConfig: () => ({ configured: false, sandboxSender: false, problem: null }),
}));

import { hashPassword, sign } from "@/lib/auth";
import { sessionValue } from "@/lib/domain/session-token";
import { addOrganizationMember, leaveOrganization, setOrganizationMemberRole } from "@/app/actions/organization";
import { signInWithPassword, enterTournament } from "@/app/actions/auth";
import { organizationAccessReport } from "@/lib/services/access";

const prisma = new PrismaClient();
const MARK = `zz-added-${process.pid}`;
const PASSWORD = "a-long-Fairway-71-pass";
const at = (who: string) => `${MARK}-${who}@example.invalid`;
/** A name the inviter never typed: if it shows, it came from the account. */
const SECRET_NAME = `Zz Private Name ${process.pid}`;

let orgId = "";
let eventId = "";
const ids: Record<string, string> = {};

/** Act as this person, on the club's tournament. */
const as = (who: string) => {
  jar.clear();
  jar.set("ng_session", sign(sessionValue(ids[who])));
  jar.set("ng_active_event", sign(eventId));
};
const row = async (who: string) => (await organizationAccessReport(orgId)).people.find((p) => p.email === at(who));

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} Club` } });
  orgId = org.id;
  const event = await prisma.event.create({ data: { organizationId: orgId, name: `${MARK} Open`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${MARK}-tok` } });
  eventId = event.id;
  for (const [who, name, password] of [["owner", "Zz Owner", PASSWORD], ["stranger", SECRET_NAME, PASSWORD], ["second", "Zz Second", PASSWORD]] as const) {
    const u = await prisma.user.create({ data: { email: at(who), name, password: hashPassword(password), emailVerifiedAt: new Date() } });
    ids[who] = u.id;
  }
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: ids.owner, role: "owner" } });
  await prisma.account.create({ data: { eventId, email: at("owner"), name: "Zz Owner", role: "admin" } });
});

afterAll(async () => {
  try {
    // By the MARK, not by an id held in a variable: a run that dies in beforeAll
    // has no id, and a fixture nothing can find is one somebody mistakes for real.
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("adding somebody as staff by their address", () => {
  it("CONTROL: the owner, who was not added by anybody, is named as before", async () => {
    const owner = await row("owner");
    expect(owner?.name).toBe("Zz Owner");
    expect(owner?.hasLogin).toBe(true);
    expect(owner?.invited ?? false).toBe(false);
  });

  it("makes them staff at once — there is nothing to accept", async () => {
    as("owner");
    expect(await addOrganizationMember(at("stranger"), "", "admin")).toEqual({ ok: true });
    const membership = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: ids.stranger } } });
    expect(membership?.role).toBe("admin");
    expect(membership?.invitedUnseenAt, "the membership was not marked as made by somebody else").toBeInstanceOf(Date);
  });

  it("shows the inviter the address they typed, and nothing of the account behind it", async () => {
    const added = await row("stranger");
    expect(added, "the person added is missing from the staff list").toBeTruthy();
    expect(added!.name, "the staff list printed the account's own name to somebody who only typed its address").toBe("");
    expect(added!.hasLogin, "the staff list said whether the address has an account that signs in").toBe(false);
    expect(added!.invited).toBe(true);
    expect(JSON.stringify(added)).not.toContain(SECRET_NAME);
  });

  it("changing their role does not name them, and does not hide anybody again", async () => {
    as("owner");
    const membership = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: ids.stranger } } });
    expect(await setOrganizationMemberRole(membership!.id, "member")).toEqual({ ok: true });
    expect((await row("stranger"))!.name).toBe("");
    expect((await row("owner"))!.name).toBe("Zz Owner");
  });

  it("names them once they have signed in", async () => {
    jar.clear();
    await signInWithPassword(at("stranger"), PASSWORD);
    const seen = await row("stranger");
    expect(seen!.name).toBe(SECRET_NAME);
    expect(seen!.hasLogin).toBe(true);
    expect(seen!.invited).toBe(false);
  });

  it("names somebody who was already signed in when added, once they open one of the club's tournaments", async () => {
    as("owner");
    expect(await addOrganizationMember(at("second"), "", "admin")).toEqual({ ok: true });
    expect((await row("second"))!.name, "named before they have been back").toBe("");
    as("second");
    await enterTournament(eventId);
    expect((await row("second"))!.name).toBe("Zz Second");
  });

  it("does not hide somebody who adds themselves", async () => {
    as("owner");
    expect(await addOrganizationMember(at("owner"), "", "owner")).toEqual({ ok: true });
    expect((await row("owner"))!.name).toBe("Zz Owner");
  });
});

describe("leaving a club you were added to", () => {
  it("refuses somebody who is not on that club's staff, and removes nobody", async () => {
    const before = await prisma.organizationMember.count({ where: { organizationId: orgId } });
    const outsider = await prisma.user.create({ data: { email: at("outsider"), name: "Zz Outsider", password: "x:unusable" } });
    ids.outsider = outsider.id;
    as("outsider");
    expect(await leaveOrganization(orgId)).toEqual({ ok: false, error: "You are not on that club's staff." });
    expect(await prisma.organizationMember.count({ where: { organizationId: orgId } })).toBe(before);
  });

  it("refuses the club's only Commissioner", async () => {
    as("owner");
    const res = await leaveOrganization(orgId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only Commissioner/);
    expect(await prisma.organizationMember.count({ where: { organizationId: orgId, userId: ids.owner } })).toBe(1);
  });

  it("lets the person who was added go, and takes only their own membership", async () => {
    as("stranger");
    expect(await leaveOrganization(orgId)).toEqual({ ok: true });
    expect(await prisma.organizationMember.count({ where: { organizationId: orgId, userId: ids.stranger } })).toBe(0);
    expect(await prisma.organizationMember.count({ where: { organizationId: orgId, userId: ids.owner } }), "leaving removed somebody else").toBe(1);
    expect(await prisma.organizationMember.count({ where: { organizationId: orgId, userId: ids.second } })).toBe(1);
  });

  it("is refused to somebody who is not signed in, and to anything that is not a club id", async () => {
    jar.clear();
    expect((await leaveOrganization(orgId)).ok).toBe(false);
    as("second");
    expect((await leaveOrganization(undefined)).ok).toBe(false);
    expect((await leaveOrganization({ id: orgId })).ok).toBe(false);
    expect(await prisma.organizationMember.count({ where: { organizationId: orgId, userId: ids.second } })).toBe(1);
  });

  it("lets a Commissioner go once there is another", async () => {
    const membership = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: ids.second } } });
    await prisma.organizationMember.update({ where: { id: membership!.id }, data: { role: "owner" } });
    as("owner");
    expect(await leaveOrganization(orgId)).toEqual({ ok: true });
    expect(await prisma.organizationMember.count({ where: { organizationId: orgId, role: "owner" } })).toBe(1);
  });
});
