import { describe, it, expect } from "vitest";
import { NAV, allNavItems, routesForTier, type NavTier } from "../nav";
import { readSource } from "./source";

/**
 * WHERE a screen is used, encoded on the nav item rather than in a list
 * somewhere.
 *
 * The tier decides whether a screen is held to the 44px touch minimum. It must
 * NOT decide whether a screen is measured at all — that distinction is the
 * whole design, and it is the one a future change is most likely to erode,
 * because "only sweep the phone routes on the phone" sounds like an
 * optimisation right up until eight routes lose their only assertion. That has
 * already happened here once: `layout.spec` used a hand-written list, it
 * covered 14 of 22 routes, and nothing reported the gap.
 */

const TIERS: NavTier[] = ["on-course", "at-desk"];

describe("every screen declares where it is used", () => {
  it("has a tier on every nav item", () => {
    const untiered = allNavItems().filter((i) => !TIERS.includes(i.tier));
    expect(
      untiered.map((i) => i.key),
      "a nav item without a valid tier would be graded by whichever branch it fell into",
    ).toEqual([]);
  });

  it("puts every item in exactly one tier, and loses none", () => {
    const total = allNavItems().length;
    const split = TIERS.flatMap((t) => routesForTier(t));
    expect(split.length).toBe(total);
    expect(new Set(split).size, "two nav items share an href").toBe(total);
  });

  it("has both tiers actually populated", () => {
    // A tier with nothing in it makes every assertion about it vacuous — the
    // touch sweep would pass by sweeping nothing, which is the failure mode
    // this whole file exists to prevent.
    for (const tier of TIERS) {
      expect(routesForTier(tier).length, `the "${tier}" tier is empty`).toBeGreaterThan(0);
    }
  });
});

/**
 * The screens the handoff named, asserted rather than described.
 *
 * "Score entry, Tee sheet, Live leaderboard, Announcements, Messages" plus the
 * player's own screens. These are pinned because the tier is a PRODUCT
 * decision, not an implementation detail: moving Score entry to `at-desk`
 * should be an argument somebody has to win, not a one-word edit that goes
 * through review unnoticed.
 */
describe("the on-course tier holds the screens worked outdoors", () => {
  const onCourse = new Set(routesForTier("on-course"));

  for (const href of ["/entry", "/foursomes", "/leaderboard", "/announcements", "/messages", "/me"]) {
    it(`${href} is on-course`, () => {
      expect(onCourse.has(href), `${href} is worked standing on a golf course`).toBe(true);
    });
  }

  /**
   * The console's own home is the counter-example, and it is what stops the
   * tier collapsing into "everything is on-course" — which would pass every
   * assertion above while deleting the distinction. `touch.spec` measures
   * /dashboard for DENSITY: an organizer spends hours in it and 44px controls
   * would be a real cost. If this ever flips, that test starts asserting the
   * opposite of what it is named for.
   */
  it("keeps the console's desk screens at-desk", () => {
    for (const href of ["/dashboard", "/registration", "/stages", "/reports"]) {
      expect(onCourse.has(href), `${href} is worked sitting down`).toBe(false);
    }
  });
});

/**
 * THE INVARIANT THE TIER MUST NEVER BREAK.
 *
 * `layout.spec.ts` derives its routes from the filesystem. If somebody ever
 * "optimises" it to sweep only the on-course tier, the at-desk screens lose
 * every layout assertion they have — on every viewport — and nothing goes red,
 * because a suite that measures fewer things still passes.
 *
 * Read through `readSource`, so the prose above the sweep cannot satisfy this:
 * that comment names both `NAV` and the tier while explaining why neither is
 * used, which is exactly the shape that turns a source assertion green for the
 * wrong reason.
 */
describe("the layout sweep still walks the filesystem", () => {
  const SPEC = readSource("e2e/layout.spec.ts");

  it("does not take its routes from the nav or the tier", () => {
    expect(SPEC, "layout.spec derives routes from NAV; the hand-list problem is back").not.toMatch(
      /\bNAV\b|routesForTier|allNavItems/,
    );
  });

  it("still reads the app directory", () => {
    expect(SPEC).toMatch(/readdir|readdirSync/);
  });
});

describe("the nav sections still make sense", () => {
  it("has no empty section", () => {
    for (const section of NAV) {
      expect(section.items.length, `section "${section.label}" is empty`).toBeGreaterThan(0);
    }
  });
});
