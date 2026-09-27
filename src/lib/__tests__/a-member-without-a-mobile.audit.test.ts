import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const session = { email: "", name: "", id: "" };
vi.mock("@/lib/auth", () => ({
  getSession: async () => (session.email ? { ...session } : null),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { enterThisTournament } from "@/app/actions/enter";

/**
 * ONE-TAP ENTRY KEEPS THE CLUB'S MOBILE RULE, like every other door.
 *
 * A free club collects a mobile from every entrant (`phoneRequiredFor`). The
 * public form, the organizer adding a player and the roster import all refuse
 * without one; one-tap entry took the roster's phone as it found it, so a
 * member with none was entered, and Registration then told the organizer the
 * entry predated the rule. Walked on the seeded Captain's Day, 2026-09-26.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-no-mobile";
const WHO = `${TAG}-${randomBytes(4).toString("hex")}@example.invalid`;
let eventId = "";
let memberId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  // A new organization is on the free plan, which always needs a mobile.
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const user = await prisma.user.create({ data: { email: WHO, name: `${TAG} Member` }, select: { id: true, email: true, name: true } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "member" } });
  session.email = user.email;
  session.name = user.name;
  session.id = user.id;
  memberId = (
    await prisma.member.create({
      data: { organizationId: org.id, name: `${TAG} Roster Name`, email: user.email, handicap: 12, phone: "" },
      select: { id: true },
    })
  ).id;
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} medal`,
        status: "registration",
        shape: "single",
        format: "stroke",
        formationRule: "balanced",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        capacity: 40,
        registrationOpen: true,
        registrationApproval: "auto",
        registrationToken: randomBytes(6).toString("hex"),
        shareToken: randomBytes(10).toString("hex"),
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a member the club has no mobile for", () => {
  it("is refused, told why, and nothing is written", async () => {
    const res = await enterThisTournament(eventId);
    expect(res.ok, "entered without the mobile every other door insists on").toBe(false);
    expect(res.error).toMatch(/mobile/);
    expect(await prisma.player.count({ where: { eventId } })).toBe(0);
  });

  it("is in once the club has their number (the control)", async () => {
    // Without this, refusing everybody would pass the case above.
    await prisma.member.update({ where: { id: memberId }, data: { phone: "07700 900456" } });
    const res = await enterThisTournament(eventId);
    expect(res).toMatchObject({ ok: true, status: "confirmed" });
    const row = await prisma.player.findFirst({ where: { eventId } });
    expect(row?.phone).toBe("07700 900456");
  });
});
