import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { drainWaitlist, fieldLimitOf } from "../services/waitlist";

/**
 * The field and the waitlist stay in step.
 *
 * G1 and G2 of the 2026-09-02 exploratory audit, which turned out to be one
 * missing thing: nowhere asked "the field has room and people are queuing —
 * should anybody move?"
 *
 * G1. Raising the capacity drained nothing. Eight confirmed, four waiting, open
 * the field to sixteen — and all four stayed put, while the public registration
 * page immediately advertised the new places. The next strangers to open the
 * link were confirmed ahead of the people who had queued first, which is the one
 * thing a waitlist exists to prevent.
 *
 * G2. A withdrawal promoted without looking at the limit, so a field an
 * organizer had just SHRUNK was pushed back over it one departure at a time —
 * and each promoted player was emailed "you're in, your place is held" for a
 * place that did not exist.
 *
 * Real rows: the whole question is a count against a limit that lives in two
 * different columns depending on a mode flag.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WAITLIST";

let eventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** An event with `confirmed` in the field and `waiting` queued behind them. */
async function field(opts: {
  capacity: number;
  confirmed: number;
  waiting: number;
  mode?: string;
  manualCount?: number;
}) {
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
      shareToken: `${TAG}-${process.pid}-${org.id.slice(-6)}`,
      format: "stroke",
      capacity: opts.capacity,
      playerCountMode: opts.mode ?? "registration",
      manualPlayerCount: opts.manualCount ?? 32,
    },
  });
  eventId = event.id;

  let seed = 1;
  for (let i = 0; i < opts.confirmed; i += 1) {
    await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} in${i}`,
        email: `${TAG}.in${i}@example.invalid`.toLowerCase(),
        seed: seed++,
        status: "confirmed",
        handicap: 10,
      },
    });
  }
  /**
   * The waitlist is INSERTED BACKWARDS, on purpose.
   *
   * `wait0` queued first and so carries the lowest seed, but it is written to
   * the database last. Without that, insertion order and seed order coincide,
   * the database returns the right answer by accident, and a test asserting
   * "it took the first two" passes even with the `orderBy` deleted — which is
   * exactly what happened to the first version of this file.
   */
  const waitSeeds = Array.from({ length: opts.waiting }, (_, i) => seed + i);
  seed += opts.waiting;
  for (let i = opts.waiting - 1; i >= 0; i -= 1) {
    await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} wait${i}`,
        email: `${TAG}.wait${i}@example.invalid`.toLowerCase(),
        seed: waitSeeds[i],
        status: "waitlisted",
        handicap: 10,
      },
    });
  }
  return event;
}

const counts = async () => ({
  confirmed: await prisma.player.count({ where: { eventId, status: "confirmed" } }),
  waiting: await prisma.player.count({ where: { eventId, status: "waitlisted" } }),
});

beforeEach(scrub);

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("fieldLimitOf", () => {
  it("reads the capacity in registration mode", () => {
    expect(fieldLimitOf({ playerCountMode: "registration", capacity: 16, manualPlayerCount: 99 })).toBe(16);
  });

  it("reads the MANUAL count once an organizer has set one", () => {
    /**
     * `applyManualCount` writes the mode alongside the number, and from then on
     * `capacity` is a stale registration-era figure. Measuring against it would
     * reopen the very over-filling this is meant to stop.
     */
    expect(fieldLimitOf({ playerCountMode: "manual", capacity: 99, manualPlayerCount: 12 })).toBe(12);
  });

  it("treats zero or less as an open field", () => {
    // 0 is the deliberate "unlimited" sentinel behind the Fixed/Open toggle.
    expect(fieldLimitOf({ playerCountMode: "registration", capacity: 0, manualPlayerCount: 32 })).toBeNull();
    expect(fieldLimitOf({ playerCountMode: "registration", capacity: -1, manualPlayerCount: 32 })).toBeNull();
  });
});

