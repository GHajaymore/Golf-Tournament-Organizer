import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The board's cache, stood down for the duration.
 *
 * `liveBoard` wraps its builder in `unstable_cache`, which throws outside a
 * Next request — "Invariant: incrementalCache missing" — so without this the
 * cells below measure nothing but the absence of a server. Replacing it with the
 * identity function runs the REAL builder, which is the code the gate lives
 * in; the caching itself is Next's to test.
 */
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));
import { organizationAllows, entitlementForEvent } from "@/lib/services/entitlements";
import { honoursBoard } from "@/lib/services/honours";
import { liveBoard } from "@/lib/services/live-board";

/**
 * A GATE THAT MOVES WITH THE TIER, PROVED AGAINST REAL ROWS.
 *
 * Ajay, 2026-09-18: "while building please start gating the features we need to
 * provide per tiers. And make it dynamic."
 *
 * The dynamic half is `Subscription.featureOverrides` — one club's exceptions
 * to its tier, as JSON. It exists for grandfathering, for trialling one
 * capability, and for switching something off for a single tenant at three in
 * the morning without a deploy.
 *
 * IT IS ALSO WHAT MAKES ANY OF THIS TESTABLE TODAY. The tiers are not decided,
 * so every new capability is ON for every plan — and a gate that never refuses
 * anybody cannot be told apart from no gate at all. Flipping the override off
 * for one fixture club is how these cells watch the sink actually refuse,
 * months before a ladder says it should.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TIERGATE";

let orgId = "";
let eventId = "";

async function scrub() {
  const orgs = await prisma.organization.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  if (orgs.length) {
    await prisma.event.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  }
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** Whatever this club's exceptions are right now. */
const setOverrides = (json: string) =>
  prisma.subscription.update({ where: { organizationId: orgId }, data: { featureOverrides: json } });

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: {
      name: `${TAG} Heathland Club`,
      kind: "club",
      // A real subscription row, because the override lives ON it — and
      // because a plan check that never runs proves nothing about the rule.
      subscription: { create: { plan: "free", status: "active", provider: "stripe" } },
    },
  });
  orgId = org.id;
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} Club Championship`,
        status: "completed", shape: "series", format: "stroke", formationRule: "balanced",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: `${TAG.toLowerCase()}-share`,
        registrationToken: `${TAG.toLowerCase()}-reg`,
      },
    })
  ).id;

  /**
   * Two champions, so an empty board is a REFUSAL rather than a club with no
   * history — the difference every cell here turns on.
   *
   * Each carries its own `playerId`, because `@@unique([eventId, playerId])`
   * means two entries against one event with no player are the same row. The
   * first version of this fixture wrote both with an empty playerId and the
   * constraint rejected the second, which is the schema being right: one
   * tournament has one champion.
   */
  await prisma.honoursEntry.createMany({
    data: [2024, 2025].map((year) => ({
      organizationId: orgId,
      eventId,
      eventName: `${TAG} Club Championship ${year}`,
      dates: "",
      year,
      playerId: `${TAG.toLowerCase()}-champ-${year}`,
      championName: `${TAG} Champion ${year}`,
      confirmedBy: `${TAG} Secretary`,
      note: "",
    })),
  });
});

beforeEach(async () => {
  await setOverrides("");
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the honours board, gated at the sink", () => {
  it("is on for every tier today, because no ladder has been decided", async () => {
    expect(await organizationAllows(orgId, "honours")).toBe(true);
    const board = await honoursBoard(orgId);
    expect(board.flatMap((y) => y.entries).length, "the club cannot see its own champions").toBe(2);
  });

  it("withholds the NAMES, not just the screen, when it is switched off", async () => {
    await setOverrides('{"honours":false}');

    expect(await organizationAllows(orgId, "honours")).toBe(false);
    const board = await honoursBoard(orgId);
    // The rows are still in the database — nothing has been deleted — and the
    // response carries none of them. A caller trusted to hide what it was
    // handed is a caller that will one day forget to.
    expect(board).toEqual([]);
    expect(await prisma.honoursEntry.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("comes straight back when the exception is lifted", async () => {
    await setOverrides('{"honours":false}');
    expect(await honoursBoard(orgId)).toEqual([]);

    await setOverrides("");
    expect((await honoursBoard(orgId)).flatMap((y) => y.entries).length).toBe(2);
  });
});

describe("the public board, gated where it is built", () => {
  it("is on for every tier today", async () => {
    expect(await organizationAllows(orgId, "publicBoard")).toBe(true);
    // A board for a completed event with no rounds is thin, but it EXISTS —
    // which is the difference this cell and the next one turn on.
    expect(await liveBoard(eventId)).not.toBeNull();
  });

  it("gives back nothing at all when the tier does not include it", async () => {
    /**
     * NULL is the answer on purpose. `/live/[token]` already answers 404
     * identically for a wrong token and for a board the organizer has
     * unpublished — so that switching a link off never confirms the tournament
     * exists — and a tier that excludes the public board lands in exactly that
     * answer rather than inventing a new one that leaks.
     *
     * A SECOND EVENT, so nothing here can be answered by the previous cell's
     * work. The cache is mocked away at the top of this file — it throws
     * outside a Next request — but a fresh event also means the builder runs
     * from nothing, which is the state a real spectator's first request is in.
     */
    const other = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} Autumn Meeting`,
        status: "completed", shape: "series", format: "stroke", formationRule: "balanced",
        dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: `${TAG.toLowerCase()}-share-2`,
        registrationToken: `${TAG.toLowerCase()}-reg-2`,
      },
    });

    await setOverrides('{"publicBoard":false}');
    expect(await organizationAllows(orgId, "publicBoard")).toBe(false);
    expect(await liveBoard(other.id), "the board was built for a club without it").toBeNull();
  });
});

describe("one club's exceptions to its tier", () => {
  it("grants what the tier does not — the grandfathering case", async () => {
    // `whiteLabel` is off on free and on for the paid tier. This club is free.
    expect(await organizationAllows(orgId, "whiteLabel")).toBe(false);
    await setOverrides('{"whiteLabel":true}');
    expect(await organizationAllows(orgId, "whiteLabel")).toBe(true);
  });

  it("reaches the gates that ask per EVENT as well", async () => {
    /**
     * `entitlementForEvent` resolved the plan key and asked the tier alone, so
     * an override would have been honoured by half the app's gates and ignored
     * by the other half — including the three that spend money. A club
     * grandfathered into card reading would have been refused at the one place
     * it mattered.
     */
    expect((await entitlementForEvent(eventId, "cardScan")).allowed).toBe(false);
    await setOverrides('{"cardScan":true}');
    expect(
      (await entitlementForEvent(eventId, "cardScan")).allowed,
      "the per-event gate ignored this club's own exception",
    ).toBe(true);
  });

  it("ignores a typo instead of locking the club out", async () => {
    // The column is hand-edited; that is its purpose. Junk has to degrade to
    // the tier rather than take a club's board away mid-season.
    for (const junk of ["{not json", '{"honours":"yes"}', '{"nonsense":true}', "[]"]) {
      await setOverrides(junk);
      expect(await organizationAllows(orgId, "honours"), `${junk} changed the answer`).toBe(true);
      expect((await honoursBoard(orgId)).flatMap((y) => y.entries).length, junk).toBe(2);
    }
  });
});
