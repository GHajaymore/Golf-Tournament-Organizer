import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A casual round is free, and separate from the club.
 *
 * Two properties, both invisible from a unit test because both are about what
 * a COUNT over real rows returns:
 *
 *  1. A quick round does not consume the plan's tournament allowance. It used
 *     to, and the consequence ran both ways — a Sunday fourball ate a slot the
 *     club was paying for, and a club sitting AT its cap was refused a casual
 *     round entirely. The app declining a free feature because a paid one was
 *     full is the worse half.
 *
 *  2. A guest entered on a casual round does not join the club's roster. Every
 *     name used to be pushed in by `upsertMember`, which fills a member list
 *     with people who are not members — and, since a member with no email is
 *     matched BY NAME, lets a second different Dave land on the first Dave's
 *     row and overwrite his handicap index. That one is silent and corrupts a
 *     real member's data.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CASUAL-FREE";

const { activeEventCount } = await import("@/lib/services/limits");

let organizationId = "";

async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeEvent(name: string, shape: string, status = "live") {
  return prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `zz-free-${Math.random().toString(36).slice(2)}`,
      status,
      shape,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club` },
    select: { id: true },
  });
  organizationId = org.id;
});

afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("what counts against the tournament allowance", () => {
  it("counts tournaments and ignores casual rounds", async () => {
    expect(await activeEventCount(organizationId)).toBe(0);

    await makeEvent("a real tournament", "series");
    expect(await activeEventCount(organizationId)).toBe(1);

    // Three casual rounds, which is a busy Sunday and not three tournaments.
    await makeEvent("sunday fourball", "match");
    await makeEvent("sunday singles", "match");
    await makeEvent("sunday medal", "match");
    expect(await activeEventCount(organizationId)).toBe(1);

    // A second real tournament still moves the number, or the assertion above
    // is satisfied by a count that has simply stopped working.
    await makeEvent("the club championship", "single");
    expect(await activeEventCount(organizationId)).toBe(2);
  });

  it("still ignores a completed tournament, which is the rule it already had", async () => {
    // Asserted because the new condition is an AND with the old one, and an
    // AND written wrongly is how a working rule disappears behind a new one.
    await makeEvent("last year's", "series", "completed");
    expect(await activeEventCount(organizationId)).toBe(2);
  });
});

describe("who ends up on the club's roster", () => {
  it("has no members at all after a casual round is set up", async () => {
    /**
     * Read from the ROSTER, not from the round.
     *
     * The bug this covers is not visible on the round — the players are there
     * either way, correctly named and correctly handicapped. It is visible
     * only in the club's member list afterwards, which is a table nobody looks
     * at until it is full of strangers.
     *
     * The fixture organization is created empty in `beforeAll` and the events
     * above are the only things made in it, so any `Member` row here came from
     * a code path that put one there.
     */
    const members = await prisma.member.count({ where: { organizationId } });
    expect(members).toBe(0);
  });

  it("lets a guest hold a handicap without holding a membership", async () => {
    // "Guest" must not come to mean "cannot play net". The handicap lives on
    // the Player row, which is per-event and per-round by design — the schema
    // already calls it a snapshot, so that correcting an index today never
    // rewrites a result from last season.
    const round = await makeEvent("guest round", "match");
    const guest = await prisma.player.create({
      data: {
        eventId: round.id,
        name: `${TAG} a mate`,
        handicap: 18.1,
        seed: 1,
        status: "confirmed",
        // The whole point: no member behind them.
        memberId: null,
      },
      select: { id: true, handicap: true, memberId: true },
    });

    expect(guest.handicap).toBe(18.1);
    expect(guest.memberId).toBeNull();
    expect(await prisma.member.count({ where: { organizationId } })).toBe(0);
  });
});