describe("raising the capacity drains the waitlist", () => {
  it("promotes exactly as many as now fit, in the order they queued", async () => {
    // The G1 case from the audit: 8 confirmed, 4 waiting, opened to 16.
    await field({ capacity: 8, confirmed: 8, waiting: 4 });
    await prisma.event.update({ where: { id: eventId }, data: { capacity: 16 } });

    const promoted = await drainWaitlist(eventId);

    expect(promoted).toBe(4);
    expect(await counts()).toEqual({ confirmed: 12, waiting: 0 });
  });

  it("takes only what fits, leaving the rest queued in order", async () => {
    await field({ capacity: 8, confirmed: 8, waiting: 5 });
    await prisma.event.update({ where: { id: eventId }, data: { capacity: 10 } });

    expect(await drainWaitlist(eventId)).toBe(2);
    expect(await counts()).toEqual({ confirmed: 10, waiting: 3 });

    /**
     * And it took the FIRST two — a waitlist that is not a queue is not a
     * waitlist, and letting a later signup in ahead of an earlier one is the
     * unfairness the whole feature exists to prevent.
     *
     * This bites only because the fixture inserts the waitlist backwards, so
     * "the two earliest" and "the two the database happens to return first" are
     * different answers.
     */
    const promotedNames = await prisma.player.findMany({
      where: { eventId, status: "confirmed", promotedAt: { not: null } },
      orderBy: { seed: "asc" },
      select: { name: true },
    });
    expect(promotedNames.map((p) => p.name)).toEqual([`${TAG} wait0`, `${TAG} wait1`]);

    const stillWaiting = await prisma.player.findMany({
      where: { eventId, status: "waitlisted" },
      orderBy: { seed: "asc" },
      select: { name: true },
    });
    expect(stillWaiting.map((p) => p.name)).toEqual([
      `${TAG} wait2`,
      `${TAG} wait3`,
      `${TAG} wait4`,
    ]);
  });

  it("empties the waitlist when the field is opened", async () => {
    // Capacity 0 is "Open", where nobody should ever be waiting.
    await field({ capacity: 8, confirmed: 8, waiting: 4 });
    await prisma.event.update({ where: { id: eventId }, data: { capacity: 0 } });

    expect(await drainWaitlist(eventId)).toBe(4);
    expect(await counts()).toEqual({ confirmed: 12, waiting: 0 });
  });

  it("stamps promotedAt, so an organizer can see who to chase", async () => {
    await field({ capacity: 8, confirmed: 8, waiting: 1 });
    await prisma.event.update({ where: { id: eventId }, data: { capacity: 9 } });
    await drainWaitlist(eventId);

    const promoted = await prisma.player.findFirst({
      where: { eventId, name: `${TAG} wait0` },
      select: { status: true, promotedAt: true },
    });
    expect(promoted?.status).toBe("confirmed");
    expect(promoted?.promotedAt).not.toBeNull();
  });
});

describe("it refuses to push a field over its limit", () => {
  it("promotes nobody when the field is already full", async () => {
    // The guard against the guard, and the G2 case: a field cut from 16 to 12
    // with 16 still confirmed must not take anyone else.
    await field({ capacity: 12, confirmed: 16, waiting: 3 });

    expect(await drainWaitlist(eventId)).toBe(0);
    expect(await counts()).toEqual({ confirmed: 16, waiting: 3 });
  });

  it("promotes nobody when the field is exactly full", async () => {
    await field({ capacity: 12, confirmed: 12, waiting: 3 });
    expect(await drainWaitlist(eventId)).toBe(0);
    expect(await counts()).toEqual({ confirmed: 12, waiting: 3 });
  });

  it("respects a manual field size over a stale capacity", async () => {
    /**
     * The reason the limit is not simply `capacity`. An organizer who set a
     * manual count of 12 on an event whose capacity still reads 32 has a field
     * of twelve, and promoting up to thirty-two would be measuring against a
     * number nothing uses any more.
     */
    await field({ capacity: 32, confirmed: 12, waiting: 4, mode: "manual", manualCount: 12 });
    expect(await drainWaitlist(eventId)).toBe(0);
    expect(await counts()).toEqual({ confirmed: 12, waiting: 4 });
  });

  it("never demotes a confirmed player", async () => {
    /**
     * Deliberately asymmetric. Cutting the capacity with a full field is a
     * decision an organizer makes with the field in front of them; quietly
     * moving people out because a number went down would be a worse surprise
     * than an over-full field they can see.
     */
    await field({ capacity: 4, confirmed: 10, waiting: 0 });
    expect(await drainWaitlist(eventId)).toBe(0);
    expect((await counts()).confirmed).toBe(10);
  });

  it("does nothing at all when nobody is waiting", async () => {
    await field({ capacity: 16, confirmed: 4, waiting: 0 });
    expect(await drainWaitlist(eventId)).toBe(0);
  });
});
