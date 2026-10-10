import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { accessibleEvents } from "@/lib/services/access";

/**
 * A MEMBER ON THE CLUB'S ROSTER SEES THE CLUB'S TOURNAMENTS (2026-10-10).
 *
 * A society imported its 110 members and every one who signed in read "No
 * tournaments yet": only an approved join request (`OrganizationMember`) opened
 * the calendar, and the roster the organizer keeps was not membership. Linked
 * by email, as every club system links them — `player`, the same as a member.
 *
 * Controls: a LAPSED member (inactive roster row) sees nothing, and the roster
 * of one club opens nothing at another.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROSTER-ACCESS";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let ours = "";
let theirs = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const event = (organizationId: string, name: string) =>
  prisma.event.create({
    data: { name: `${TAG} ${name}`, organizationId, status: "registration", format: "stroke", dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${name}` },
    select: { id: true },
  });

beforeAll(async () => {
  await cleanup();
  const society = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "society" }, select: { id: true } });
  const other = await prisma.organization.create({ data: { name: `${TAG} other club`, kind: "club" }, select: { id: true } });
  ours = (await event(society.id, "saturday stableford")).id;
  theirs = (await event(other.id, "other club medal")).id;
  // The organizer's import: names and emails on the roster, nothing else.
  await prisma.member.create({ data: { organizationId: society.id, name: "Member", email: at("member").toUpperCase(), status: "active" } });
  await prisma.member.create({ data: { organizationId: society.id, name: "Lapsed", email: at("lapsed"), status: "inactive" } });
  for (const who of ["member", "lapsed"]) {
    await prisma.user.create({ data: { email: at(who), name: who, password: "x:unusable" } });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a rostered member signing in", () => {
  it("reaches their club's tournament, as a player — whatever the case of the roster email", async () => {
    const reach = await accessibleEvents(at("member"));
    expect(reach.find((r) => r.eventId === ours)).toMatchObject({ role: "player", source: "organization" });
  });

  it("CONTROL: not another club's", async () => {
    expect((await accessibleEvents(at("member"))).some((r) => r.eventId === theirs)).toBe(false);
  });

  it("CONTROL: a lapsed member reaches nothing", async () => {
    expect((await accessibleEvents(at("lapsed"))).some((r) => r.eventId === ours)).toBe(false);
  });
});
