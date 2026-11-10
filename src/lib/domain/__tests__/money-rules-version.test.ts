import { describe, it, expect } from "vitest";
import { moneyRulesVersion, moneyRulesFingerprint } from "@/lib/domain/money-rules-version";

/**
 * THIS FILE IS SUPPOSED TO FAIL WHEN YOU CHANGE A MONEY RULE.
 *
 * If you are here because `the recorded generation` failed, nothing is broken.
 * You changed how money is apportioned, netted or settled, and the suite is
 * making you say so out loud. Do this:
 *
 *   1. Satisfy yourself the new behaviour is right, and that the old one was
 *      wrong. A change here means every figure already recorded under the old
 *      rules was computed differently from every figure recorded after it.
 *   2. Put the new token in RECORDED below, and leave the old one in HISTORY
 *      with a line saying what moved. HISTORY is not decoration: it is how
 *      somebody looking at a two-year-old settlement finds out which rules
 *      produced the number the money was handed over against.
 *
 * If you did NOT mean to change a money rule, this test has just caught one.
 */

/**
 * The generation in force.
 *
 * Recorded rather than computed, deliberately: a test that asserts
 * `moneyRulesVersion() === moneyRulesVersion()` passes forever and protects
 * nothing.
 */
const RECORDED = "mq0fwl1";

const HISTORY: Array<{ version: string; note: string }> = [
  // { version: "m…", note: "2026-09-01 — remainder went to the largest share, not the first" },
  {
    version: "ml5h0ae",
    note:
      "2026-11-08 — a side game between UNEVEN sides at a stake that does not divide lost the odd cent " +
      "(2 v 1 at $10.01: +500, +500, -1001); the larger side now shares the total by splitExactly, odd " +
      "cents to the lowest player id (+501, +500, -1001). The fingerprint now runs side games between " +
      "sides, which it never did, so this generation is the first that pins them.",
  },
  {
    version: "mlqxamd",
    note:
      "2026-11-09 — splitExactly compared remainders in floating point, so remainders that were exactly " +
      "equal could be told apart and the odd cent skipped the earlier player its own rule names: a $5 " +
      "skins game of three, skins 1/1/7, paid 167/166/1167 where ties-by-order gives 167/167/1166. " +
      "Remainders are whole numbers now ((total x w) mod sum). The fingerprint adds that split, which " +
      "no earlier generation reached; every other figure in it is unchanged.",
  },
];

describe("the money rules carry a version", () => {
  it("matches the recorded generation", () => {
    expect(
      moneyRulesVersion(),
      [
        "The money rules answer differently than when this was last recorded.",
        "",
        "That means numbers computed from here on will not match numbers already",
        "recorded — including settlements people have paid against. Read the note",
        "at the top of this file before changing RECORDED.",
        "",
        `fingerprint: ${moneyRulesFingerprint()}`,
      ].join("\n"),
    ).toBe(RECORDED);
  });

  it("is stable across calls", () => {
    // A version derived from a Date or an iteration order would drift, and a
    // stamp that drifts is worse than none: it would mark every row as a
    // different generation from every other.
    expect(moneyRulesVersion()).toBe(moneyRulesVersion());
  });

  it("is a short token, not a hash dump", () => {
    // It goes in a database column and gets read by people.
    expect(moneyRulesVersion()).toMatch(/^m[0-9a-z]{1,10}$/);
  });

  it("never reuses a version this project has already retired", () => {
    // Two generations sharing a token would be worse than no token at all —
    // a row would name rules it was not computed under.
    const seen = HISTORY.map((h) => h.version);
    expect(seen).not.toContain(RECORDED);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("exercises every money rule, not just the last one", () => {
    /**
     * The version is only worth having if the fingerprint actually touches the
     * rules. A fingerprint that had quietly stopped covering, say, remainder
     * allocation would keep reporting the same version through a change to it.
     */
    const fp = moneyRulesFingerprint();
    for (const rule of ["share:", "paid:", "net:", "combined:", "transfers:", "split:"]) {
      expect(fp, `the fingerprint no longer covers ${rule}`).toContain(rule);
    }
    // And the awkward cases specifically: a total that cannot divide evenly,
    // and a refund, are the two the fixture exists for.
    expect(fp).toContain("=4001");
    expect(fp, "the fixture no longer produces a negative net").toMatch(/=-\d/);
  });
});
