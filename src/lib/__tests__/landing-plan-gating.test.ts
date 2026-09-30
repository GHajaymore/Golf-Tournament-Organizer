import { describe, expect, it } from "vitest";
import { METERED_FEATURES, PLANS, type FeatureKey } from "@/lib/plans";
import { featureGroups, plansWith } from "@/lib/landing/features";

/**
 * THE FRONT DOOR SELLS EXACTLY WHAT THE PLANS GATE.
 *
 * The pricing section's "Compare plans" says everything not in its table is on
 * every plan, Free included. That is only true while every flag that is off on
 * some plan has a feature line naming it. TourneyHQv2 read the code on
 * 2026-09-29: of 69 lines, only the order of merit (seasonStandings) and
 * white-label are gated. A new paid flag must arrive with its line — or this
 * fails, before the page quietly promises it on Free.
 */
describe("the landing's plan gating matches PLANS", () => {
  const lines = [...featureGroups({ localGolf: false }), ...featureGroups({ localGolf: true })].flatMap((g) => g.items);
  const flags = Object.keys(PLANS.free.features) as FeatureKey[];
  const metered = new Set(METERED_FEATURES.map((m) => m.key));

  it("every flag that some plan lacks (and is switched on anywhere) has a feature line", () => {
    for (const flag of flags) {
      if (metered.has(flag)) continue; // built, switched off for everyone: never a feature line
      const onSome = plansWith(flag).length > 0;
      const offSome = plansWith(flag).length < 3;
      if (!(onSome && offSome)) continue;
      expect(lines.some((l) => l.plan === flag), `no feature line is gated on "${flag}"`).toBe(true);
    }
  });

  it("a gated line's plans are derived from PLANS", () => {
    for (const l of lines.filter((x) => x.plan)) {
      const names = plansWith(l.plan!).map((k) => PLANS[k].name);
      for (const n of names) expect(`${l.t} ${l.s ?? ""}`, `"${l.t}" does not name ${n}`).toContain(n);
    }
  });
});
