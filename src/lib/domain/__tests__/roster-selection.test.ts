import { describe, it, expect } from "vitest";
import { rosterSelection, type SelectionRow } from "../roster-selection";

/**
 * What ticking boxes on the roster will do, and what it says when the answer
 * is "nothing".
 *
 * The bar used to render only when something could be added, so selecting
 * three members already in the tournament made it VANISH — and the count it
 * did show was the addable count under the word "selected", so ticking five
 * read as "2 selected". Both are assertions here rather than judgements about
 * a component a static render cannot drive.
 */

const active = (over: Partial<SelectionRow> = {}): SelectionRow => ({
  entered: false,
  status: "active",
  ...over,
});

describe("what the roster selection will do", () => {
  it("says nothing is selected when nothing is", () => {
    expect(rosterSelection([], "zz-Cup")).toEqual({ selected: 0, addable: 0, problem: "" });
  });

  it("counts what was SELECTED, not what is addable", () => {
    // The defect: five ticked, two addable, and the screen said "2 selected".
    const chosen = [active(), active(), active({ entered: true }), active({ entered: true }), active({ entered: true })];
    const r = rosterSelection(chosen, "zz-Cup");
    expect(r.selected).toBe(5);
    expect(r.addable).toBe(2);
  });

  it("stays quiet when every selected member can be added", () => {
    expect(rosterSelection([active(), active()], "zz-Cup").problem).toBe("");
  });

  it("explains rather than disappearing when NONE can be added", () => {
    // The whole point. Boxes tick, the button cannot run, and the reason is on
    // screen instead of the bar simply not rendering.
    const r = rosterSelection([active({ entered: true }), active({ entered: true })], "zz-Cup");
    expect(r.selected).toBe(2);
    expect(r.addable).toBe(0);
    expect(r.problem).toBe("2 already in zz-Cup");
  });

  it("names the tournament it means", () => {
    expect(rosterSelection([active({ entered: true })], "zz-Spring Meeting").problem).toContain(
      "zz-Spring Meeting",
    );
    // And says something usable when the caller has no name to give.
    expect(rosterSelection([active({ entered: true })], "").problem).toBe(
      "1 already in this tournament",
    );
  });

  it("gives ONE reason, the commonest first", () => {
    // Somebody told about the inactive one while three are already entered
    // fixes the wrong thing and is refused again — the drawReadiness rule.
    const chosen = [
      active({ entered: true }),
      active({ entered: true }),
      active({ entered: true }),
      active({ status: "inactive" }),
    ];
    const r = rosterSelection(chosen, "zz-Cup");
    expect(r.problem).toBe("3 already in zz-Cup");
    expect(r.problem).not.toContain("inactive");
  });

  it("falls through to the inactive reason when that is the only one", () => {
    const one = rosterSelection([active(), active({ status: "inactive" })], "zz-Cup");
    expect(one.addable).toBe(1);
    expect(one.problem).toBe("1 inactive — reactivate that member first");

    const many = rosterSelection(
      [active({ status: "inactive" }), active({ status: "inactive" })],
      "zz-Cup",
    );
    expect(many.addable).toBe(0);
    expect(many.problem).toBe("2 inactive — reactivate those members first");
  });

  it("never reports more addable than selected", () => {
    // The invariant, swept at the sizes the matrix suite uses. An off-by-one
    // here would offer to add somebody who is not ticked.
    for (const size of [1, 2, 3, 4, 5, 6, 7, 8, 16, 28]) {
      for (const shape of ["all-new", "all-entered", "mixed", "inactive"] as const) {
        const chosen = Array.from({ length: size }, (_, i) =>
          shape === "all-new"
            ? active()
            : shape === "all-entered"
              ? active({ entered: true })
              : shape === "inactive"
                ? active({ status: "inactive" })
                : active(i % 2 === 0 ? { entered: true } : {}),
        );
        const r = rosterSelection(chosen, "zz-Cup");
        expect(r.selected).toBe(size);
        expect(r.addable).toBeLessThanOrEqual(r.selected);
        expect(r.addable).toBeGreaterThanOrEqual(0);
        // A problem is stated exactly when something cannot be added.
        expect(r.problem === "").toBe(r.addable === r.selected);
      }
    }
  });
});
