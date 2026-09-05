import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { availabilityFor } from "@/lib/services/availability";
import { loadEventState } from "@/lib/services/tournament";

/**
 * A flight captain who leaves the flight loses the flight.
 *
 * `setFlightCaptain` refuses to appoint somebody who is not a member of the
 * flight, and says so. Nothing revoked it afterwards: `movePlayerToGroup`
 * wrote `Player.groupId` and never touched `Group.captainId`, and `regroup`
 * nulls every `groupId` while reusing the Group rows in place.
 *
 * `captainFlightsFor` then selected groups by captain id with no membership
 * condition and filled the rows from the flight's CURRENT members. So an
 * ex-captain kept a panel on their own /me screen listing every current member
 * of a flight they had left, by name, with each one's in-or-out answer for
 * every round of the season.
 *
 * That is the reason this is tested against real rows rather than by reading
 * the source: the leak is a join between three tables, and the only way to
 * prove it is closed is to move somebody and ask the screen.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CAPTAIN";

let eventId = "";
let flightA = "";
let flightB = "";
const player: Record<string, string> = {};
const email: Record<string, string> = {};

/** Skip is the captain of Flight A; Ann and Bea are its members. */
const WHO = ["skip", "ann", "bea", "carl"] as const;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      // A league that ASKS the player, or `availabilityFor` returns the empty
      // view before it reaches any of this.
      attendanceMode: "opt-out",
    },
  });
  eventId = event.id;

  await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: "2026-06-01" },
  });

  const [a, b] = await Promise.all([
    prisma.group.create({ data: { eventId, name: "A", position: 0 } }),
    prisma.group.create({ data: { eventId, name: "B", position: 1 } }),
  ]);
  flightA = a.id;
  flightB = b.id;

  for (const [i, who] of WHO.entries()) {
    const addr = `${TAG}.${who}@example.invalid`.toLowerCase();
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: addr,
        seed: i + 1,
        status: "confirmed",
        // Carl is in Flight B from the start, so the two flights are distinct.
        groupId: who === "carl" ? flightB : flightA,
      },
    });
    player[who] = p.id;
    email[who] = addr;
  }
});

beforeEach(async () => {
  // Back to the starting position: Skip captains A and is in it.
  await prisma.player.update({ where: { id: player.skip }, data: { groupId: flightA } });
  await prisma.group.update({
    where: { id: flightA },
    data: { captainId: player.skip, viceCaptainId: null },
  });
  await prisma.group.update({ where: { id: flightB }, data: { captainId: null, viceCaptainId: null } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const captainViewFor = async (who: string) => {
  const state = await loadEventState(eventId);
  if (!state) throw new Error("no state");
  return (await availabilityFor(state, email[who])).captainOf;
};

describe("a flight captain who is still in their flight", () => {
  it("sees it, with its members", async () => {
    /**
     * The control. Without this the test below passes because the panel is
     * empty for everybody — which is exactly how a fix that simply broke the
     * feature would look.
     */
    const view = await captainViewFor("skip");
    expect(view).toHaveLength(1);
    expect(view[0].flightName).toBe("A");
    const names = view[0].rows.map((r) => r.name);
    expect(names).toContain(`${TAG} ann`);
    expect(names).toContain(`${TAG} bea`);
  });
});

describe("a flight captain who has been moved to another flight", () => {
  it("no longer sees the flight they left", async () => {
    // THE LEAK. Skip moves to B; `Group.captainId` on A still names him.
    await prisma.player.update({ where: { id: player.skip }, data: { groupId: flightB } });

    const view = await captainViewFor("skip");
    expect(view.map((f) => f.flightName)).not.toContain("A");
  });

  it("does not carry the old flight's members and their answers", async () => {
    // The part that makes it privacy rather than tidiness: the panel listed
    // every current member of the flight by name, with their in-or-out answer
    // for every round.
    await prisma.player.update({ where: { id: player.skip }, data: { groupId: flightB } });

    const view = await captainViewFor("skip");
    const names = view.flatMap((f) => f.rows.map((r) => r.name));
    expect(names).not.toContain(`${TAG} ann`);
    expect(names).not.toContain(`${TAG} bea`);
  });

  it("still sees a flight they captain AND are in", async () => {
    // Two appointments, one of which survives the move. Only the stale one
    // goes — a captain is not stripped of a flight they are still in.
    await prisma.player.update({ where: { id: player.skip }, data: { groupId: flightB } });
    await prisma.group.update({ where: { id: flightB }, data: { captainId: player.skip } });

    const view = await captainViewFor("skip");
    expect(view.map((f) => f.flightName)).toEqual(["B"]);
  });

  it("applies to a VICE captain too", async () => {
    // The query matches on either column, so both need the membership test.
    await prisma.group.update({
      where: { id: flightA },
      data: { captainId: player.ann, viceCaptainId: player.skip },
    });
    await prisma.player.update({ where: { id: player.skip }, data: { groupId: flightB } });

    const view = await captainViewFor("skip");
    expect(view.map((f) => f.flightName)).not.toContain("A");
  });

  it("leaves the real captain's own view untouched", async () => {
    // Ann is in A and captains it; Skip leaving must not affect her.
    await prisma.group.update({ where: { id: flightA }, data: { captainId: player.ann } });
    await prisma.player.update({ where: { id: player.skip }, data: { groupId: flightB } });

    const view = await captainViewFor("ann");
    expect(view.map((f) => f.flightName)).toEqual(["A"]);
  });
});
