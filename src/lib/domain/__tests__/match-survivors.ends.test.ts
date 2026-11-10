import { describe, expect, it } from "vitest";
import { deriveNetHoles, marginToHoles, parseHolesTranscript, resolveMatch } from "../match";
import { endsWithin } from "../../__tests__/ends-within";
import type { HoleResult } from "../types";

/**
 * THE LOOPS IN `match.ts` END (2026-11-09).
 *
 * Five mutants make a counting loop endless (`i -= 1` in `closeoutOf`, `deriveNetHoles` and
 * `marginToHoles`; `j -= 1` and `j < tokens.length` forced true in `parseHolesTranscript`). An
 * assertion is never reached by an endless loop, and under Stryker the mutant would end as a plain
 * timeout, which the ratchet counts as NOT caught. Each call goes through `endsWithin`
 * (`src/lib/__tests__/ends-within.ts`), so each FAILS inside its deadline, and the answers are the
 * ones worked by hand from Rule 3.2 (a hole goes to the lower net score; a match is over when one
 * side leads by more holes than remain).
 */
/** A correct call here takes microseconds; a short deadline fails an endless one before Stryker's own timeout can. */
const ends = <T,>(call: () => T): T => endsWithin(call, 250);

describe("match.ts loops end, and give the answer worked by hand", () => {
  it("a card is walked hole by hole: 3 up after 16 is 3&2", () => {
    const holes: HoleResult[] = [..."AAAHHHHHHHHHHHHHBB"].map((c) => c as HoleResult);
    const r = ends(() => resolveMatch(holes));
    expect(r.resultText).toBe("3&2");
  });

  it("a net card is built hole by hole: lower net wins, equal halves", () => {
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    const h = ends(() => deriveNetHoles([4, 5, 6], [5, 5, 4], 0, 0, si, 3));
    expect(h).toEqual(["A", "H", "B"]);
  });

  it("a typed margin is laid out hole by hole: 2&1 over 18", () => {
    const h = ends(() => marginToHoles("A", "2&1", 18));
    expect(h.slice(14)).toEqual(["H", "A", "A", null]);
    expect(h).toHaveLength(18);
  });

  it("a dictation ends with its words, and again at the last hole", () => {
    expect(ends(() => parseHolesTranscript("Sam Alex", "Sam", "Alex", 0, 18))).toEqual(["A", "B"]);
    expect(ends(() => parseHolesTranscript("", "Sam", "Alex", 0, 18))).toEqual([]);
    expect(ends(() => parseHolesTranscript("Sam Sam Sam", "Sam", "Alex", 16, 18))).toEqual(["A", "A"]);
    expect(ends(() => parseHolesTranscript("um um um", "Sam", "Alex", 0, 18))).toEqual([]);
  });
});
