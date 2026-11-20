import { describe, it, expect } from "vitest";
import { fieldEnteringRound, cutLineIndex, type RoundCutFields } from "../cut";
import { endsWithin } from "../../__tests__/ends-within";

/**
 * The loops of `cut.ts` END (2026-11-09). `fieldEnteringRound` counts rounds up from 1 to the asked
 * index; a broken step (`r -= 1`) never reaches either bound, and an assertion cannot fail a loop
 * that does not end. Under Stryker that mutant ends as a plain timeout, which the ratchet counts as
 * NOT caught (`scripts/qa/mutation-ratchet.mjs`). Held to a deadline (`endsWithin`) it FAILS instead.
 *
 * Worked by hand: 20 entered; the round-2 cut is top 6, the round-3 cut is top 2.
 */
const cut = (count: number): RoundCutFields => ({ cutEnabled: true, cutMode: "count", cutCount: count, cutPercent: 50, cutScope: "overall" });

describe("the loops of cut.ts end", () => {
  it("the field entering round 3 is 2 after cuts to 6 and 2", () => {
    expect(endsWithin(() => fieldEnteringRound([cut(1), cut(6), cut(2)], 2, { total: 20 }))).toBe(2);
  });

  it("the field entering round 2 is 6", () => {
    expect(endsWithin(() => fieldEnteringRound([cut(1), cut(6), cut(2)], 1, { total: 20 }))).toBe(6);
  });

  it("the cut line is drawn under the second of four rows", () => {
    const rows = [{ advancing: true }, { advancing: true }, { advancing: false }, { advancing: false }];
    expect(endsWithin(() => cutLineIndex(rows))).toBe(1);
  });
});
