import { describe, it, expect } from "vitest";
import {
  strokeCutOutcome,
  cutTieRuleOf,
  cutTieDecisionsOf,
  type CutLineRow,
  type CutRule,
} from "../cut";

/**
 * A TIE FOR THE LAST PLACE AT A STROKE CUT (Ajay, 2026-10-23, "as recommended").
 *
 * The organizer chooses per cut: everybody level goes through, a play-off whose
 * winner the committee records, or a countback then a draw by lot. Until the
 * committee settles a tie the rule leaves to it, nobody in the tie is through
 * and nobody in it is out — `undecided` holds them.
 *
 * Rows are the board's: `rank` after the board's countback, `score` the figure
 * the round is decided on. The fixtures give players level on the SCORE
 * different ranks where a countback separated them, as the board does.
 */
const top = (count: number, scope: CutRule["scope"] = "overall"): CutRule => ({ scope, mode: "count", count, percent: 50 });
const row = (id: string, rank: number, score: number, groupId: string | null = null): CutLineRow => ({ id, rank, score, groupId });
const ids = (s: Set<string>) => [...s].sort();

describe("the default: everybody level on the last score goes through", () => {
  it("takes exactly N when nobody is level on the last place (control)", () => {
    const field = [row("a", 1, 70), row("b", 2, 71), row("c", 3, 72), row("d", 4, 73)];
    const out = strokeCutOutcome(field, top(2), "ties", []);
    expect(ids(out.through)).toEqual(["a", "b"]);
    expect(out.undecided).toEqual([]);
  });

  it("takes everybody level on the SCORE, even where the board's countback split them", () => {
    /**
     * THE CHANGE OF 2026-10-23. "Level" was the board's rank, after countback,
     * so of two players on 72 the one with the worse last nine went home under
     * a rule that read "top 2 and ties". Here b and c are both 72, ranked 2 and
     * 3 by the board's countback: both go through.
     */
    const field = [row("a", 1, 70), row("b", 2, 72), row("c", 3, 72), row("d", 4, 74)];
    expect(ids(strokeCutOutcome(field, top(2), "ties", []).through)).toEqual(["a", "b", "c"]);
  });

  it("does not stretch to a tie BELOW the last place", () => {
    const field = [row("a", 1, 70), row("b", 2, 71), row("c", 3, 72), row("d", 3, 72)];
    expect(ids(strokeCutOutcome(field, top(2), "ties", []).through)).toEqual(["a", "b"]);
  });

  it("never sends through a player without a position", () => {
    const field = [row("a", 1, 70), row("b", 0, 0), row("c", 2, 71)];
    expect(ids(strokeCutOutcome(field, top(2), "ties", []).through)).toEqual(["a", "c"]);
  });

  it("an unknown stored rule reads as the default", () => {
    expect(cutTieRuleOf("")).toBe("ties");
    expect(cutTieRuleOf("lottery")).toBe("ties");
    expect(cutTieRuleOf("playoff")).toBe("playoff");
    expect(cutTieRuleOf("countback")).toBe("countback");
  });
});

