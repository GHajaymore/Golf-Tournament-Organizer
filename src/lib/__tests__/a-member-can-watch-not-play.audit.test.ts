import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { accessibleEvents } from "@/lib/services/access";
import { myPlayerIds } from "@/lib/services/me";

/**
 * A CLUB MEMBER CAN WATCH THEIR CLUB. THEY CANNOT PLAY SOMEBODY ELSE'S ROUND.
 *
 * `accessibleEvents` asked `OrganizationMember` for owners and admins only, so
 * a plain member — which is what that column DEFAULTS to — could open nothing
 * at all unless an organizer had added them to a specific tournament by hand.
 * There was no way to browse what your own club was running, or to enter
 * yourself in it.
 *
 * Opening that door grants the `player` role across the club, and the whole
 * question is whether the role carries any WRITE with it. It does not, and the
 * reason is worth stating because it is why this needed no new role:
 *
 *     assertOwnCard      resolves myPlayerIds(eventId, email) and refuses
 *                        anything outside it
 *     assertEventPlayer  insists the player is in THIS tournament
 *
 * A member who is not entered has no `Player` row, so `ownPlayerIds` is empty
 * and every card write is refused by a guard that was already there. Writes
 * are gated on being IN THE FIELD, not on holding a role.
 *
 * This file pins that, because it is a security property and reading one
 * function is not evidence. Three people against one tournament:
 *
 *     entered     a club member who IS in the field
 *     watching    a club member who is NOT, and never has been
 *     stranger    no membership at all
 *
 * The stranger is the control. Without them, every assertion below passes on a
 * function that returns nothing for anybody.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-member-watch";

const email = {
  entered: `${TAG}-entered@example.invalid`,
  watching: `${TAG}-watching@example.invalid`,
  stranger: `${TAG}-stranger@example.invalid`,
};

let eventId = "";
let enteredPlayerId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();

  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });
  eventId = event.id;

  // Two club members with logins. NEITHER is given an Account on the event —
  // the whole point is what membership alone grants.
  for (const who of ["entered", "watching"] as const) {
    const user = await prisma.user.create({
      data: {
        email: email[who],
        name: `${TAG} ${who}`,
        password: `${randomBytes(8).toString("hex")}:unusable`,
      },
      select: { id: true },
    });
    await prisma.organizationMember.create({
      // The DEFAULT role, which is exactly the case that could open nothing.
      data: { organizationId: org.id, userId: user.id, role: "member" },
    });
  }

  await prisma.user.create({
    data: {
      email: email.stranger,
      name: `${TAG} stranger`,
      password: `${randomBytes(8).toString("hex")}:unusable`,
    },
  });

  // Only one of them is actually playing.
  const p = await prisma.player.create({
    data: {
      eventId,
      name: `${TAG} entered`,
      email: email.entered,
      handicap: 10,
      seed: 1,
      status: "confirmed",
    },
    select: { id: true },
  });
  enteredPlayerId = p.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("what club membership alone opens", () => {
  it("lets a member who is NOT entered reach their club's tournament", async () => {
    // The defect: this was empty, so the member could open nothing and had no
    // way to find the event, let alone enter it.
    const reachable = await accessibleEvents(email.watching);
    expect(reachable.map((e) => e.eventId), "a club member sees their club's events").toContain(eventId);
  });

  it("gives them the player role, not a staff one", async () => {
    const found = (await accessibleEvents(email.watching)).find((e) => e.eventId === eventId);
    expect(found?.role, "membership is not administration").toBe("player");
    expect(found?.source).toBe("organization");
  });

  it("gives a stranger nothing", async () => {
    /**
     * THE CONTROL. Without it every assertion here passes on a function that
     * hands the same list to everybody — which is the failure this change
     * would be worst to make.
     */
    const reachable = await accessibleEvents(email.stranger);
    expect(reachable.map((e) => e.eventId), "no membership, no access").not.toContain(eventId);
  });
});

describe("what it does NOT open", () => {
  it("owns no card, so every write guard refuses them", async () => {
    /**
     * `assertOwnCard` refuses any playerId outside this set, so an empty set is
     * a refusal of every card in the tournament. That is the property that
     * makes granting `player` across a club safe without a new role.
     */
    const own = await myPlayerIds(eventId, email.watching);
    expect(own.size, "a member who is not entered owns no card").toBe(0);
    expect(own.has(enteredPlayerId), "and certainly not somebody else's").toBe(false);
  });

  it("still lets the member who IS entered own theirs", async () => {
    /**
     * The other direction, and the one that keeps the test above meaningful: a
     * rule that returned nothing for everybody would satisfy it while breaking
     * the app for the people actually playing.
     */
    const own = await myPlayerIds(eventId, email.entered);
    expect(own.has(enteredPlayerId), "an entered member owns their own card").toBe(true);
    expect(own.size).toBe(1);
  });
});
