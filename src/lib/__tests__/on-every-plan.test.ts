import { describe, it, expect } from "vitest";
import { PLANS, onEveryPlan, type Plan, type PlanKey } from "@/lib/plans";
import { readSource } from "./source";

/**
 * "ON EVERY PLAN" IS READ FROM THE PLANS, NEVER TYPED (2026-10-24).
 *
 * The front door lists what every plan includes. A line there is a promise about all four tiers,
 * so it is worked out from `PLANS` (`onEveryPlan`): a feature every tier has, or a term every tier
 * carries (`Plan.includes`). Three things held here:
 *
 *   1. the list is exactly what every plan has, and a tier going without one takes it off;
 *   2. every term in `includes` is TRUE on every plan — they are terms, not gates, so a `false`
 *      would be a tier "without" something nothing actually withholds (build the gate first);
 *   3. the page prints the list from `onEveryPlan()` and types none of its lines itself.
 */

describe("on every plan", () => {
  it("lists what every plan has: the live board, and the six terms", () => {
    expect(onEveryPlan().map((i) => i.key)).toEqual(["publicBoard", "everyFormat", "roundCodes", "offlineCards", "voiceScoring", "sideGames", "playersPayNothing"]);
    for (const item of onEveryPlan()) {
      for (const plan of Object.values(PLANS)) {
        const has = item.key in plan.features ? plan.features[item.key as keyof Plan["features"]] : plan.includes[item.key as keyof Plan["includes"]];
        expect(has, `${item.label} is listed on every plan and ${plan.name} lacks it`).toBe(true);
      }
    }
  });

  it("takes a line off the moment one tier goes without it", () => {
    const without = structuredClone(PLANS) as Record<PlanKey, Plan>;
    without.free.includes.voiceScoring = false;
    without.club.features.publicBoard = false;
    const keys = onEveryPlan(without).map((i) => i.key);
    expect(keys).not.toContain("voiceScoring");
    expect(keys).not.toContain("publicBoard");
    // CONTROL: the rest stay.
    expect(keys).toContain("roundCodes");
  });

  it("holds every term true on every plan: a term nothing gates cannot be withheld", () => {
    for (const plan of Object.values(PLANS)) {
      for (const [key, value] of Object.entries(plan.includes)) expect(value, `${plan.name}.includes.${key}`).toBe(true);
    }
  });

  it("is printed from onEveryPlan() on the front door, with none of its lines typed there", () => {
    const page = readSource("src/app/page.tsx");
    expect(page).toContain("onEveryPlan()");
    for (const item of onEveryPlan()) expect(page, `“${item.label}” is typed on the page`).not.toContain(item.label);
  });
});
