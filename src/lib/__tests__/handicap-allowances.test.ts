import { describe, it, expect } from "vitest";
import { GOLF_FORMATS, findFormat } from "@/lib/formats";
import { sidePlayingHandicap } from "@/lib/services/teams";

/**
 * THE PUBLISHED HANDICAP ALLOWANCES, ASSERTED AS VALUES.
 *
 * `matrix.test.ts` already runs every format against every stage type, 60
 * cells of green. What it asserts about a format's handicap allowance is
 * nothing: it checks `min >= 1`, `max >= min`, and that `entryModeFor` returns
 * one of three strings. A format carrying the wrong allowance passes every
 * cell — which is what happened.
 *
 * Chapman / Pinehurst was `allowance: 50` flat, the figure from the pre-WHS
 * USGA Handicap System, and additionally marked `allowanceIsConvention` — so
 * the app told an organizer there was no published standard for a format that
 * has one. Found 2026-09-14 by reading the table against the USGA's own, not
 * by any test.
 *
 * So this file asserts the NUMBERS, against the published recommendations,
 * with the format named. CLAUDE.md's rule for this suite is "assert against
 * the Rules of Golf, not against current behaviour, and put the citation in
 * the comment" — a test that reads the allowance out of the same table it is
 * checking would pass on any value at all.
 *
 * SOURCE: USGA Rules of Handicapping, Appendix C (Handicap Allowances), and
 * the USGA committee guidance on formats of play. Checked 2026-09-14.
 *
 * A committee may always set its own — every allowance in this app is a
 * default an organizer can override, and `sidePlayingHandicap` honours the
 * override ahead of anything here. What this pins is the DEFAULT the app
 * recommends when nobody has said otherwise.
 */

/**
 * Flat percentages: the allowance applies to a single handicap, or to the
 * combined handicaps of the side, with no per-player split.
 */
const FLAT: Array<[string, number, string]> = [
  // Singles match play is 100% of the DIFFERENCE between the two players.
  // The 100 here is the per-player figure the difference is taken from.
  ["Match Play", 100, "singles match play — 100%"],
  ["Stroke Play", 95, "individual stroke play — 95%"],
  ["Stableford", 95, "Stableford is grouped with individual stroke play — 95%"],
  ["Modified Stableford", 95, "Modified Stableford follows individual stroke play — 95%"],
  // Four-ball MATCH play, which is what this app calls Four-Ball.
  ["Four-Ball", 90, "four-ball match play — 90%"],
  // Four-ball STROKE play, which this app calls Best Ball.
  ["Best Ball", 85, "four-ball stroke play — 85%"],
  // Players play their own ball after the drive, so the four-ball allowance
  // applies rather than a scramble-style descending split.
  ["Shamble", 85, "shamble, played as four-ball after the tee shot — 85%"],
  ["Foursomes", 50, "foursomes — 50% of the combined handicaps"],
  ["Alternate Shot", 50, "alternate shot is foursomes — 50% of the combined"],
];

/**
 * Formats whose allowance is a SHAPE rather than a number: a per-player split,
 * best player first. A flat percentage cannot express these, and applying one
 * instead is the defect this file was written for.
 */
const SPLIT: Array<[string, number, number[], string]> = [
  ["Greensomes", 2, [60, 40], "greensomes — 60% of the lower plus 40% of the higher"],
  [
    "Chapman / Pinehurst",
    2,
    [60, 40],
    "Chapman/Pinehurst — 60% of the lower plus 40% of the higher, NOT foursomes' flat 50%",
  ],
];

describe("the handicap allowance each format recommends", () => {
  it.each(FLAT)("%s is %i%% — %s", (format, expected) => {
    expect(findFormat(format).allowance).toBe(expected);
  });

  it.each(SPLIT)("%s on a side of %i splits %j — %s", (format, size, weights) => {
    expect(
      findFormat(format).weightsBySideSize?.[size],
      "this format is governed by a per-player split, not a flat percentage",
    ).toEqual(weights);
  });
});

/**
 * AND THE SPLIT IS WHAT ACTUALLY GETS APPLIED.
 *
 * The table above is a declaration; this is the arithmetic. They are separate
 * assertions because the bug could live in either — a correct `[60, 40]` that
 * `sidePlayingHandicap` never reads would be just as wrong on the card, and
 * the declaration alone cannot tell you it is being used.
 */
