import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A MATCH CARRIER IS NOT A FLIGHT, proved against real rows.
 *
 * `Match.groupId` is NOT NULL, so a Single Match Stage's final and a bracket's
 * play-off need a Group to hang off. `matchCarrierGroup` makes one with no
 * players in it. Until `Group.stageId` existed, the only thing saying which
 * round it belonged to was its own NAME — "Match Play {em dash} Round 2" —
 * and that string was the find-or-create key.
 *
 * `regenerateGroupsAndSchedule` reused Group rows BY POSITION out of an
 * unfiltered list and renamed them in place. Carriers are created at
 * `maxPos + 1`, so they sit past the flights and are safe only while the
 * flight count never grows past them. Grow the field, press Generate flights,
 * and the carrier became a flight: renamed, given players, and — because the
 * name was the key — no longer findable, so the next generate would create a
 * SECOND carrier and split that round's matches across two rows.
 *
 * That is the failure both carrier call sites carry comments warning about.
 * They guarded it against RENUMBERING, which was never what renamed them.
 *
 * Only real rows can show this: it is a query, an ordering and an index.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CARRIER-FLIGHT";
const CARRIER_NAME = "Match Play — Round 2";

// `role`, not `viewRole` — `requireStaffEvent` reads the former, and a
// session carrying only the latter is refused with "Organizer access required".
let session: { eventId: string; email: string; role: string; viewRole: string; name: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { regenerateGroupsAndSchedule } = await import("@/lib/services/regroup");
const { createSingleMatch } = await import("@/app/actions/tournament");

let eventId = "";
let carrierId = "";
let singleStageId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/**
 * Two flights, a play-off carrier behind them, then a field big enough to want
 * THREE flights — so the reuse index reaches the carrier's position.
 *
 * Rebuilt per test rather than shared: `regenerateGroupsAndSchedule` rewrites
 * most of what is here, and a second test reading the first one's leftovers is
 * how a fixture comes to assert the wrong run.
 */
beforeEach(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      formationRule: "balanced",
      flightMode: "perFlight",
      flightValue: 2,
    },
  });
  eventId = event.id;
  session = { eventId, email: `${TAG}@example.invalid`, role: "admin", viewRole: "admin", name: "Audit" };
  // `requireStaffEvent` checks an Account row, not just the mocked session —
  // the action refuses with "Organizer access required" without one.
  await prisma.account.create({
    data: { eventId, name: "Audit", email: `${TAG}@example.invalid`, role: "admin" },
  });

  // Unbound: nothing below refers to it, but it has to EXIST — a tournament
  // with no Round Robin gives `regenerateGroupsAndSchedule` nothing to draw,
  // and the control assertion about rebuilt flights would pass on an empty
  // run for the wrong reason.
  await prisma.stage.create({
    data: { eventId, position: 0, type: "Round Robin", format: "Match Play" },
  });
  const single = await prisma.stage.create({
    data: {
      eventId,
      position: 1,
      type: "Single Match Stage",
      format: "Match Play",
    },
  });
  singleStageId = single.id;

  const players = [];
  for (let i = 0; i < 6; i += 1) {
    players.push(
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} Player ${i + 1}`,
          email: `${TAG}-p${i}@example.invalid`,
          handicap: 5 + i,
          seed: i + 1,
          status: "confirmed",
        },
      }),
    );
  }

  const a = await prisma.group.create({ data: { eventId, name: "A", position: 0 } });
  const b = await prisma.group.create({ data: { eventId, name: "B", position: 1 } });
  for (const p of players.slice(0, 2)) {
    await prisma.player.update({ where: { id: p.id }, data: { groupId: a.id } });
  }
  for (const p of players.slice(2, 4)) {
    await prisma.player.update({ where: { id: p.id }, data: { groupId: b.id } });
  }

  /**
   * A NAMED pairing, set once the players exist.
   *
   * Not the default "seeds 1 v 2" rule: that resolves out of the STANDINGS, so
   * `createSingleMatch` refuses until somebody has a score — "Waiting on the
   * standings … only 0 players have a score so far". A named pair resolves
   * immediately, which is what lets the adoption test below reach the carrier
   * lookup it is actually about rather than dying on an unrelated precondition.
   */
  await prisma.stage.update({
    where: { id: single.id },
    data: {
      singleMatchRule: JSON.stringify({ kind: "named", a: players[0].id, b: players[1].id }),
    },
  });

  // The carrier, placed exactly as `matchCarrierGroup` places one.
  const maxPos = await prisma.group.aggregate({ where: { eventId }, _max: { position: true } });
  const carrier = await prisma.group.create({
    data: {
      eventId,
      stageId: single.id,
      isCarrier: true,
      name: CARRIER_NAME,
      position: (maxPos._max.position ?? -1) + 1,
    },
  });
  carrierId = carrier.id;
  await prisma.match.create({
    data: {
      eventId,
      stageId: single.id,
      groupId: carrier.id,
      round: 1,
      playerAId: players[0].id,
      playerBId: players[1].id,
      holes: JSON.stringify(new Array(18).fill(null)),
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("regenerating flights over a match carrier", () => {
  it("never renames it, never fills it, never takes it for a flight", async () => {
    await regenerateGroupsAndSchedule(eventId);

    const carrier = await prisma.group.findUnique({ where: { id: carrierId } });
    expect(carrier, "the carrier row still exists").not.toBeNull();
    // The three things the old code did to it, each asserted separately so a
    // failure says WHICH one came back.
    expect(carrier!.name, "renamed into a flight").toBe(CARRIER_NAME);
    expect(carrier!.stageId, "lost its round").toBe(singleStageId);
    expect(
      await prisma.player.count({ where: { groupId: carrierId } }),
      "players moved into a match bucket",
    ).toBe(0);
  });

  it("keeps the round-keyed lookup pointing at the same row across a regenerate", async () => {
    /**
     * WHAT THIS ACTUALLY PROVES, stated honestly because the mutation loop
     * caught it claiming more.
     *
     * Reverting the `stageId: null` filter above leaves this test GREEN. That
     * is not a gap — it is the whole argument for the column. The old fatal
     * consequence of a rename was that the NAME was the key, so a renamed
     * carrier became unfindable and the next generate built a second one,
     * splitting a round's matches across two rows. Keyed on the round instead,
     * a rename cannot do that any more: the row is still found.
     *
     * So the test above is what stops the rename; this one is what makes a
     * rename survivable. Both matter and they fail for different reasons —
     * this one goes red if the lookup key regresses to the name, or if a
     * second carrier is ever created for one round.
     */
    await regenerateGroupsAndSchedule(eventId);

    const byRound = await prisma.group.findMany({ where: { eventId, stageId: singleStageId } });
    expect(byRound, "exactly one carrier for that round, and it is the original").toHaveLength(1);
    expect(byRound[0].id).toBe(carrierId);

    const matches = await prisma.match.findMany({ where: { eventId, stageId: singleStageId } });
    expect(matches, "the play-off's match survived").toHaveLength(1);
    expect(matches[0].groupId, "still filed under its own carrier").toBe(carrierId);
  });

  it("adopts a carrier that predates the column instead of building a second one", async () => {
    /**
     * THE MIGRATION, and the thing most likely to go wrong in production.
     *
     * Every carrier created before `Group.stageId` existed has NULL in it.
     * A lookup by round alone finds nothing, so the obvious version of this
     * change would create a SECOND carrier beside every existing one and split
     * exactly the matches it was written to protect — shipping the bug as the
     * fix. `matchCarrierGroup` falls back to the old name lookup and ADOPTS
     * the row it finds.
     *
     * Simulated the only way it can be: by putting the row back the way the
     * old code left it, NULL round and all, and then calling the real action.
     */
    await prisma.group.update({ where: { id: carrierId }, data: { stageId: null, isCarrier: false } });
    await prisma.match.deleteMany({ where: { eventId, stageId: singleStageId } });

    const res = await createSingleMatch(singleStageId);
    expect(res.ok, `createSingleMatch refused: ${res.error ?? ""}`).toBe(true);

    const carriers = await prisma.group.findMany({ where: { eventId, stageId: singleStageId } });
    expect(carriers, "adopted the existing row rather than adding one").toHaveLength(1);
    expect(carriers[0].id, "and it is the very row that was already there").toBe(carrierId);
    expect(carriers[0].name, "adopting does not rename it either").toBe(CARRIER_NAME);

    const named = await prisma.group.findMany({ where: { eventId, name: CARRIER_NAME } });
    expect(named, "no duplicate under the old name").toHaveLength(1);
  });

  it("still rebuilds the real flights, which is what it is for", async () => {
    /**
     * THE CONTROL. Every assertion above is satisfied by a
     * `regenerateGroupsAndSchedule` that does nothing at all — so without
     * this, deleting the body of that function would pass the whole file.
     */
    await regenerateGroupsAndSchedule(eventId);

    const flights = await prisma.group.findMany({
      where: { eventId, stageId: null },
      orderBy: { position: "asc" },
      select: { name: true, _count: { select: { players: true } } },
    });
    expect(flights.length, "six players at two per flight is three flights").toBe(3);
    for (const f of flights) {
      expect(f._count.players, `flight ${f.name} was filled`).toBeGreaterThan(0);
    }
    expect(
      await prisma.player.count({ where: { eventId, groupId: null } }),
      "nobody left out of the draw",
    ).toBe(0);
  });
});
