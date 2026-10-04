import { describe, it, expect } from "vitest";
import { catalogueRefusal, cardFrom } from "../course-directory";
import { cardRefusal } from "../scorecard-parse";
import { readSource } from "../../__tests__/source";

/**
 * THE IMPORT AND THE RE-CHECK ASK ONE QUESTION (2026-10-04, found by the
 * catalogue rebuild). Measured read-only that day on the 199 stored cards:
 * the old `--revalidate` (`cardRefusal`) would have cleared 34 — every one a
 * card with good pars and no stroke index, which the import keeps on purpose —
 * and `catalogueRefusal` clears none.
 */
const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const NO_SI = new Array(18).fill(0);
const holes = (pars: number[], si: number[]) =>
  pars.map((par, i) => ({ number: i + 1, par, handicap_index: si[i], yardages: {} }));

describe("catalogueRefusal", () => {
  it("keeps a card with good pars and no stroke index — as the import does", () => {
    expect(catalogueRefusal(PARS, NO_SI, 18)).toBeNull();
    expect(cardFrom(holes(PARS, NO_SI)).usable).toBe(true);
    // The question this replaced refuses it. That disagreement is the defect.
    expect(cardRefusal(PARS, [], NO_SI, 18)).toContain("used more than once");
  });

  it("still refuses what the import refuses: a broken index, a nearly-sorted card", () => {
    const dupe = [...SI];
    dupe[1] = 6;
    expect(catalogueRefusal(PARS, dupe, 18)).not.toBeNull();
    const andalusia = [5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3, 3, 4];
    expect(catalogueRefusal(andalusia, SI, 18)).toContain("par 5s in a row");
  });

  it("agrees with the import on every card shape it is asked about", () => {
    const cases: Array<[number[], number[]]> = [
      [PARS, SI],
      [PARS, NO_SI],
      [[5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3, 3, 4], SI],
      [[5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3], SI],
    ];
    for (const [p, s] of cases) {
      const imported = cardFrom(holes(p, s));
      expect(imported.usable, p.join("")).toBe(catalogueRefusal(p, s, 18) === null);
    }
  });

  it("is what the importer's --revalidate asks, and not cardRefusal", () => {
    const script = readSource("scripts", "import-course-catalog.ts");
    expect(script).toContain("catalogueRefusal(pars, strokeIndex, holesPlayed(pars.length))");
    expect(script).not.toMatch(/\bcardRefusal\(/);
  });
});
