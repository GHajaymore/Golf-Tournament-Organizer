import { describe, expect, it } from "vitest";
import { deriveNetHoles, marginToHoles, resolveMatch } from "../match";
import { endsWithin } from "../../__tests__/ends-within";
import type { HoleResult } from "../types";

/**
 * THE LOOPS IN `match.ts` END (2026-11-09).
 *
 * Three mutants make a counting loop endless (`i -= 1` in `closeoutOf`, `deriveNetHoles` and
 * `marginToHoles`; the spoken hole reader that made five is gone, 2026-11-09). An
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
});
