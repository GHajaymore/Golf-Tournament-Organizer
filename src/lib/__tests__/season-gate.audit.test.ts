import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { seasonTableFor } from "../services/season";

/**
 * The season table is a PAID feature, and this proves the gate rather than
 * trusting it.
 *
 * A gate is worth exactly what it is measured to be worth. The failure mode
 * is silent in the direction that costs money: an ungated reader returns a
 * perfectly good table and nobody notices it was given away, because nothing
 * looks broken. So the assertion is not only "allowed is false" — it is that
 * the ROWS ARE NOT THERE, because a caller handed the numbers and trusted to
 * hide them is a caller that will one day render them.
 *
 * Real rows, so it lives in the audit config: the plan is a subscription row,
 * and the whole point is what the database says rather than what a mock does.
 */
const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SEASON-GATE";

let orgId = "";
let eventId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  const orgs = await prisma.organization.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  for (const o of orgs) {
    await prisma.subscription.deleteMany({ where: { organizationId: o.id } });
  }
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
  });
  orgId = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} thursday league`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "draft",
      shape: "series",
      formationRule: "manual",
      shareToken: `${TAG}-${orgId}`,
    },
  });
  eventId = event.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
}, 60_000);

describe("the season table is gated on the plan", () => {
  it("gives a free club no table and no rows to read", async () => {
    // No subscription row at all is the free default, which is the state
    // every club starts in.
    await prisma.subscription.deleteMany({ where: { organizationId: orgId } });

    const table = await seasonTableFor(eventId);
    expect(table.allowed).toBe(false);
    // The numbers are ABSENT, not merely flagged. Handing them over and
    // trusting the screen to hide them is how a paid feature leaks.
    expect(table.rows).toEqual([]);
    expect(table.totals.teams).toBe(0);
    expect(table.totals.points).toBe(0);
    // And it says why, in something a club can act on.
    expect(table.reason).toBeTruthy();
    expect(table.reason.toLowerCase()).toContain("paid plan");
  });

  it("gives a paid club the table", async () => {
    await prisma.subscription.upsert({
      where: { organizationId: orgId },
      update: { plan: "club" },
      create: { organizationId: orgId, plan: "club" },
    });

    const table = await seasonTableFor(eventId);
    expect(table.allowed).toBe(true);
    expect(table.reason).toBe("");
    // This league has no team rounds yet, so the table is legitimately empty
    // — but it is an ALLOWED empty, which is a different answer from a locked
    // one and must not be conflated with it.
    expect(Array.isArray(table.rows)).toBe(true);
    expect(table.rounds).toBe(0);
  });

  it("does not leak a table for an event that does not exist", async () => {
    // A missing event resolves to the default plan, which is free. It must
    // not fall through to an allowed empty table on a made-up id.
    const table = await seasonTableFor(`${TAG}-no-such-event`);
    expect(table.rows).toEqual([]);
    expect(table.allowed).toBe(false);
  });
});
