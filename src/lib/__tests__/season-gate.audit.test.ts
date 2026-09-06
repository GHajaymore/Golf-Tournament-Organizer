import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The season table is a paid feature, and was given away.
 *
 * `upgradeBenefits` has pitched "the season table" as a reason to pay since it
 * was written. The nav carries a "Season standings" item pointing at /series
 * with no plan check on it, `requireScreen("series")` being a ROLE guard. The
 * only thing that ever read the `seasonStandings` flag was `seasonTableFor`,
 * which nothing calls — so the flag was declared, sold, and never consulted by
 * anything reachable.
 *
 * Driven through `seriesTable` rather than the page, because the property that
 * matters is not what the screen draws: services/season.ts states it for its own
 * copy of this check — an unpaid club must not be able to read the numbers out
 * of the RESPONSE either. A page that filters rows it was given is one refactor
 * away from not filtering them.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SEASON-GATE";

const { seriesTable } = await import("@/lib/services/series");

let organizationId = "";
let seriesId = "";

/** Put the club on a plan, or on none at all (which is the free default). */
async function setPlan(plan: string | null) {
  await prisma.subscription.deleteMany({ where: { organizationId } });
  if (plan) {
    await prisma.subscription.create({ data: { organizationId, plan, status: "active" } });
  }
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${TAG} Society` } });
  organizationId = org.id;

  const series = await prisma.series.create({
    data: { organizationId, name: `${TAG} Order of Merit` },
  });
  seriesId = series.id;
});

afterAll(async () => {
  try {
    await prisma.subscription.deleteMany({ where: { organizationId } });
    await prisma.series.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("the season table is withheld from a plan that has not bought it", () => {
  it("returns no standings, and says why, on the free plan", async () => {
    await setPlan(null); // no subscription at all is the free default
    const table = await seriesTable(seriesId);

    expect(table).not.toBeNull();
    expect(table!.allowed, "the free plan does not include the season table").toBe(false);
    expect(table!.standings, "the numbers must not be in the response").toEqual([]);
    expect(table!.events).toEqual([]);
    // And it must say so in words a club can act on, rather than looking empty.
    expect(table!.reason).toMatch(/paid plan/i);
  });

  it("names the season even while withholding the table", async () => {
    /**
     * The lock is on the STANDINGS, not on the club's knowledge that it has a
     * season. An empty screen with no explanation is the failure mode a club
     * cannot act on — they cannot decide to pay for something they cannot see
     * the shape of.
     */
    await setPlan(null);
    const table = await seriesTable(seriesId);
    expect(table!.series.name).toContain(TAG);
  });

  it("allows it on the paid plan — the control", async () => {
    /**
     * Without this the case above passes just as well against a gate that
     * refuses everybody, which is the same silence permanently and would take
     * the feature away from the clubs actually paying for it.
     */
    await setPlan("club");
    const table = await seriesTable(seriesId);

    expect(table!.allowed).toBe(true);
    expect(table!.reason).toBe("");
    // No finished events in this fixture, so the table is legitimately empty —
    // what changed is that it is now COMPUTED rather than withheld.
    expect(Array.isArray(table!.standings)).toBe(true);
  });

  it("is decided by the plan and nothing else", async () => {
    // Same series, same rows, read twice. Only the subscription differs, so a
    // passing result cannot be an accident of the fixture being empty.
    await setPlan(null);
    const locked = await seriesTable(seriesId);
    await setPlan("club");
    const open = await seriesTable(seriesId);

    expect(locked!.allowed).toBe(false);
    expect(open!.allowed).toBe(true);
    expect(locked!.series.id).toBe(open!.series.id);
  });
});