describe("a play-off: the committee records who won", () => {
  const field = [row("a", 1, 70), row("b", 2, 72), row("c", 3, 72), row("d", 4, 72), row("e", 5, 75)];

  it("sends the certain players through and NOBODY in the tie, until it is recorded", () => {
    // Top 2: a is through; b, c and d are level on 72 for one place.
    const out = strokeCutOutcome(field, top(2), "playoff", []);
    expect(ids(out.through)).toEqual(["a"]);
    expect(out.undecided).toEqual([{ groupId: null, playerIds: ["b", "c", "d"], places: 1, by: "playoff" }]);
  });

  it("the play-off is between players level on the SCORE, whatever their board places", () => {
    // b, c and d hold three different places off the board's countback; a
    // play-off is still owed to all three.
    expect(strokeCutOutcome(field, top(2), "playoff", []).undecided[0].playerIds).toEqual(["b", "c", "d"]);
  });

  it("applies the recorded winner, and only that winner", () => {
    const out = strokeCutOutcome(field, top(2), "playoff", [{ tied: ["d", "b", "c"], through: ["c"] }]);
    expect(ids(out.through)).toEqual(["a", "c"]);
    expect(out.undecided).toEqual([]);
    expect(out.decided[0].through).toEqual(["c"]);
  });

  it("ignores a decision about a different tie — a correction that changes who is level reopens it", () => {
    // Recorded when only b and c were level; d has since joined them.
    const stale = [{ tied: ["b", "c"], through: ["c"] }];
    const out = strokeCutOutcome(field, top(2), "playoff", stale);
    expect(ids(out.through)).toEqual(["a"]);
    expect(out.undecided).toHaveLength(1);
  });

  it("ignores a decision that sends the wrong number through", () => {
    const out = strokeCutOutcome(field, top(2), "playoff", [{ tied: ["b", "c", "d"], through: ["b", "c"] }]);
    expect(out.undecided).toHaveLength(1);
    expect(out.through.has("b")).toBe(false);
  });

  it("ignores a decision naming somebody outside the tie", () => {
    const out = strokeCutOutcome(field, top(2), "playoff", [{ tied: ["b", "c", "d"], through: ["e"] }]);
    expect(out.undecided).toHaveLength(1);
    expect(out.through.has("e")).toBe(false);
  });

  it("owes nothing when the line falls in a gap", () => {
    const gap = [row("a", 1, 70), row("b", 2, 71), row("c", 3, 72)];
    const out = strokeCutOutcome(gap, top(2), "playoff", []);
    expect(ids(out.through)).toEqual(["a", "b"]);
    expect(out.undecided).toEqual([]);
  });

  it("owes nothing for a tie entirely inside the places", () => {
    const inside = [row("a", 1, 70), row("b", 1, 70), row("c", 3, 75)];
    expect(strokeCutOutcome(inside, top(2), "playoff", []).undecided).toEqual([]);
  });
});

describe("a countback, then a draw by lot", () => {
  it("goes by the board's countback: level on score, separated by it, owes nothing", () => {
    const field = [row("a", 1, 70), row("b", 2, 72), row("c", 3, 72), row("d", 4, 74)];
    const out = strokeCutOutcome(field, top(2), "countback", []);
    expect(ids(out.through)).toEqual(["a", "b"]);
    expect(out.undecided).toEqual([]);
  });

  it("owes a draw where the countback could not separate them (one shared place)", () => {
    const field = [row("a", 1, 70), row("b", 2, 72), row("c", 2, 72), row("d", 4, 74)];
    const out = strokeCutOutcome(field, top(2), "countback", []);
    expect(ids(out.through)).toEqual(["a"]);
    expect(out.undecided).toEqual([{ groupId: null, playerIds: ["b", "c"], places: 1, by: "draw" }]);
    const drawn = strokeCutOutcome(field, top(2), "countback", [{ tied: ["b", "c"], through: ["b"] }]);
    expect(ids(drawn.through)).toEqual(["a", "b"]);
  });

  it("a draw for two places out of three level", () => {
    const field = [row("a", 1, 70), row("b", 2, 72), row("c", 2, 72), row("d", 2, 72)];
    const out = strokeCutOutcome(field, top(3), "countback", []);
    expect(out.undecided[0]).toMatchObject({ playerIds: ["b", "c", "d"], places: 2 });
  });
});

describe("per flight, each flight settles its own line", () => {
  it("finds a tie in one flight and none in the other", () => {
    const field = [
      row("a1", 1, 70, "f1"),
      row("b1", 2, 72, "f1"),
      row("a2", 3, 72, "f2"),
      row("b2", 4, 72, "f2"),
      row("c2", 5, 74, "f2"),
    ];
    const out = strokeCutOutcome(field, top(1, "perFlight"), "playoff", []);
    expect(ids(out.through)).toEqual(["a1"]);
    expect(out.undecided).toEqual([{ groupId: "f2", playerIds: ["a2", "b2"], places: 1, by: "playoff" }]);
  });
});

describe("the stored decisions", () => {
  it("reads only what is a decision", () => {
    expect(cutTieDecisionsOf("")).toEqual([]);
    expect(cutTieDecisionsOf("not json")).toEqual([]);
    expect(cutTieDecisionsOf('{"tied":["a"]}')).toEqual([]);
    expect(cutTieDecisionsOf('[{"tied":["a","b"],"through":["a"]},{"tied":[1],"through":[]},null]')).toEqual([
      { tied: ["a", "b"], through: ["a"] },
    ]);
  });
});
