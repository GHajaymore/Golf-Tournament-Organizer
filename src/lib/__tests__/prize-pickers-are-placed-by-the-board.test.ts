import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE PRIZE PICKERS ARE PLACED BY THE BOARD'S OWN SORT, ON THEIR BASIS.
 *
 * The value is pinned on real rows in `a-gross-prize-tie-goes-to-countback.audit.test.ts`
 * (a tie for Best gross in a net medal goes to countback, not to T1). This pins the
 * wiring that test cannot see: the prizes screen asks `strokeStandingsOn` for both
 * pickers, and does not order or number them itself. It used to sort on the raw
 * figure and number with `placesByValue`, shared places and no countback.
 */
describe("the prize pickers", () => {
  const page = readSource("src/app/(app)/prizes/page.tsx");

  it("ask the board for gross and for net", () => {
    expect(page).toMatch(/state\.strokeStandingsOn\(basis\)/);
    expect(page).toMatch(/gross: scoreOrder\("gross"\), net: scoreOrder\("net"\)/);
  });

  it("number nothing of their own", () => {
    expect(page).not.toMatch(/placesByValue\(/);
  });
});
