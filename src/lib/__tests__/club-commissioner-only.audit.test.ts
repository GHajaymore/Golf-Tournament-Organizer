import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Only a Commissioner may appoint, demote, remove a Commissioner or delete the
 * club (security sweep 2026-11-12, HIGH). An Admin could make themselves
 * Commissioner, remove the real one, then delete the club. Run as the attack,
 * with the real session and the real actions. Rows are all zz-marked and
 * deleted in afterAll.
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
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import { createSession, setActiveEvent } from "@/lib/auth";
import {
  addOrganizationMember,
  removeOrganizationMember,
  setOrganizationMemberRole,
} from "@/app/actions/organization";
import { deleteClub } from "@/app/actions/club-deletion";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-COMMISSIONER";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
const CLUB = `${TAG} club`;

let clubId = "";
let eventId = "";
const userIds: Record<string, string> = {};
const memberIds: Record<string, string> = {};

async function signIn(who: string) {
  jar.clear();
  await createSession(userIds[who]);
  await setActiveEvent(eventId);
}
const roleOf = async (who: string) =>
  (await prisma.organizationMember.findUnique({ where: { id: memberIds[who] } }))?.role ?? null;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organizationMember.deleteMany({ where: { user: { email: { startsWith: TAG.toLowerCase() } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  if (clubId) await prisma.organization.deleteMany({ where: { id: clubId } });
}

beforeAll(async () => {
  await cleanup();
  const club = await prisma.organization.create({ data: { name: CLUB, kind: "club" } });
  clubId = club.id;
  const ev = await prisma.event.create({
    data: {
      organizationId: club.id, name: `${TAG} cup`, dates: "", course: "", city: "", address: "",
      regDeadline: "", shareToken: `${TAG}-${Date.now()}`,
    },
  });
  eventId = ev.id;
  const roles: Record<string, string> = { boss: "owner", other: "owner", admin: "admin", plain: "member" };
  for (const who of Object.keys(roles)) {
    const u = await prisma.user.create({ data: { email: at(who), name: who, password: "x", emailVerifiedAt: new Date() } });
    userIds[who] = u.id;
    memberIds[who] = (
      await prisma.organizationMember.create({ data: { organizationId: club.id, userId: u.id, role: roles[who] } })
    ).id;
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("an Admin cannot take the club", () => {
  beforeAll(() => signIn("admin"));

  it("cannot grant Commissioner (to themselves or by adding someone)", async () => {
    expect((await setOrganizationMemberRole(memberIds.admin, "owner")).ok).toBe(false);
    expect(await roleOf("admin")).toBe("admin");
    expect((await setOrganizationMemberRole(memberIds.plain, "owner")).ok).toBe(false);
    expect((await addOrganizationMember(at("plain"), "x", "owner")).ok).toBe(false);
    expect((await addOrganizationMember(at("newcomer"), "x", "owner")).ok).toBe(false);
    expect(await prisma.user.count({ where: { email: at("newcomer") } }), "a refused invitation makes no account").toBe(0);
    expect(await roleOf("plain")).toBe("member");
  });

  it("cannot change a Commissioner's role", async () => {
    expect((await setOrganizationMemberRole(memberIds.boss, "member")).ok).toBe(false);
    expect((await addOrganizationMember(at("boss"), "x", "member")).ok).toBe(false);
    expect(await roleOf("boss")).toBe("owner");
  });

  it("cannot remove a Commissioner", async () => {
    expect((await removeOrganizationMember(memberIds.boss)).ok).toBe(false);
    expect(await roleOf("boss")).toBe("owner");
  });

  it("cannot delete the club", async () => {
    const res = await deleteClub(CLUB);
    expect(res.ok).toBe(false);
    expect(await prisma.organization.count({ where: { id: clubId } })).toBe(1);
  });

  it("still manages people up to Admin", async () => {
    expect((await setOrganizationMemberRole(memberIds.plain, "admin")).ok).toBe(true);
    expect((await setOrganizationMemberRole(memberIds.plain, "member")).ok).toBe(true);
  });
});

describe("a Commissioner still can, and the last one stays", () => {
  it("can appoint, demote and remove Commissioners while another remains", async () => {
    await signIn("boss");
    expect((await setOrganizationMemberRole(memberIds.plain, "owner")).ok).toBe(true);
    expect((await setOrganizationMemberRole(memberIds.plain, "member")).ok).toBe(true);
    expect((await removeOrganizationMember(memberIds.other)).ok).toBe(true);
  });

  it("cannot demote or remove the last Commissioner, themselves included", async () => {
    await signIn("boss");
    expect(await prisma.organizationMember.count({ where: { organizationId: clubId, role: "owner" } })).toBe(1);
    expect((await removeOrganizationMember(memberIds.boss)).ok).toBe(false);
    expect((await setOrganizationMemberRole(memberIds.boss, "admin")).ok).toBe(false);
    expect(await roleOf("boss")).toBe("owner");
  });

  it("can delete the club", async () => {
    await signIn("boss");
    await expect(deleteClub(CLUB)).rejects.toThrow(/REDIRECT/);
    expect(await prisma.organization.count({ where: { id: clubId } })).toBe(0);
  });
});
