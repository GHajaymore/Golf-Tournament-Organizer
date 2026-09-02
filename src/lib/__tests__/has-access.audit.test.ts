import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hasAccess } from "@/lib/services/access";

/**
 * Who counts as already belonging here.
 *
 * `hasAccess` is the single answer behind three doors — signing in, claiming a
 * provisioned account, and signing up — and before it existed each door worked
 * it out separately by counting `Account` rows. `Account` is access to ONE
 * EVENT. Club staff are `OrganizationMember`, created by
 * `addOrganizationMember`, which writes no `Account` row at all, so an invited
 * assistant was invisible to every door:
 *
 *   log in  -> "Wrong email or password", which was false
 *   claim   -> "No tournament access found for this email"
 *   forgot  -> silently sent nothing
 *   sign up -> silently attached a password to their existing row
 *
 * Real rows, because the entire bug is which table gets counted — a stubbed
 * client would have agreed with the broken version.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-HASACCESS";

const staffEmail = "zz-hasaccess.staff@example.invalid";
const playerEmail = "zz-hasaccess.player@example.invalid";
const bothEmail = "zz-hasaccess.both@example.invalid";
const strangerEmail = "zz-hasaccess.stranger@example.invalid";

let orgId = "";
let eventId = "";

async function scrub() {
  const orgs = await prisma.organization.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  // Event, Account and OrganizationMember all cascade from the organization;
  // User does not, so it is named explicitly.
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
  await prisma.user.deleteMany({
    where: { email: { in: [staffEmail, playerEmail, bothEmail, strangerEmail] } },
  });
}

beforeAll(async () => {
  await scrub();

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  const event = await prisma.event.create({
    data: {
      name: `${TAG} open`,
      organizationId: orgId,
      dates: "2026-01-01",
      course: `${TAG} links`,
      city: "Nowhere",
      address: "1 Fixture Way",
      regDeadline: "2026-01-01",
      shareToken: `${TAG}-share-token`,
    },
  });
  eventId = event.id;

  // Club staff: User + OrganizationMember, and deliberately NO Account row.
  // This is the case every door used to miss.
  const staff = await prisma.user.create({ data: { email: staffEmail, name: "Zz Staff" } });
  await prisma.organizationMember.create({
    data: { organizationId: orgId, userId: staff.id, role: "admin" },
  });

  // An event-provisioned player: an Account row, no User at all. This always
  // worked, and must keep working.
  await prisma.account.create({
    data: { eventId, email: playerEmail, name: "Zz Player", role: "player" },
  });

  // Both, to prove the two are OR'd rather than one masking the other.
  const both = await prisma.user.create({ data: { email: bothEmail, name: "Zz Both" } });
  await prisma.organizationMember.create({
    data: { organizationId: orgId, userId: both.id, role: "member" },
  });
  await prisma.account.create({
    data: { eventId, email: bothEmail, name: "Zz Both", role: "player" },
  });
});

afterAll(async () => {
  // In a finally, so a failing assertion still leaves the database clean.
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("hasAccess", () => {
  it("recognises club staff who have no event access yet", async () => {
    // The regression. This returned false, which made sign-in lie, claiming
    // impossible, and sign-up the only working door.
    expect(await hasAccess(staffEmail)).toBe(true);
  });

  it("still recognises an event-provisioned player", async () => {
    expect(await hasAccess(playerEmail)).toBe(true);
  });

  it("recognises someone who is both", async () => {
    expect(await hasAccess(bothEmail)).toBe(true);
  });

  it("does not recognise an address that belongs to nobody", async () => {
    // The other half: a guard that says yes to everyone protects nothing, and
    // would turn sign-up into a door that refuses every new organizer.
    expect(await hasAccess(strangerEmail)).toBe(false);
  });

  it("does not recognise a User row with no membership at all", async () => {
    // Having signed up once is not access. Creating the row and nothing else
    // must not make sign-up refuse them.
    const orphan = "zz-hasaccess.orphan@example.invalid";
    await prisma.user.deleteMany({ where: { email: orphan } });
    await prisma.user.create({ data: { email: orphan, name: "Zz Orphan" } });
    try {
      expect(await hasAccess(orphan)).toBe(false);
    } finally {
      await prisma.user.deleteMany({ where: { email: orphan } });
    }
  });

  it("matches regardless of case or surrounding space", async () => {
    // Addresses arrive from a form and from a CSV import, and the two do not
    // agree about capitalisation.
    expect(await hasAccess(`  ${staffEmail.toUpperCase()} `)).toBe(true);
  });

  it("says no to an empty address rather than counting every row", async () => {
    // A blank email must never match; `where: { email: "" }` against a table
    // whose column defaults to "" would otherwise be a skeleton key.
    expect(await hasAccess("")).toBe(false);
    expect(await hasAccess("   ")).toBe(false);
  });
});
