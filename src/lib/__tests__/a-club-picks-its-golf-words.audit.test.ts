import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { golfRegister } from "@/lib/domain/golf-terms";

/**
 * A CLUB PICKS ITS GOLF WORDS (Ajay, 2026-09-27: "local by default and
 * overridden option for … US terminologies").
 *
 * The rules that need real rows: the choice sticks and beats the country, an
 * unknown value is refused rather than stored, only staff may make it, and ""
 * goes back to following the country.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-GOLFTERMS";

const session = { email: "", name: "", eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  setActiveEvent: async () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/email", () => ({ sendStaffInviteEmail: async () => {}, sendJoinRequestEmail: async () => {} }));

const { saveOrganizationGolfTerms } = await import("@/app/actions/organization");

const owner = { email: `${TAG.toLowerCase()}-owner@example.invalid`, name: `${TAG} Owner` };
const bystander = { email: `${TAG.toLowerCase()}-bystander@example.invalid`, name: `${TAG} Bystander` };

let orgId = "";
let eventId = "";

async function scrub() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  if (orgs.length) await prisma.event.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

const stored = async () =>
  prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { golfTerms: true, country: true } });

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: owner.email, name: owner.name, password: "x:unusable" } });
  await prisma.user.create({ data: { email: bystander.email, name: bystander.name, password: "x:unusable" } });
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} Braeside Golf Club`,
      kind: "club",
      country: "Scotland",
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
  orgId = org.id;
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} Monthly Medal`,
        status: "registration", shape: "single", format: "stroke", formationRule: "balanced",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: `${TAG.toLowerCase()}-share`,
        registrationToken: `${TAG.toLowerCase()}-reg`,
      },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.organization.update({ where: { id: orgId }, data: { golfTerms: "" } });
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

describe("a club picks its golf words", () => {
  it("follows its country until it says otherwise", async () => {
    const s = await stored();
    expect(s.golfTerms).toBe("");
    expect(golfRegister(s.country, s.golfTerms)).toBe("uk");
  });

  it("keeps the club's choice, which beats the country", async () => {
    expect(await saveOrganizationGolfTerms("us")).toMatchObject({ ok: true });
    const s = await stored();
    expect(s.golfTerms).toBe("us");
    expect(golfRegister(s.country, s.golfTerms), "a Scottish club that chose US words").toBe("us");
  });

  it("goes back to following the country on the blank choice", async () => {
    await saveOrganizationGolfTerms("us");
    expect(await saveOrganizationGolfTerms("")).toMatchObject({ ok: true });
    expect((await stored()).golfTerms).toBe("");
  });

  it("refuses a value nobody has heard of rather than storing it", async () => {
    const res = await saveOrganizationGolfTerms("klingon");
    expect(res.ok).toBe(false);
    expect((await stored()).golfTerms, "an unknown value reached the database").toBe("");
  });

  it("refuses somebody who is not the club's owner or admin", async () => {
    session.email = bystander.email;
    session.name = bystander.name;
    session.role = "player";
    session.viewRole = "player";
    const res = await saveOrganizationGolfTerms("us");
    expect(res.ok, "a player changed the whole club's words").toBe(false);
    expect(res.error).toMatch(/owner or admin/i);
    expect((await stored()).golfTerms).toBe("");
  });
});
