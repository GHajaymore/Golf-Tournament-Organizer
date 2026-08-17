import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { emailTroubleFor } from "@/lib/services/email-trouble";
import { TROUBLE_WINDOW_MS } from "@/lib/domain/email-trouble";

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
