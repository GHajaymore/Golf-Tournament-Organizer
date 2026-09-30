import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/** The secretary, for the cells that go through `createSeries`. */
const auth = vi.hoisted(() => ({ session: null as null | Record<string, string> }));
vi.mock("@/lib/auth", () => ({ getSession: async () => auth.session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

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
const { createSeries } = await import("@/app/actions/series");
const { SEASON_LOCKED, PLANS } = await import("@/lib/plans");

let organizationId = "";
let seriesId = "";

/** Put the club on a plan, or on none at all (which is the free default). */
async function setPlan(plan: string | null) {
  await prisma.subscription.deleteMany({ where: { organizationId } });
  if (plan) {
    await prisma.subscription.create({ data: { organizationId, plan, status: "active" } });
  }
}

/**
 * BY THE MARK, not by the id this run happens to hold.
 *
 * `Series` and `Subscription` both cascade from `Organization`, so removing
 * the club by its tag removes everything this file makes.
 *
 * The id-only version could clean up only what the CURRENT run created, and
 * ran nowhere but `afterAll` — so a run killed between the create and the
 * teardown left a club behind that nothing would ever collect, and the next
 * run created a second one beside it rather than clearing it. One orphan of
 * exactly that shape was found in the development database on 2026-09-08,
 * from `attestation.audit.test.ts`, empty and indistinguishable at a glance
 * from a real club.
 *
 * Running it in `beforeAll` as well is what makes it SELF-HEALING: the fix
 * collects the previous failure instead of only declining to add to it.
 */
async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();

  const org = await prisma.organization.create({ data: { name: `${TAG} Society` } });
  organizationId = org.id;

  const series = await prisma.series.create({
    data: { organizationId, name: `${TAG} Order of Merit` },
  });
  seriesId = series.id;

  // An open tournament, because the season actions find the club through it.
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} Monthly Medal`,
      dates: "", course: "", city: "", address: "", regDeadline: "",
      shareToken: `${TAG.toLowerCase()}-share`,
    },
  });
  auth.session = { eventId: event.id, role: "admin", viewRole: "admin", email: "zz-season-gate@example.invalid", name: `${TAG} Secretary` };
});

afterAll(async () => {
  try {
    await scrub();
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
    expect(table!.reason).toBe(SEASON_LOCKED);
    expect(SEASON_LOCKED).toContain(`${PLANS.society.name} and above`);
    expect(PLANS.society.features.seasonStandings).toBe(true);
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

  it("refuses to START a season on a plan without the table — and writes nothing", async () => {
    // "Start a season" was offered to Par clubs, and the lock appeared only
    // once a season existed to be locked (walked 2026-09-29).
    await setPlan(null);
    const before = await prisma.series.count({ where: { organizationId } });
    const r = await createSeries(`${TAG} Winter League`);
    expect(r.ok).toBe(false);
    expect(r.error).toBe(SEASON_LOCKED);
    expect(await prisma.series.count({ where: { organizationId } })).toBe(before);
  });

  it("CONTROL: starts one on a plan with the table", async () => {
    await setPlan("society");
    const r = await createSeries(`${TAG} Summer Series`);
    expect(r.ok).toBe(true);
    expect(await prisma.series.count({ where: { organizationId, name: `${TAG} Summer Series` } })).toBe(1);
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
