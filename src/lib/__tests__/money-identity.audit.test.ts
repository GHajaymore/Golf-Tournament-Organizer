import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * An empty address identifies nobody, and must never identify the first player
 * who also has none.
 *
 * Both money readers matched the signed-in player with `p.email === email`. On
 * an event where several entries have no address that comparison is `"" ===
 * ""`, so it returned whoever happened to be first — and reported THEIR money
 * as the caller's own.
 *
 * Measured on 2026-09-08 against a three-player casual round with a birdie
 * pot. Asked for each player in turn, `roundMoneyFor` answered with the first
 * one's id and the first one's +£3.75 all three times. The pot was right to the
 * penny — +375, -75, -300, summing to zero — and the "yours" figure sitting on
 * top of it named the wrong person twice out of three.
 *
 * It matters NOW because casual rounds create emailless players on purpose: a
 * guest is somebody's mate playing once, who needs no account and is
 * deliberately not put in the club's roster. A column that used to hold a few
 * blanks now fills with them by design.
 *
 * The rule already existed six lines above the first caller — `byEmail` filters
 * `(p) => p.email` before keying a map on it. One lookup had it; the lookup
 * beneath it did not.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MONEY-ID";

const { roundMoneyFor } = await import("@/lib/services/expenses");

let eventId = "";
let named: { id: string; email: string } | null = null;

async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club` },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} round`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `zz-id-${Math.random().toString(36).slice(2)}`,
      status: "live",
      shape: "match",
    },
    select: { id: true },
  });
  eventId = event.id;

  // Two guests with no address — the shape a casual round creates — and one
  // player who does have one, so the working case is asserted beside the
  // broken one rather than assumed.
  for (const [i, [name, email]] of [
    [`${TAG} first guest`, ""],
    [`${TAG} second guest`, ""],
    [`${TAG} member`, `${TAG.toLowerCase()}-member@example.invalid`],
  ].entries()) {
    const row = await prisma.player.create({
      data: {
        eventId,
        name,
        email,
        handicap: 0,
        seed: i + 1,
        status: "confirmed",
      },
      select: { id: true, email: true },
    });
    if (email) named = row;
  }
});

afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("who the money screen thinks you are", () => {
  it("names nobody when the address is empty", async () => {
    /**
     * THE DEFECT. Before this, an empty address matched the first guest and
     * the caller was told that guest's money was theirs.
     *
     * Asserted as "" rather than "not the first guest", because the honest
     * answer to "which entry is this address?" when there is no address is
     * none — and a reader that returns SOME id has to be trusted to have
     * returned the right one.
     */
    const view = await roundMoneyFor(eventId, "");
    expect(view.playerId, "an empty address is nobody").toBe("");
    expect(view.yourTotalCents, "and nobody is owed anything").toBe(0);
  });

  it("names nobody for whitespace, which is the same thing typed differently", async () => {
    const view = await roundMoneyFor(eventId, "   ");
    expect(view.playerId).toBe("");
  });

  it("still finds the player who does have an address", async () => {
    /**
     * THE ASSERTION THAT STOPS THE FIX BECOMING "NEVER MATCH ANYBODY".
     *
     * Refusing every lookup would pass both tests above and quietly break the
     * money screen for every real player in the app. The two answers must
     * differ.
     */
    const view = await roundMoneyFor(eventId, named!.email);
    expect(view.playerId, "a real address still resolves").toBe(named!.id);
    expect(view.playerId).not.toBe("");
  });

  it("matches an address however it was typed", async () => {
    // Case and surrounding space are how somebody's keyboard behaved, not who
    // they are. This was already true and stays true.
    const view = await roundMoneyFor(eventId, `  ${named!.email.toUpperCase()}  `);
    expect(view.playerId).toBe(named!.id);
  });
});
