import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PLANS,
  planFor,
  hasFeature,
  upgradeBenefits,
  METERED_FEATURES,
} from "@/lib/plans";

/**
 * The features that cost money every time somebody uses them.
 *
 * Texting, card reading and drafting are built and working; they are switched
 * off because each carries a carrier or model charge per use and there is no
 * revenue yet to cover it. That makes them a different kind of thing from the
 * rest of the plan, where one more club costs essentially nothing to serve —
 * and it makes "is this actually gated" a question worth a test rather than a
 * comment, because the failure mode is a bill rather than a broken screen.
 */

describe("nothing metered is on by default", () => {
  it("is off on the free plan", () => {
    for (const f of METERED_FEATURES) {
      expect(hasFeature("free", f.key), `${f.key} must not be free`).toBe(false);
    }
  });

  it("is off on the paid plan too, for now", () => {
    // Deliberate and worth pinning: these are switched off by COST, not by
    // tier. Turning them on for paying clubs is a decision to start paying
    // carrier and model bills, and it should be made on purpose — this test
    // failing is the reminder that the decision is being made.
    for (const f of METERED_FEATURES) {
      expect(hasFeature("club", f.key), `${f.key} — turning this on starts a real bill`).toBe(false);
    }
  });

  it("fails closed for an unknown plan", () => {
    // A bad or missing subscription row must not hand somebody the expensive
    // features. planFor falls back to free; this proves the fallback covers
    // the metered set and not just the limits.
    for (const f of METERED_FEATURES) {
      expect(hasFeature("enterprise-typo", f.key)).toBe(false);
      expect(hasFeature(null, f.key)).toBe(false);
      expect(hasFeature(undefined, f.key)).toBe(false);
    }
  });

  it("keeps the free plan's non-metered promises intact", () => {
    // The gating must not have quietly taken away what the free tier already
    // offered — every plan still has its limits and retention.
    expect(planFor("free").limits.playersPerEvent).toBeNull();
    expect(planFor("free").retentionHours).toBe(48);
    expect(planFor("club").retentionHours).toBeNull();
  });
});

describe("the upgrade pitch", () => {
  it("lists every metered feature as coming", () => {
    // The promise and the switch move together: a feature that is off has to
    // appear in the benefits, and it has to be honest that it isn't live yet.
    const benefits = upgradeBenefits("free").join(" ");
    for (const f of METERED_FEATURES) {
      expect(benefits, `${f.key} missing from the upgrade benefits`).toContain(f.benefit);
    }
    expect(benefits).toContain("coming with the paid plan");
  });

  it("leads with what a free club actually loses today", () => {
    // Retention first: losing the member-guest results is the concrete harm,
    // where the metered features are things they've never had.
    expect(upgradeBenefits("free")[0]).toMatch(/permanently|48 hours/i);
  });

  it("never offers a paid club something it already has", () => {
    const benefits = upgradeBenefits("club").join(" ");
    expect(benefits).not.toMatch(/branding/i);
    expect(benefits).not.toMatch(/as many tournaments/i);
    // But the metered ones are still listed — a paying club hasn't got them.
    expect(benefits).toContain("coming with the paid plan");
  });

  it("says nothing at all once everything is on", () => {
    // The state after the flags flip. If this starts failing, the benefits
    // list is offering something that is already included.
    const everything = {
      ...PLANS.club,
      features: { whiteLabel: true, sms: true, cardScan: true, aiAssist: true },
    };
    const listed = METERED_FEATURES.filter((f) => !everything.features[f.key]);
    expect(listed).toEqual([]);
  });
});

describe("every metered feature is actually gated", () => {
  /**
   * A source guard, because the cost of missing one is a bill rather than a
   * visible bug: an ungated call still works perfectly, just at somebody's
   * expense. Each metered feature has to be checked in the code that spends
   * the money, not only in the screen that offers it.
   */
  const SPENDERS: { file: string; feature: string }[] = [
    { file: join("app", "actions", "card-photo.ts"), feature: "cardScan" },
    { file: join("app", "actions", "commentary.ts"), feature: "aiAssist" },
    { file: join("app", "actions", "draft-message.ts"), feature: "aiAssist" },
    { file: join("app", "actions", "setup-suggest.ts"), feature: "aiAssist" },
    { file: join("lib", "services", "messaging.ts"), feature: "sms" },
  ];

  for (const { file, feature } of SPENDERS) {
    it(`${file} checks "${feature}" before spending`, () => {
      // Matched per line rather than with a nested-paren regex: the call is
      // sometimes `hasFeature(await planForOrganization(id), "sms")`, and the
      // inner `)` defeats any [^)]* pattern.
      const lines = readFileSync(join(process.cwd(), "src", file), "utf8").split("\n");
      const gated = lines.some(
        (l) => /entitlementForEvent|hasFeature/.test(l) && l.includes(`"${feature}"`),
      );
      expect(gated, `${file} must gate on ${feature}`).toBe(true);
    });
  }

  it("routes the refusal wording through METERED_FEATURES", () => {
    // So the words at the locked door and the words on the upgrade page are
    // the same string, and updating one updates both.
    const ent = readFileSync(
      join(process.cwd(), "src", "lib", "services", "entitlements.ts"),
      "utf8",
    );
    expect(ent).toMatch(/METERED_FEATURES/);
  });

  it("has no AI or SMS spender this list has not been told about", () => {
    // The real guard: a new metered call must be added here, which forces the
    // question of what gates it.
    const known = new Set(SPENDERS.map((s) => s.file));
    const dir = join(process.cwd(), "src", "app", "actions");
    const spenders = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /api\.anthropic\.com|sendSms\(/.test(readFileSync(join(dir, f), "utf8")))
      .map((f) => join("app", "actions", f))
      .filter((f) => !known.has(f));
    expect(spenders, "gate it and add it to SPENDERS").toEqual([]);
  });
});
