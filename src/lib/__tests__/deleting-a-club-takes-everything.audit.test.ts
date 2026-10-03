import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * DELETING A CLUB TAKES EVERYTHING IT HELD — AND NOTHING ELSE (2026-10-03).
 *
 * Against real rows, because the failure here is silent in both directions:
 * personal data left behind that the screen said was gone, or a neighbouring
 * club's data taken with it. Built to catch both:
 *
 *   - the club holds a tournament with an entered player, a roster member, a
 *     staff membership, a subscription — everything that cascades — AND an
 *     SMS record and a failed-email record, the two tables that do NOT
 *     cascade and must be deleted explicitly;
 *   - a CONTROL club with the same shape is created beside it, and must be
 *     exactly as it was afterwards.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DELCLUB";

vi.mock("server-only", () => ({}));
const { deleteClubAndEverything } = await import("@/lib/services/club-deletion");

const emailFor = (who: string) => `zz-audit-delclub-${who}@example.invalid`;
const WHO = ["doomed", "control"];

async function scrub() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  // By mark as well as by club: a run that fails part-way (or a mutation run)
  // can leave these behind for a club that no longer exists.
  await prisma.smsDelivery.deleteMany({ where: { OR: [{ organizationId: { in: ids } }, { body: { startsWith: TAG } }] } });
  await prisma.emailFailure.deleteMany({
    where: { OR: [{ organizationId: { in: ids } }, { toEmail: { startsWith: "zz-audit-delclub-" } }] },
  });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: WHO.map(emailFor) } } });
}

/** A club with one of everything, the non-cascading tables included. */
async function fullClub(who: string) {
  const user = await prisma.user.create({ data: { email: emailFor(who), name: `${TAG} ${who}` } });
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} ${who}`,
      kind: "community",
      subscription: { create: { plan: "free", status: "active", planTermsApply: true } },
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  const member = await prisma.member.create({ data: { organizationId: org.id, name: `${TAG} member ${who}`, email: emailFor(`${who}-m`) } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} ${who} medal`,
      dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG}-${who}-${Date.now()}`,
    },
  });
  await prisma.player.create({ data: { eventId: event.id, memberId: member.id, name: `${TAG} player ${who}`, seed: 1 } });
  await prisma.smsDelivery.create({ data: { organizationId: org.id, toPhone: "+15550000000", toName: `${TAG} ${who}`, body: `${TAG} tee time` } });
  await prisma.emailFailure.create({ data: { organizationId: org.id, kind: "registration", reason: "bounced", toEmail: emailFor(`${who}-e`) } });
  return { orgId: org.id, eventId: event.id, memberId: member.id, userId: user.id };
}

async function footprint(orgId: string, eventId: string) {
  return {
    org: await prisma.organization.count({ where: { id: orgId } }),
    staff: await prisma.organizationMember.count({ where: { organizationId: orgId } }),
    subscription: await prisma.subscription.count({ where: { organizationId: orgId } }),
    roster: await prisma.member.count({ where: { organizationId: orgId } }),
    events: await prisma.event.count({ where: { organizationId: orgId } }),
    players: await prisma.player.count({ where: { eventId } }),
    sms: await prisma.smsDelivery.count({ where: { organizationId: orgId } }),
    emailFailures: await prisma.emailFailure.count({ where: { organizationId: orgId } }),
  };
}

beforeAll(scrub);
afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("deleting a club", () => {
  it("takes every row it held, the non-cascading ones included — and leaves its neighbour alone", async () => {
    const doomed = await fullClub("doomed");
    const control = await fullClub("control");

    // CONTROL of the instrument: both start with one of everything, so a zero
    // afterwards means deleted rather than never there.
    const before = await footprint(doomed.orgId, doomed.eventId);
    expect(Object.values(before).every((n) => n === 1), JSON.stringify(before)).toBe(true);
    const controlBefore = await footprint(control.orgId, control.eventId);

    await deleteClubAndEverything(doomed.orgId);

    expect(await footprint(doomed.orgId, doomed.eventId)).toEqual({
      org: 0, staff: 0, subscription: 0, roster: 0, events: 0, players: 0, sms: 0, emailFailures: 0,
    });
    expect(await footprint(control.orgId, control.eventId)).toEqual(controlBefore);

    // The owner's own account stays: it may belong to other clubs.
    expect(await prisma.user.count({ where: { id: doomed.userId } })).toBe(1);
  });
});
