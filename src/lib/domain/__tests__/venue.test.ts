import { describe, it, expect } from "vitest";
import { exactCardClaim } from "../venue";

describe("what the venue screen may claim about a matched course", () => {
  /**
   * Extracted from JSX so it can be tested at all.
   *
   * The check lived as a condition inside the markup, and that branch only
   * renders once something has been typed — which `renderToStaticMarkup`
   * cannot do. Reverting it left every render test green, so the guard was
   * decoration. The rule lives in `venue.ts` now and is asked directly.
   */
  const course = (hasCard?: boolean) => ({ id: "c1", name: "Green Crest", hasCard });

  it("lets the screen claim a card when the club has one", () => {
    expect(exactCardClaim({ kind: "exact", course: course(true) })).toBe("has-card");
  });

  it("refuses the claim when the row has no card", () => {
    /**
     * THE DEFECT. The screen said "Using the club's saved card" for a course
     * that is a name and nothing else, so the round scored against no pars
     * and no stroke index — and every total looked ordinary.
     */
    expect(exactCardClaim({ kind: "exact", course: course(false) })).toBe("no-card");
  });

  it("treats not-knowing as having one", () => {
    // Undefined is "the caller did not say", not "there is no card".
    // Reading it as absence would warn about every course of every caller
    // that has not been updated.
    expect(exactCardClaim({ kind: "exact", course: course(undefined) })).toBe("has-card");
  });

  it("claims nothing when nothing matched exactly", () => {
    expect(exactCardClaim(null)).toBeNull();
    expect(exactCardClaim({ kind: "new", name: "Somewhere" })).toBeNull();
    // A suggestion is a question, not an answer — the screen is still asking
    // which of several was meant.
    expect(exactCardClaim({ kind: "suggest", candidates: [course(true)] })).toBeNull();
  });
});
