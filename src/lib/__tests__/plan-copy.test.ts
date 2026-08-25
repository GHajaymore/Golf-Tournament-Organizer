import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PLANS, upgradeBenefits, retentionNotice, METERED_FEATURES, type FeatureKey } from "@/lib/plans";

/**
 * What a club gets for its money has to be SAID somewhere.
 *
 * The pricing model has always been complete in code and invisible on screen:
 * no route mentioned PLANS, the landing page said "Start free" twice and
 * priced nothing, and `upgradeBenefits` — the function whose entire job is to
 * list what upgrading buys — was called by nothing at all. Written, correct,
 * and read by nobody.
 *
 * The failure mode is quiet in the direction that costs a club real work:
 * free keeps results 48 HOURS, and today they can only discover that after
 * the results are gone.
 *
 * So these are guards rather than notes. A feature added to the paid tier
 * without appearing in the pitch, or a pitch nothing renders, fails here.
 */

/** Every .tsx under src, so "is it rendered" is asked of the whole app. */
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      tsxFiles(full, out);
    } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const appSource = tsxFiles(join(process.cwd(), "src"))
  .filter((f) => !f.includes("__tests__") && !f.endsWith(join("lib", "plans.ts")))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("what a club gets for its money is actually said", () => {
  it("every paid-tier feature is named in the upgrade pitch", () => {
    const free = PLANS.free.features;
    const paid = PLANS.club.features;
    const pitch = upgradeBenefits("free").join(" ").toLowerCase();

    // A feature the paid tier has and free does not IS the reason to pay.
    // Adding one and not saying so leaves a club paying for something it was
    // never told about — which is also how a feature goes unused.
    const paidOnly = (Object.keys(paid) as FeatureKey[]).filter((k) => paid[k] && !free[k]);
    expect(paidOnly.length, "no paid-only features at all — check the plans").toBeGreaterThan(0);

    for (const key of paidOnly) {
      // Matched on the words a human would use, because the pitch is prose
      // and must never be the flag name in a sentence.
      const words: Record<string, RegExp> = {
        whiteLabel: /branding/i,
        seasonStandings: /season table/i,
      };
      const pattern = words[key];
      expect(
        pattern,
        `${key} is a paid-only feature with no phrase to look for. Add one here and a line to upgradeBenefits — a club cannot buy what nobody mentions.`,
      ).toBeTruthy();
      if (!pattern) continue;
      expect(pattern.test(pitch), `${key} is paid-only but the upgrade pitch never mentions it`).toBe(true);
    }
  });

  it("the metered features are pitched as coming, not as included", () => {
    const pitch = upgradeBenefits("free").join(" ");
    for (const f of METERED_FEATURES) {
      // They are dark on BOTH tiers today. Promising them as available would
      // be a lie a club would notice on the first bill, so each is pitched by
      // what it DOES and marked as not here yet.
      if (PLANS.club.features[f.key]) continue;
      expect(pitch.toLowerCase()).toContain(f.benefit.slice(0, 40).toLowerCase());
      expect(pitch).toContain("coming with the paid plan");
    }
  });

  it("says how long free keeps anything, in hours a person can act on", () => {
    const notice = retentionNotice("free");
    expect(notice, "free must state its retention").toBeTruthy();
    expect(notice).toMatch(/48 hours/);
    // And the paid tier must not claim a limit it does not have.
    expect(retentionNotice("club")).toBeNull();
  });

  it("the upgrade pitch reaches a screen", () => {
    /**
     * `upgradeBenefits` was written and called by NOTHING. A list of reasons
     * to pay that no screen renders is the same as no list — the identical
     * fault the settings-help guard was written for, one module along.
     */
    expect(
      appSource.includes("upgradeBenefits"),
      "upgradeBenefits is written but no screen calls it, so no club ever reads what upgrading buys",
    ).toBe(true);
  });

  it("the price is on a screen, not only in the model", () => {
    // A club cannot decide on a number it is never shown.
    expect(
      /priceMonthly/.test(appSource),
      "no screen renders priceMonthly — the app knows what it charges and never says so",
    ).toBe(true);
  });
});
