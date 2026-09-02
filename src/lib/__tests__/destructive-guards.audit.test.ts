import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { scoredMatchCount, regenerateGroupsAndSchedule } from "../services/regroup";
import { enteredCardCount } from "../services/round-cards";

/**
 * What a destructive organizer action can see before it destroys it.
 *
 * Two faults from the 2026-09-02 exploratory audit, and they compound.
 *
 * `scoredMatchCount` counted Round Robin matches and nothing else, returning 0
 * the moment an event had no Round Robin stage — so for a medal, a knockout, a
 * team event or a bracket the "this will destroy results" confirmation never
 * appeared at all.
 *
 * And `regenerateGroupsAndSchedule` deleted every Group in the event. Because
 * `Match.groupId` is `NOT NULL ON DELETE CASCADE`, that took every match with
 * it — including matches on stages the function had just carefully scoped its
 * own delete away from. A played Single Match Stage final, deleted by pressing
 * "Generate flights".
 *
 * Real rows: both faults are cascades and joins, which a stubbed client agrees
 * with.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DESTRUCT";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A medal event: one stroke round, real cards, and NO Round Robin stage. */
async function medalEvent() {
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-medal-${process.pid}`,
      format: "stroke",
    },
  });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  for (let i = 0; i < 3; i += 1) {
    const p = await prisma.player.create({
      data: { eventId: event.id, name: `${TAG} p${i}`, seed: i + 1, status: "confirmed", handicap: 10 },
    });
    await prisma.scorecard.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        playerId: p.id,
        strokes: JSON.stringify(new Array(18).fill(4)),
      },
    });
  }
  return { event, stage };
}

beforeEach(scrub);

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the guard can see results outside a Round Robin", () => {
  it("counts stroke cards on a medal event", async () => {
    /**
     * The regression. This returned 0, so `applyManualCount` would move players
     * holding certified cards to the waitlist, email them, and re-rank the
     * field without ever asking.
     */
    const { event } = await medalEvent();
    expect(await scoredMatchCount(event.id)).toBe(3);
  });

  it("still reports zero for an event nobody has played", async () => {
    // The other half: a guard that always says "there are results" makes every
    // legitimate setup change require a confirmation nobody reads.
    const org = await prisma.organization.create({ data: { name: `${TAG} empty`, kind: "club" } });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} untouched`,
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-empty-${process.pid}`,
        format: "stroke",
      },
    });
    await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
    });
    expect(await scoredMatchCount(event.id)).toBe(0);
  });

  it("asks about the whole event when no round is named", async () => {
    // The event-wide form is the same union the per-round one already used.
    const { event, stage } = await medalEvent();
    expect(await enteredCardCount(event.id, stage.id)).toBe(3);
    expect(await enteredCardCount(event.id)).toBe(3);
  });
});

describe("regenerating flights does not delete matches it never touched", () => {
  it("leaves a played Single Match Stage final alone", async () => {
    /**
     * The cascade. `regenerateGroupsAndSchedule` scopes its match delete to the
     * Round Robin stages, then used to delete every Group in the event — and
     * `Match.groupId` is NOT NULL ON DELETE CASCADE, so the final went too.
     */
    const org = await prisma.organization.create({ data: { name: `${TAG} club2`, kind: "club" } });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} knockout`,
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-ko-${process.pid}`,
        format: "match",
      },
    });

    const finalStage = await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Single Match Stage", format: "Match Play", holes: 18 },
    });
    const group = await prisma.group.create({
      data: { eventId: event.id, name: `${TAG} flight`, position: 0 },
    });

    const players = [];
    for (let i = 0; i < 3; i += 1) {
      players.push(
        await prisma.player.create({
          data: {
            eventId: event.id,
            name: `${TAG} k${i}`,
            seed: i + 1,
            status: "confirmed",
            handicap: 8,
            groupId: group.id,
          },
        }),
      );
    }

    // A PLAYED final: holes recorded, on a stage that is not Round Robin.
    const played = await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: finalStage.id,
        groupId: group.id,
        round: 1,
        playerAId: players[0].id,
        playerBId: players[1].id,
        holes: JSON.stringify([...new Array(9).fill("A"), ...new Array(9).fill(null)]),
      },
    });

    await regenerateGroupsAndSchedule(event.id);

    const survivor = await prisma.match.findUnique({ where: { id: played.id } });
    expect(survivor, "the played final was deleted by Generate flights").not.toBeNull();
    expect(survivor!.holes).toContain("A");
  });

  it("still rebuilds the flights it is meant to rebuild", async () => {
    // The guard against the guard: refusing to delete anything would make the
    // function stop doing its job.
    const org = await prisma.organization.create({ data: { name: `${TAG} club3`, kind: "club" } });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} rr`,
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-rr-${process.pid}`,
        format: "match",
      },
    });
    await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", holes: 18 },
    });
    for (let i = 0; i < 4; i += 1) {
      await prisma.player.create({
        data: { eventId: event.id, name: `${TAG} r${i}`, seed: i + 1, status: "confirmed", handicap: 12 },
      });
    }

    await regenerateGroupsAndSchedule(event.id);

    const groups = await prisma.group.count({ where: { eventId: event.id } });
    const matches = await prisma.match.count({ where: { eventId: event.id } });
    expect(groups).toBeGreaterThan(0);
    expect(matches).toBeGreaterThan(0);

    /**
     * IDEMPOTENCE is the invariant, not a specific count.
     *
     * An earlier version of this asserted six pairings, on the assumption that
     * four players form one flight. They do not — `auto` splits them into two
     * flights of two — so the assertion encoded a guess about the flight
     * algorithm rather than anything this change is about. Reusing group rows
     * instead of deleting them could plausibly leave stale rows behind or
     * duplicate matches; that is what is worth asserting.
     */
    await regenerateGroupsAndSchedule(event.id);
    expect(await prisma.match.count({ where: { eventId: event.id } })).toBe(matches);
    expect(await prisma.group.count({ where: { eventId: event.id } })).toBe(groups);
  });
});