describe("what a side actually plays off", () => {
  /**
   * WORKED FROM THE RULE, NOT FROM THE CODE.
   *
   * Every expected value below is computed by hand in the comment so that a
   * change to the engine cannot quietly redefine what is correct. These are
   * the exact pairs from the Chapman note in `formats.ts`.
   */
  const cases: Array<[string, number[], number, string]> = [
    // 10 x 0.6 = 6, 20 x 0.4 = 8 -> 14. A flat 50% of 30 would give 15.
    ["Chapman / Pinehurst", [10, 20], 14, "one shot fewer than the old flat 50%"],
    // 5 x 0.6 = 3, 25 x 0.4 = 10 -> 13. A flat 50% of 30 would give 15.
    ["Chapman / Pinehurst", [5, 25], 13, "two shots fewer — the gap grows with the mismatch"],
    // 15 x 0.6 = 9, 15 x 0.4 = 6 -> 15, which a flat 50% of 30 also gives.
    // THE CONTROL: the two schemes agree on an even pair, so a fixture built
    // only from equal handicaps could not have caught this at all.
    ["Chapman / Pinehurst", [15, 15], 15, "an even pair, where both schemes agree"],
    // Greensomes shares the shape and is the format Chapman was measured
    // against; same arithmetic, and it was already right.
    ["Greensomes", [10, 20], 14, "greensomes, unchanged"],
    // 50% of the combined 30. Foursomes really is flat, so this is the
    // control in the other direction: proof the split is not being applied
    // to every shared-ball format indiscriminately.
    ["Foursomes", [10, 20], 15, "foursomes stays flat — 50% of the combined"],
  ];

  it.each(cases)("%s off %j plays to %i (%s)", (format, handicaps, expected) => {
    expect(sidePlayingHandicap(handicaps, format)).toBe(expected);
  });

  it("orders the split best player first, whichever order they arrive in", () => {
    /**
     * 60% goes to the LOWER handicap. If the split were applied positionally
     * without sorting, a side entered high-first would get 20 x 0.6 + 10 x 0.4
     * = 16 instead of 14 — two shots, silently, depending on data entry order.
     */
    expect(sidePlayingHandicap([20, 10], "Chapman / Pinehurst")).toBe(14);
    expect(sidePlayingHandicap([10, 20], "Chapman / Pinehurst")).toBe(14);
  });
});

/**
 * AND THE APP ONLY CLAIMS "NO PUBLISHED STANDARD" WHERE THERE ISN'T ONE.
 *
 * `allowanceIsConvention` drives a sentence on the round screen: "the common
 * club convention for this format, not a published standard." Said about a
 * format the USGA publishes an allowance for, that is the app telling an
 * organizer something untrue about the Rules — and it is the half of the
 * Chapman defect that no arithmetic test would have caught.
 */
describe("which formats admit to having no published allowance", () => {
  const convention = GOLF_FORMATS.filter((f) => f.allowanceIsConvention).map((f) => f.name);

  it("is the three formats Appendix C does not name", () => {
    /**
     * Scramble and Texas Scramble genuinely have no published WHS allowance —
     * the descending tables in this app are the widespread club convention,
     * and saying so is the honest thing.
     *
     * SHAMBLE IS A WEAKER CASE and is listed here deliberately rather than
     * tidily. Appendix C does not name a shamble either, so "not a published
     * standard" is literally true; the 85% it carries is the four-ball stroke
     * play allowance, applied because players play their own ball once the
     * drive is chosen. That reasoning is sound and widely followed, but it is
     * an inference from a neighbouring line of the table rather than a line of
     * its own — which is the distinction `allowanceIsConvention` exists to
     * make, so leaving it set is the honest side to err on.
     *
     * Every other playable format in the catalogue IS named in Appendix C,
     * which is the half this test exists to hold.
     */
    expect(convention.sort()).toEqual(["Scramble", "Shamble", "Texas Scramble"]);
  });

  it("does not say it about Chapman, which the USGA publishes", () => {
    // Named separately from the list above so the failure says which format
    // and why, rather than printing a diff of four strings.
    expect(
      findFormat("Chapman / Pinehurst").allowanceIsConvention ?? false,
      "the USGA publishes 60/40 for Chapman — calling it a club convention is untrue",
    ).toBe(false);
  });
});
