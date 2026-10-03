import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * DELETING AN ACCOUNT TAKES THE PERSON'S ACCESS — AND NOT THE CLUB'S RECORDS
 * (2026-10-03). See `domain/account-deletion.ts` for the line and why.
 *
 * Against real rows, built so each wrong answer looks different:
 *
 *   - the LEAVER holds one of every kind of access: a staff membership, a
 *     per-tournament access grant (stored with their address in DIFFERENT CASE,
 *     because those rows are keyed by email and a case-sensitive delete would
 *     leave a grant for anyone who re-registers the address), a phone push
 *     registration, and a place and a read marker in a club conversation;
 *   - the club ALSO holds records about them — a roster entry and a place in a
 *     tournament's field — which must survive;
 *   - a KEEPER, with the same set of access in the same club, must be exactly
 *     as before.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DELACCT";
vi.mock("server-only", () => ({}));
const { deleteAccountAndAccess, soleOwnedClubs } = await import("@/lib/services/account-deletion");

const emailFor = (who: string) => `zz-audit-delacct-${who}@example.invalid`;
const WHO = ["leaver", "keeper", "solo"];

async function scrub() {
  const emails = WHO.map(emailFor);
  const insensitive = emails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } }));
  await prisma.account.deleteMany({ where: { OR: insensitive } });
  await prisma.pushSubscription.deleteMany({ where: { OR: insensitive } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
}

beforeAll(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

async function accessOf(email: string, userId: string) {
  const ci = { equals: email, mode: "insensitive" as const };
  return {
    user: await prisma.user.count({ where: { id: userId } }),
    staff: await prisma.organizationMember.count({ where: { userId } }),
    grants: await prisma.account.count({ where: { email: ci } }),
    pushes: await prisma.pushSubscription.count({ where: { email: ci } }),
    threadPlaces: await prisma.threadParticipant.count({ where: { email: ci } }),
    reads: await prisma.threadRead.count({ where: { email: ci } }),
  };
}

describe("deleting an account", () => {
  it("removes the person's login and every access — the club's records about them stay, and a colleague's access is untouched", async () => {
    const leaver = await prisma.user.create({ data: { email: emailFor("leaver"), name: `${TAG} leaver` } });
    const keeper = await prisma.user.create({ data: { email: emailFor("keeper"), name: `${TAG} keeper` } });
    const club = await prisma.organization.create({
      data: {
        name: `${TAG} club`,
        kind: "community",
        members: { create: [{ userId: keeper.id, role: "owner" }, { userId: leaver.id, role: "admin" }] },
      },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: club.id,
        name: `${TAG} medal`,
        dates: "", course: "", city: "", address: "", regDeadline: "",
        shareToken: `${TAG}-${Date.now()}`,
      },
    });
    const thread = await prisma.thread.create({ data: { organizationId: club.id, scopeKey: `${TAG}-thread` } });
    for (const [who, emailAsStored] of [
      ["leaver", emailFor("leaver").toUpperCase()],
      ["keeper", emailFor("keeper")],
    ] as const) {
      await prisma.account.create({ data: { eventId: event.id, name: `${TAG} ${who}`, email: emailAsStored, role: "admin" } });
      await prisma.pushSubscription.create({
        data: { endpoint: `https://push.example.invalid/${TAG}-${who}-${Date.now()}`, p256dh: "zz", auth: "zz", email: emailFor(who) },
      });
      await prisma.threadParticipant.create({ data: { threadId: thread.id, email: emailFor(who) } });
      await prisma.threadRead.create({ data: { threadId: thread.id, email: emailFor(who) } });
    }
    // What the CLUB holds about the leaver: a roster entry and a place in the field.
    const member = await prisma.member.create({ data: { organizationId: club.id, name: `${TAG} leaver`, email: emailFor("leaver") } });
    const player = await prisma.player.create({ data: { eventId: event.id, memberId: member.id, name: `${TAG} leaver`, seed: 1 } });

    // CONTROL of the instrument: the leaver starts with one of everything.
    expect(await accessOf(emailFor("leaver"), leaver.id)).toEqual({ user: 1, staff: 1, grants: 1, pushes: 1, threadPlaces: 1, reads: 1 });
    const keeperBefore = await accessOf(emailFor("keeper"), keeper.id);

    await deleteAccountAndAccess(leaver.id, leaver.email);

    expect(await accessOf(emailFor("leaver"), leaver.id)).toEqual({ user: 0, staff: 0, grants: 0, pushes: 0, threadPlaces: 0, reads: 0 });
    expect(await accessOf(emailFor("keeper"), keeper.id)).toEqual(keeperBefore);
    expect(await prisma.member.count({ where: { id: member.id } }), "the club's roster entry went with the login").toBe(1);
    expect(await prisma.player.count({ where: { id: player.id } }), "the tournament entry went with the login").toBe(1);
    expect(await prisma.organization.count({ where: { id: club.id } })).toBe(1);
  });

  it("names the clubs somebody is the ONLY owner of — and not one they share", async () => {
    const solo = await prisma.user.create({ data: { email: emailFor("solo"), name: `${TAG} solo` } });
    await prisma.organization.create({ data: { name: `${TAG} solo club`, kind: "community", members: { create: { userId: solo.id, role: "owner" } } } });
    expect(await soleOwnedClubs(solo.id)).toEqual([`${TAG} solo club`]);

    const keeper = await prisma.user.findUniqueOrThrow({ where: { email: emailFor("keeper") } });
    const shared = await prisma.organization.create({
      data: { name: `${TAG} shared club`, kind: "community", members: { create: [{ userId: solo.id, role: "owner" }, { userId: keeper.id, role: "owner" }] } },
    });
    expect(await soleOwnedClubs(solo.id)).toEqual([`${TAG} solo club`]);
    expect(shared.id).toBeTruthy();
  });
});
