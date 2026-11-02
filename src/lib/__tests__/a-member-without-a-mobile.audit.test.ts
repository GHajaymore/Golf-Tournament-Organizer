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
 * ONE-TAP ENTRY KEEPS THE TOURNAMENT'S MOBILE RULE, like every other door.
 *
 * A tournament whose organizer asks for a mobile collects one from every
 * entrant (`phoneRequiredFor`). The public form, the organizer adding a player
 * and the roster import all refuse without one; one-tap entry took the
 * roster's phone as it found it, so a member with none was entered, and
 * Registration then told the organizer the entry predated the rule. Walked on
 * the seeded Captain's Day, 2026-09-26.
 *
 * Until 2026-10-21 the free plan asked on every tournament. Since the
 * decisions review (A7) it asks only where the organizer turns it on — so the
 * refusal is pinned on a free club's tournament that ASKS, and a free club's
 * tournament that does not lets the same member in with no mobile.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-no-mobile";
const WHO = `${TAG}-${randomBytes(4).toString("hex")}@example.invalid`;
let eventId = "";
let quietEventId = "";
let memberId = "";
let orgId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  // A new organization is on the free plan.
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  orgId = org.id;
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
  const medal = (name: string, requirePhone: boolean) =>
    prisma.event.create({
      data: {
        organizationId: org.id,
        name,
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
        requirePhone,
        registrationToken: randomBytes(6).toString("hex"),
        shareToken: randomBytes(10).toString("hex"),
      },
      select: { id: true },
    });
  eventId = (await medal(`${TAG} medal`, true)).id;
  quietEventId = (await medal(`${TAG} medal that asks no mobile`, false)).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a member the club has no mobile for", () => {
  it("is let in, on a free club, where the tournament asks for none (A7)", async () => {
    const plan = await prisma.subscription.findUnique({ where: { organizationId: orgId }, select: { plan: true } });
    expect(plan?.plan ?? "free", "the club is on the free plan").toBe("free");
    const res = await enterThisTournament(quietEventId);
    expect(res).toMatchObject({ ok: true, status: "confirmed" });
    const row = await prisma.player.findFirst({ where: { eventId: quietEventId } });
    expect(row?.phone).toBe("");
  });

  it("is refused, told why, and nothing is written, where the tournament asks", async () => {
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
