import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { withEventIntakeLock } from "@/lib/services/intake-lock";

/**
 * THE LOCK ITSELF, PROVEN DETERMINISTICALLY.
 *
 * `intake-capacity-race.audit.test.ts` fires two real registrations at one link
 * and asserts the end-to-end invariant — one confirmed, one waitlisted. It is a
 * true integration check, but it cannot be relied on to FAIL when the lock is
 * removed: whether the two callers' critical sections actually overlap is a
 * matter of scheduling, and on a fast machine one can finish before the other
 * begins, so the race need not surface in a given run. A guard whose failure
 * depends on timing is not a guard.
 *
 * This proves the mechanism directly and without a race. One caller enters the
 * lock and is held there by an unresolved promise — its transaction, and so its
 * advisory lock, stays open — while a second caller for the SAME event is
 * started. The second must not enter until the first is released; the ORDER is
 * then pinned exactly. Remove the `pg_advisory_xact_lock` from `intake-lock.ts`
 * and the second enters immediately, and the first assertion goes red.
 *
 * The second test is the control: two callers for DIFFERENT events must proceed
 * at once. It fails if the lock key is ever made global rather than per event
 * (e.g. a constant in place of `hashtext(eventId)`), which would serialise the
 * whole app's intake behind one mutex — correct on the cap, catastrophic for
 * throughput.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const key = () => `zz-lock-${randomBytes(6).toString("hex")}`;
/** Long enough that a second caller which COULD enter certainly would, short
 *  enough to stay well inside Prisma's interactive-transaction timeout (5s). */
const BEAT = 300;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(async () => {
  await prisma.$disconnect();
});

describe("withEventIntakeLock", () => {
  it("holds a second caller for the same event until the first is done", async () => {
    const event = key();
    const order: string[] = [];

    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((r) => (releaseFirst = r));
    let firstIsInside!: () => void;
    const firstHoldsIt = new Promise<void>((r) => (firstIsInside = r));

    const first = withEventIntakeLock(event, async () => {
      order.push("first-in");
      firstIsInside(); // the lock is now held
      await firstMayFinish; // keep the transaction — and the lock — open
      order.push("first-out");
    });

    await firstHoldsIt;

    let secondEntered = false;
    const second = withEventIntakeLock(event, async () => {
      secondEntered = true;
      order.push("second-in");
    });

    // The first still holds the lock. Given a clear window, a second caller that
    // was NOT blocked would have entered by now.
    await wait(BEAT);
    expect(secondEntered, "the second caller entered while the first held the lock").toBe(false);

    releaseFirst();
    await Promise.all([first, second]);

    // Serialised, and in order: the whole of the first, then the second.
    expect(order).toEqual(["first-in", "first-out", "second-in"]);
  });

  it("lets two different events run at once", async () => {
    const eventA = key();
    const eventB = key();

    let releaseA!: () => void;
    const aMayFinish = new Promise<void>((r) => (releaseA = r));
    let aIsInside!: () => void;
    const aHoldsIt = new Promise<void>((r) => (aIsInside = r));

    const a = withEventIntakeLock(eventA, async () => {
      aIsInside();
      await aMayFinish;
    });

    await aHoldsIt;

    let bEntered = false;
    const b = withEventIntakeLock(eventB, async () => {
      bEntered = true;
    });

    // A holds A's lock. B is a different event, so it must NOT be waiting on it.
    await wait(BEAT);
    expect(bEntered, "a different event was made to wait — the lock is not per event").toBe(true);

    releaseA();
    await Promise.all([a, b]);
  });
});
