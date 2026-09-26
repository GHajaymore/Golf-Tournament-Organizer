import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * SCORE ENTRY IS TOLD WHICH ROUND IS THE KNOCKOUT.
 *
 * `EntryModes` shows the bracket hand-off for a round flagged `bracket` (see
 * render.test, "sends a knockout round to the bracket"). The flag is set on the
 * server page; without it every bracket round falls back to stroke cards and a
 * "generate flights" dead end. Asked through `isKnockoutRound`, the one answer
 * to "is this a knockout" — never a spelled-out stage type.
 */
describe("the score entry page", () => {
  it("flags each round's bracket through isKnockoutRound", () => {
    const src = readSource("src/app/(app)/entry/page.tsx");
    expect(src).toMatch(/bracket:\s*isKnockoutRound\(stage\.type\)/);
  });
});
