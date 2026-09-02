import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { emailTroubleFor } from "@/lib/services/email-trouble";
import { TROUBLE_WINDOW_MS } from "@/lib/domain/email-trouble";
import { organizationsFor } from "@/lib/email";

/**
 * That a refused email actually reaches the screen, against a real database.
 *
 * The domain test proves the wording; this proves the row is written, scoped to
 * one club, and read back. The whole point of the feature is that a failure
 * stops being invisible, so "the summariser works but nothing ever calls it"
 * would pass every unit test and still leave the bug exactly where it was.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MAIL";

let orgId = "";
let otherOrgId = "";

async function cleanup() {
  // EmailFailure holds an organizationId without a relation, the same as
  // SmsDelivery — so the ids have to be looked up rather than joined through.
  const orgs = await prisma.organization.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  await prisma.emailFailure.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const [a, b] = await Promise.all([
    prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } }),
    prisma.organization.create({ data: { name: `${TAG} other club`, kind: "club" } }),
  ]);
  orgId = a.id;
  otherOrgId = b.id;
});

beforeEach(async () => {
  await prisma.emailFailure.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const fail = (over: Record<string, unknown> = {}) =>
  prisma.emailFailure.create({
    data: {
      organizationId: orgId,
      kind: "registration",
      reason: "quota",
      detail: "You can only send 100 emails per day",
      ...over,
    },
  });

describe("what the Access screen is told", () => {
  it("says nothing for a club with no trouble", async () => {
    expect(await emailTroubleFor(orgId)).toBeNull();
  });

  it("surfaces a refused send", async () => {
    await fail();
    const trouble = await emailTroubleFor(orgId);
    expect(trouble?.severity).toBe("danger");
    expect(trouble?.count).toBe(1);
  });

  it("never shows one club another club's undelivered mail", async () => {
    // The rule every read in this app follows. A mail problem is as much a
    // club's private business as its roster.
    await fail();
    await fail({ organizationId: otherOrgId, kind: "reset" });

    expect((await emailTroubleFor(orgId))?.count).toBe(1);
    expect((await emailTroubleFor(otherOrgId))?.count).toBe(1);
    expect((await emailTroubleFor(otherOrgId))?.detail).toMatch(/cannot sign back in/);
  });

  it("lets an old failure fall out of the window", async () => {
    await fail({ createdAt: new Date(Date.now() - TROUBLE_WINDOW_MS - 60_000) });
    expect(await emailTroubleFor(orgId)).toBeNull();
  });

  it("counts a whole registration day, not just the first few", async () => {
    // The case this exists for: an event fills past the daily allowance and
    // every entry after it silently loses its confirmation.
    await prisma.emailFailure.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        organizationId: orgId,
        kind: "registration",
        reason: "quota",
        detail: "over allowance",
        toEmail: `${TAG}.p${i}@example.invalid`.toLowerCase(),
      })),
    });
    const trouble = await emailTroubleFor(orgId);
    expect(trouble?.count).toBe(25);
    expect(trouble?.detail).toMatch(/25 players/);
  });

  it("keeps who to follow up with for a registration, and not for a reset", async () => {
    // Deliberately asymmetric. An organizer chasing a missing confirmation
    // needs the address; a durable list of who forgot their password is a
    // record worth not keeping, and the fix there is the mail setup anyway.
    await fail({ toEmail: `${TAG}.player@example.invalid`.toLowerCase(), toName: "A Player" });
    await fail({ kind: "reset" });

    const rows = await prisma.emailFailure.findMany({
      where: { organizationId: orgId },
      select: { kind: true, toEmail: true },
    });
    expect(rows.find((r) => r.kind === "registration")?.toEmail).toContain("player@");
    expect(rows.find((r) => r.kind === "reset")?.toEmail).toBe("");
  });
});

/**
 * Whose failure gets recorded at all.
 *
 * `recordFailure` drops anything with an empty organization list, so the lookup
 * that builds that list decides whether a failure is visible or vanishes. It
 * read the club ROSTER only — and an organizer is not necessarily on their own
 * roster. They are a `User` joined through `OrganizationMember`, a table that
 * holds no email of its own.
 *
 * So an organizer's failed password reset produced no row, no Access card and
 * no signal of any kind, while a roster player's produced all three. That is
 * exactly backwards: the organizer is the person who can fix the mail
 * configuration, and the reset form is forbidden from telling them anything
 * (it would leak which addresses are registered). Their only channel was a
 * screen behind the sign-in they could not complete.
 *
 * Needs real rows because the whole bug lives in a join.
 */
describe("which organizations hear about a refused email", () => {
  const T = "ZZ-ORGSFOR";
  const rosterEmail = `${T.toLowerCase()}.player@example.invalid`;
  const staffEmail = `${T.toLowerCase()}.organizer@example.invalid`;
  const bothEmail = `${T.toLowerCase()}.both@example.invalid`;

  let clubId = "";

  async function scrub() {
    const orgs = await prisma.organization.findMany({
      where: { name: { startsWith: T } },
      select: { id: true },
    });
    // OrganizationMember and Member both cascade from their organization, so
    // the orgs and the users are the only things that need naming.
    await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
    await prisma.user.deleteMany({ where: { email: { in: [staffEmail, bothEmail] } } });
  }

  beforeAll(async () => {
    await scrub();
    const club = await prisma.organization.create({ data: { name: `${T} club`, kind: "club" } });
    clubId = club.id;

    // A roster player: an email on Member, no User at all. This is the case
    // that always worked.
    await prisma.member.create({
      data: { organizationId: clubId, name: "Zz Player", email: rosterEmail },
    });

    // An organizer: a User linked through OrganizationMember, and deliberately
    // NOT on the roster. This is the case that was invisible.
    const organizer = await prisma.user.create({
      data: { email: staffEmail, name: "Zz Organizer" },
    });
    await prisma.organizationMember.create({
      data: { organizationId: clubId, userId: organizer.id, role: "owner" },
    });

    // Someone who is both — to prove the two lookups are merged, not summed.
    const both = await prisma.user.create({ data: { email: bothEmail, name: "Zz Both" } });
    await prisma.organizationMember.create({
      data: { organizationId: clubId, userId: both.id, role: "admin" },
    });
    await prisma.member.create({
      data: { organizationId: clubId, name: "Zz Both", email: bothEmail },
    });
  });

  afterAll(async () => {
    // In a finally so a failing assertion still leaves the database clean — a
    // fixture left behind is one someone later mistakes for real.
    try {
      await scrub();
    } catch {
      /* the outer afterAll disconnects */
    }
  });

  it("still finds a roster player", async () => {
    expect(await organizationsFor(rosterEmail)).toEqual([clubId]);
  });

  it("finds an organizer who is not on their own roster", async () => {
    // The regression. This returned [] before, so the failure was dropped.
    expect(await organizationsFor(staffEmail)).toEqual([clubId]);
  });

  it("reports a club once for someone who is both", async () => {
    // Not [clubId, clubId] — recordFailure writes one row per id, so a
    // duplicate would file the same failure against the same club twice.
    expect(await organizationsFor(bothEmail)).toEqual([clubId]);
  });

  it("returns nothing for an address that belongs to no club", async () => {
    expect(await organizationsFor(`${T.toLowerCase()}.nobody@example.invalid`)).toEqual([]);
  });
});
