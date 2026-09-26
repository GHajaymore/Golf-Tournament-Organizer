import { describe, it, expect } from "vitest";
import { withStrokeBasis } from "@/lib/domain/ranked-score";
import { readSource } from "./source";

/**
 * TODAY SAYS WHICH TO-PAR IT IS.
 *
 * Found 2026-09-26 walking the player app on the seeded April Medal: Today
 * read "YOUR CARD · THRU 11" over −2 (the NET to-par the medal is ranked on)
 * while My card read "Gross 49 · To par +5 · Net 42". Both correct, and a
 * golfer holding the phone sees two under and five over for one round.
 *
 * Enumerated over the units a board can be ranked on, as
 * `board-prints-what-it-ranked-on` does, rather than pinned on the one seen.
 */
describe("withStrokeBasis", () => {
  const thru = { text: "-2", label: "Thru 11" };

  it("names a net to-par as net", () => {
    expect(withStrokeBasis(thru, true, "net strokes")).toBe("Thru 11 · net");
  });

  it("names a gross to-par as gross", () => {
    expect(withStrokeBasis(thru, true, "gross strokes")).toBe("Thru 11 · gross");
  });

  it("names a finished card too", () => {
    expect(withStrokeBasis({ text: "+3", label: "Final" }, true, "net strokes")).toBe("Final · net");
  });

  it("adds nothing to a unit that is already its own word", () => {
    // Stableford points and match points are not a to-par; the caller says so
    // by passing strokeRound false.
    expect(withStrokeBasis({ text: "36", label: "Thru 18" }, false, "Stableford points")).toBe("Thru 18");
    expect(withStrokeBasis({ text: "4", label: "Match points" }, false, "match points")).toBe("Match points");
  });

  it("adds nothing beside a dash, which is not a to-par", () => {
    expect(withStrokeBasis({ text: "–", label: "Not started" }, true, "net strokes")).toBe("Not started");
  });
});

describe("Today's label goes through it", () => {
  it("me.ts builds scoreLabel with withStrokeBasis, from the board's own unit", () => {
    const src = readSource("src/lib/services/me.ts");
    // The last one: the first is the field's declaration on the interface.
    const at = src.lastIndexOf("scoreLabel:");
    expect(at, "scoreLabel is not built in me.ts any more").toBeGreaterThan(0);
    const expr = src.slice(at, src.indexOf("note:", at));
    expect(expr).toMatch(/withStrokeBasis\(/);
    expect(expr).toMatch(/state\.strokeUnitLabel/);
  });
});
