import { describe, it, expect } from "vitest";
import {
  survivorCount,
  survivors,
  isCutScope,
  cutAdvancesEveryone,
  cutLineOutcome,
  cutLineRows,
  tableCutLineRows,
  cutTieRuleWords,
  cutTieDecisionsOf,
  roundHasSomethingToCutOn,
  describeCut,
  cutSettledOnCountback,
  cutLineIndex,
  qualifyingCutoffText,
  type CutRule,
  type CutLineRow,
  type CutTieDecision,
} from "../cut";

/**
 * Examples worked by hand for `domain/cut.ts` (J49, 2026-11-09) — each from the committee's cut
 * terms ("the leading N and ties", a play-off, a countback; Committee Procedures 5A(6), "Deciding
 * ties") or from plain arithmetic, never from what the code prints.
 */
const rule = (over: Partial<CutRule> = {}): CutRule => ({ scope: "overall", mode: "count", count: 2, percent: 50, ...over });
const row = (id: string, rank: number, score: number, groupId: string | null = null): CutLineRow => ({ id, rank, score, groupId });
const ids = (s: Set<string>) => [...s].sort();

describe("how many go through", () => {
  it("a count is the count, clamped to the field and never below one", () => {
    expect(survivorCount(rule({ count: 3 }), 10)).toBe(3);
    expect(survivorCount(rule({ count: 20 }), 10)).toBe(10);
    expect(survivorCount(rule({ count: 0 }), 10)).toBe(1);
    expect(survivorCount(rule({ count: -4 }), 10)).toBe(1);
    expect(survivorCount(rule({ count: 1 }), 1)).toBe(1);
  });

  it("a percentage rounds UP: 24% of 10 is 2.4, so 3; 20% of 10 is exactly 2", () => {
    expect(survivorCount(rule({ mode: "percent", percent: 24 }), 10)).toBe(3);
    expect(survivorCount(rule({ mode: "percent", percent: 20 }), 10)).toBe(2);
    expect(survivorCount(rule({ mode: "percent", percent: 50 }), 9)).toBe(5);
    expect(survivorCount(rule({ mode: "percent", percent: 10 }), 5)).toBe(1);
    expect(survivorCount(rule({ mode: "percent", percent: 100 }), 7)).toBe(7);
    expect(survivorCount(rule({ mode: "percent", percent: 150 }), 7)).toBe(7);
  });

  it("an empty field sends nobody", () => {
    expect(survivorCount(rule(), 0)).toBe(0);
    expect(survivorCount(rule(), -3)).toBe(0);
  });

  it("the percentage is ignored for a count and the count for a percentage", () => {
    expect(survivorCount(rule({ mode: "count", count: 2, percent: 100 }), 10)).toBe(2);
    expect(survivorCount(rule({ mode: "percent", count: 9, percent: 10 }), 10)).toBe(1);
  });
});

describe("survivors takes the front of the list, flight by flight", () => {
  it("a missing flight and a null one are the same (unflighted) group", () => {
    const list = [{ id: "a" }, { id: "b", groupId: null }, { id: "c", groupId: "x" }, { id: "d", groupId: "x" }];
    // per flight, top 1: the unflighted group is a and b -> a; flight x -> c.
    expect(ids(survivors(list, rule({ scope: "perFlight", count: 1 })))).toEqual(["a", "c"]);
  });

  it("per flight, a percentage is sized against each flight: 50% of 4 is 2, of 3 is 2", () => {
    const list = [
      { id: "a1", groupId: "A" }, { id: "b1", groupId: "B" }, { id: "a2", groupId: "A" },
      { id: "b2", groupId: "B" }, { id: "a3", groupId: "A" }, { id: "b3", groupId: "B" }, { id: "a4", groupId: "A" },
    ];
    expect(ids(survivors(list, rule({ scope: "perFlight", mode: "percent", percent: 50 })))).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("overall takes the first N of the order it was given, whatever the flights", () => {
    const list = [{ id: "x", groupId: "A" }, { id: "y", groupId: "A" }, { id: "z", groupId: "B" }];
    expect(ids(survivors(list, rule({ count: 2 })))).toEqual(["x", "y"]);
  });

  it("recognises its two scopes and nothing else", () => {
    expect(isCutScope("overall")).toBe(true);
    expect(isCutScope("perFlight")).toBe(true);
    expect(isCutScope("Overall")).toBe(false);
    expect(isCutScope("")).toBe(false);
  });
});

describe("the leading N and ties", () => {
  it("everybody level on the SCORE of the last place goes through, whatever their place on countback", () => {
    // 70, 72, 72, 75 and the cut is two: the second place is 72 and the other 72 is level with it.
    const rows = [row("a", 1, 70), row("b", 2, 72), row("c", 3, 72), row("d", 4, 75)];
    const out = cutLineOutcome(rows, rule({ count: 2 }), "ties", []);
    expect(ids(out.through)).toEqual(["a", "b", "c"]);
    expect(out.undecided).toEqual([]);
    expect(out.decided).toEqual([]);
  });

  it("a gap at the line takes exactly N", () => {
    const rows = [row("a", 1, 70), row("b", 2, 71), row("c", 3, 72)];
    expect(ids(cutLineOutcome(rows, rule({ count: 2 }), "ties", []).through)).toEqual(["a", "b"]);
  });

  it("a player with no place is never through, and does not count toward the field", () => {
    // Two placed players; the unplaced one shows the winning score but has no rank.
    const rows = [row("x", 0, 60), row("a", 1, 70), row("b", 2, 71)];
    expect(ids(cutLineOutcome(rows, rule({ count: 1 }), "ties", []).through)).toEqual(["a"]);
    // 50% of the two PLACED players is one, not two.
    expect(ids(cutLineOutcome(rows, rule({ mode: "percent", percent: 50 }), "ties", []).through)).toEqual(["a"]);
  });

  it("a field with nobody placed has nothing to cut and no tie", () => {
    const out = cutLineOutcome([row("a", 0, 70), row("b", 0, 71)], rule(), "playoff", []);
    expect(out.through.size).toBe(0);
    expect(out.undecided).toEqual([]);
    expect(cutLineOutcome([], rule(), "ties", []).through.size).toBe(0);
  });

  it("a cut as big as the field sends everybody", () => {
    const rows = [row("a", 1, 70), row("b", 2, 71)];
    for (const t of ["ties", "playoff", "countback"] as const) {
      const out = cutLineOutcome(rows, rule({ count: 5 }), t, []);
      expect(ids(out.through)).toEqual(["a", "b"]);
      expect(out.undecided).toEqual([]);
    }
  });
});

describe("a play-off for the places left", () => {
  const rows = [row("a", 1, 70), row("b", 2, 72), row("c", 3, 72), row("d", 4, 72), row("e", 5, 80)];

  it("the clear leader is through, and three level on 72 play off for the one place left", () => {
    const out = cutLineOutcome(rows, rule({ count: 2 }), "playoff", []);
    expect(ids(out.through)).toEqual(["a"]);
    expect(out.undecided).toEqual([{ groupId: null, playerIds: ["b", "c", "d"], places: 1, by: "playoff" }]);
    expect(out.decided).toEqual([]);
  });

  it("a recorded winner goes through and the tie is decided", () => {
    const decision: CutTieDecision = { tied: ["d", "b", "c"], through: ["c"] };
    const out = cutLineOutcome(rows, rule({ count: 2 }), "playoff", [decision]);
    expect(ids(out.through)).toEqual(["a", "c"]);
    expect(out.undecided).toEqual([]);
    expect(out.decided).toEqual([{ groupId: null, playerIds: ["b", "c", "d"], places: 1, by: "playoff", through: ["c"] }]);
  });

  it("a decision for a DIFFERENT set of players leaves the tie open", () => {
    expect(cutLineOutcome(rows, rule({ count: 2 }), "playoff", [{ tied: ["b", "c"], through: ["c"] }]).undecided).toHaveLength(1);
    expect(cutLineOutcome(rows, rule({ count: 2 }), "playoff", [{ tied: ["b", "c", "d", "e"], through: ["c"] }]).undecided).toHaveLength(1);
  });

  it("a decision that names the wrong NUMBER of winners, or somebody not in the tie, leaves it open", () => {
    expect(cutLineOutcome(rows, rule({ count: 2 }), "playoff", [{ tied: ["b", "c", "d"], through: ["b", "c"] }]).undecided).toHaveLength(1);
    expect(cutLineOutcome(rows, rule({ count: 2 }), "playoff", [{ tied: ["b", "c", "d"], through: [] }]).undecided).toHaveLength(1);
    expect(cutLineOutcome(rows, rule({ count: 2 }), "playoff", [{ tied: ["b", "c", "d"], through: ["a"] }]).undecided).toHaveLength(1);
  });

  it("two places, and a winner named twice is one winner, not two", () => {
    // 70, then four level on 72, cut to 3: two of the four go through.
    const four = [row("a", 1, 70), row("b", 2, 72), row("c", 3, 72), row("d", 4, 72), row("e", 5, 72)];
    const open = cutLineOutcome(four, rule({ count: 3 }), "playoff", [{ tied: ["b", "c", "d", "e"], through: ["c", "c"] }]);
    expect(open.undecided).toEqual([{ groupId: null, playerIds: ["b", "c", "d", "e"], places: 2, by: "playoff" }]);
    const done = cutLineOutcome(four, rule({ count: 3 }), "playoff", [{ tied: ["b", "c", "d", "e"], through: ["e", "c"] }]);
    expect(ids(done.through)).toEqual(["a", "c", "e"]);
    expect(done.decided[0].through).toEqual(["e", "c"]);
  });

  it("a gap at the line owes nobody a play-off", () => {
    const gap = [row("a", 1, 70), row("b", 2, 71), row("c", 3, 72)];
    const out = cutLineOutcome(gap, rule({ count: 2 }), "playoff", []);
    expect(ids(out.through)).toEqual(["a", "b"]);
    expect(out.undecided).toEqual([]);
  });

  it("level on the score is level for a play-off even where countback has already split the places", () => {
    // ranks 2 and 3 differ, scores are both 72: still a play-off for the one place.
    const split = [row("a", 1, 70), row("b", 2, 72), row("c", 3, 72)];
    const out = cutLineOutcome(split, rule({ count: 2 }), "playoff", []);
    expect(out.undecided).toEqual([{ groupId: null, playerIds: ["b", "c"], places: 1, by: "playoff" }]);
  });

  it("ids that join to the same text are still different sets", () => {
    // Tied are "a" and "bc"; a decision about "ab" and "c" is not about them.
    const r = [row("z", 1, 60), row("a", 2, 72), row("bc", 3, 72)];
    const out = cutLineOutcome(r, rule({ count: 2 }), "playoff", [{ tied: ["ab", "c"], through: ["a"] }]);
    expect(out.undecided).toHaveLength(1);
    expect(out.decided).toEqual([]);
  });

  it("a decision with the right size but different members is not the tie", () => {
    const out = cutLineOutcome(rows, rule({ count: 2 }), "playoff", [{ tied: ["b", "c", "x"], through: ["c"] }]);
    expect(out.undecided).toHaveLength(1);
  });
});

describe("a countback tie is the board's own places", () => {
  it("places already split by countback leave no tie", () => {
    // Same score 72 but ranks 2 and 3: the countback has chosen.
    const rows = [row("a", 1, 70), row("b", 2, 72), row("c", 3, 72)];
    const out = cutLineOutcome(rows, rule({ count: 2 }), "countback", []);
    expect(ids(out.through)).toEqual(["a", "b"]);
    expect(out.undecided).toEqual([]);
  });

  it("players the countback could not separate share a place and are owed a draw by lot", () => {
    const rows = [row("a", 1, 70), row("b", 2, 72), row("c", 2, 72), row("d", 4, 73)];
    const out = cutLineOutcome(rows, rule({ count: 2 }), "countback", []);
    expect(ids(out.through)).toEqual(["a"]);
    expect(out.undecided).toEqual([{ groupId: null, playerIds: ["b", "c"], places: 1, by: "draw" }]);
  });

  it("a different score on the same place is still the same place", () => {
    // Ranks tie though scores differ (a table's tie-breaks were level): countback goes by place.
    const rows = [row("a", 1, 10), row("b", 2, 8), row("c", 2, 7)];
    const out = cutLineOutcome(rows, rule({ count: 2 }), "countback", []);
    expect(out.undecided).toEqual([{ groupId: null, playerIds: ["b", "c"], places: 1, by: "draw" }]);
  });

  it("the committee's draw is recorded and then applies", () => {
    const rows = [row("a", 1, 70), row("b", 2, 72), row("c", 2, 72)];
    const out = cutLineOutcome(rows, rule({ count: 2 }), "countback", [{ tied: ["c", "b"], through: ["b"] }]);
    expect(ids(out.through)).toEqual(["a", "b"]);
    expect(out.decided).toEqual([{ groupId: null, playerIds: ["b", "c"], places: 1, by: "draw", through: ["b"] }]);
  });
});

describe("a per-flight cut is a separate cut in each flight", () => {
  const perFlight = rule({ scope: "perFlight", count: 1 });

  it("top one of each flight, with a tie named by its flight", () => {
    const rows = [
      row("a1", 1, 70, "A"), row("b1", 2, 71, "B"), row("a2", 3, 75, "A"), row("b2", 4, 71, "B"),
    ];
    const ties = cutLineOutcome(rows, perFlight, "ties", []);
    expect(ids(ties.through)).toEqual(["a1", "b1", "b2"]);
    const po = cutLineOutcome(rows, perFlight, "playoff", []);
    expect(ids(po.through)).toEqual(["a1"]);
    expect(po.undecided).toEqual([{ groupId: "B", playerIds: ["b1", "b2"], places: 1, by: "playoff" }]);
  });

  it("ties are looked for inside the flight only: the same score in another flight is not a tie", () => {
    const rows = [row("a1", 1, 70, "A"), row("b1", 2, 70, "B"), row("a2", 3, 80, "A"), row("b2", 4, 90, "B")];
    const out = cutLineOutcome(rows, perFlight, "playoff", []);
    expect(ids(out.through)).toEqual(["a1", "b1"]);
    expect(out.undecided).toEqual([]);
  });

  it("an unflighted player's tie reports no flight, and each flight's tie is listed in the order the flights first appear", () => {
    const rows = [
      row("u1", 1, 70), row("u2", 2, 70), row("c1", 3, 71, "C"), row("c2", 4, 71, "C"),
    ];
    const out = cutLineOutcome(rows, perFlight, "playoff", []);
    expect(out.undecided.map((t) => t.groupId)).toEqual([null, "C"]);
  });

  it("a flight's percentage is of that flight's placed players", () => {
    const rows = [
      row("a1", 1, 70, "A"), row("a2", 2, 71, "A"), row("a3", 3, 72, "A"), row("a4", 4, 73, "A"),
      row("b1", 5, 74, "B"), row("b2", 6, 75, "B"),
    ];
    const out = cutLineOutcome(rows, rule({ scope: "perFlight", mode: "percent", percent: 50 }), "ties", []);
    expect(ids(out.through)).toEqual(["a1", "a2", "b1"]);
  });
});

describe("the rows a cut reads", () => {
  it("a stroke board gives ranked players only, scored on the chosen basis against the holes played", () => {
    const base = { gross: 0, net: 0, points: 0, parThru: 0, levelPoints: 0 };
    const standings = [
      { ...base, gross: 76, net: 70, points: 30, parThru: 72, levelPoints: 36, player: { id: "a", groupId: "F" }, rank: 1, ranked: true },
      { ...base, gross: 40, net: 30, points: 10, parThru: 36, levelPoints: 18, player: { id: "b" }, rank: 0, ranked: false },
      { ...base, gross: 80, net: 74, points: 33, parThru: 72, levelPoints: 36, player: { id: "c", groupId: null }, rank: 2, ranked: true },
    ];
    expect(cutLineRows(standings, "gross")).toEqual([
      { id: "a", groupId: "F", rank: 1, score: 4 },
      { id: "c", groupId: null, rank: 2, score: 8 },
    ]);
    expect(cutLineRows(standings, "net").map((r) => r.score)).toEqual([-2, 2]);
    expect(cutLineRows(standings, "stableford").map((r) => r.score)).toEqual([-6, -3]);
  });

  it("a round robin's table gives its places and match points", () => {
    const table = [
      { player: { id: "p", groupId: "A" }, stats: { totalPoints: 7.5 }, rank: 1 },
      { player: { id: "q" }, stats: { totalPoints: 6 }, rank: 2 },
    ];
    expect(tableCutLineRows(table)).toEqual([
      { id: "p", groupId: "A", rank: 1, score: 7.5 },
      { id: "q", groupId: null, rank: 2, score: 6 },
    ]);
  });
});

describe("the words of the tie rule", () => {
  it("each rule, on a card and on a table", () => {
    expect(cutTieRuleWords("ties", "card")).toBe("Everybody tied for the last place goes through");
    expect(cutTieRuleWords("ties", "table")).toBe("Everybody level on points for the last place goes through");
    expect(cutTieRuleWords("playoff", "card")).toBe("A tie for the last place is decided by a play-off");
    expect(cutTieRuleWords("playoff", "table")).toBe("A tie for the last place is decided by a play-off");
    expect(cutTieRuleWords("countback", "card")).toBe(
      "A tie for the last place is decided by countback (last 9, 6, 3, then the last hole), then by lot",
    );
    expect(cutTieRuleWords("countback", "table")).toBe(
      "A tie for the last place is decided by the table's tie-breaks, in the order set for the round, then by lot",
    );
  });
});

describe("reading the committee's stored decisions", () => {
  it("nothing, rubbish and the wrong shape are no decisions", () => {
    expect(cutTieDecisionsOf(null)).toEqual([]);
    expect(cutTieDecisionsOf(undefined)).toEqual([]);
    expect(cutTieDecisionsOf("")).toEqual([]);
    expect(cutTieDecisionsOf("not json")).toEqual([]);
    expect(cutTieDecisionsOf("{}")).toEqual([]);
    expect(cutTieDecisionsOf('"x"')).toEqual([]);
    expect(cutTieDecisionsOf("null")).toEqual([]);
  });

  it("keeps the good ones in order and drops each kind of bad one", () => {
    const json = JSON.stringify([
      { tied: ["a", "b"], through: ["a"] },
      null,
      { tied: ["a"] },
      { through: ["a"] },
      { tied: "a", through: ["a"] },
      { tied: ["a"], through: "a" },
      { tied: ["a", 2], through: ["a"] },
      { tied: ["a"], through: [1] },
      { tied: [], through: [] },
    ]);
    expect(cutTieDecisionsOf(json)).toEqual([
      { tied: ["a", "b"], through: ["a"] },
      { tied: [], through: [] },
    ]);
  });
});

describe("something to cut on at a round robin", () => {
  const nothing = { matches: [], cards: [] };

  it("an empty round has nothing", () => {
    expect(roundHasSomethingToCutOn(nothing)).toBe(false);
  });

  it("a hole entered in a match counts, even a halve; blanks and spaces do not", () => {
    expect(roundHasSomethingToCutOn({ matches: [{ holes: '["","",""]' }], cards: [] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: '[" "]' }], cards: [] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: '["", "H"]' }], cards: [] })).toBe(true);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: '[1]' }], cards: [] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: "[]" }, { holes: '["1"]' }], cards: [] })).toBe(true);
  });

  it("a concession counts; an empty or missing one does not", () => {
    expect(roundHasSomethingToCutOn({ matches: [{ holes: "[]", forfeitedBy: "p1" }], cards: [] })).toBe(true);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: "[]", forfeitedBy: "" }], cards: [] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: "[]", forfeitedBy: null }], cards: [] })).toBe(false);
  });

  it("a stroke on a card counts; a zero, a negative, a string or a spoiled card does not", () => {
    expect(roundHasSomethingToCutOn({ matches: [], cards: [{ strokes: "[0,0,4]" }] })).toBe(true);
    expect(roundHasSomethingToCutOn({ matches: [], cards: [{ strokes: "[0,0]" }] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [], cards: [{ strokes: "[-1]" }] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [], cards: [{ strokes: '["4"]' }] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [], cards: [{ strokes: "oops" }] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [], cards: [{ strokes: "{}" }] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: "oops" }], cards: [{ strokes: "[]" }] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: "{}" }], cards: [] })).toBe(false);
  });
});

describe("a cut that changes nothing", () => {
  it("top 16 of 16 advances everyone; top 16 of 17 does not", () => {
    expect(cutAdvancesEveryone(rule({ count: 16 }), 16)).toBe(true);
    expect(cutAdvancesEveryone(rule({ count: 16 }), 17)).toBe(false);
    expect(cutAdvancesEveryone(rule({ count: 16 }), 0)).toBe(false);
  });

  it("per flight it is the largest flight that must be cleared", () => {
    // Flights of 20 and 4, top 10 each: the 20 loses ten, so it bites (the smallest would say no).
    expect(cutAdvancesEveryone(rule({ scope: "perFlight", count: 10 }), 24, [20, 4])).toBe(false);
    expect(cutAdvancesEveryone(rule({ scope: "perFlight", count: 16 }), 40, [5, 16])).toBe(true);
    // Without flight sizes, or with none, the field is the size.
    expect(cutAdvancesEveryone(rule({ scope: "perFlight", count: 10 }), 8)).toBe(true);
    expect(cutAdvancesEveryone(rule({ scope: "perFlight", count: 10 }), 8, [])).toBe(true);
    // An overall cut ignores flight sizes.
    expect(cutAdvancesEveryone(rule({ count: 10 }), 30, [5, 5])).toBe(false);
  });
});

describe("the setup screen's one line", () => {
  it("a percentage", () => {
    expect(describeCut(rule({ mode: "percent", percent: 25 }), 10, 0)).toBe("Top 25% of the field advances — 3 of 10.");
    expect(describeCut(rule({ scope: "perFlight", mode: "percent", percent: 25 }), 10, 2)).toBe("Top 25% of each flight advances.");
    // Per flight with no flights is the field.
    expect(describeCut(rule({ scope: "perFlight", mode: "percent", percent: 25 }), 10, 0)).toBe("Top 25% of the field advances — 3 of 10.");
  });

  it("a count, clamped to the field", () => {
    expect(describeCut(rule({ count: 8 }), 20, 0)).toBe("Top 8 of 20 advances.");
    expect(describeCut(rule({ count: 8 }), 5, 3)).toBe("Top 5 of 5 advances.");
    expect(describeCut(rule({ scope: "perFlight", count: 4 }), 10, 3)).toBe("Top 4 from each of the 3 flights advances — 10 in total.");
    expect(describeCut(rule({ scope: "perFlight", count: 2 }), 10, 3)).toBe("Top 2 from each of the 3 flights advances — 6 in total.");
    expect(describeCut(rule({ scope: "perFlight", count: 2 }), 10, 0)).toBe("Top 2 of 10 advances.");
  });
});

describe("whether the line fell between two scores", () => {
  const r = (points: number, advancing: boolean) => ({ points, advancing });

  it("level on the line is a countback; a gap is not", () => {
    expect(cutSettledOnCountback([r(12, true), r(10.5, true), r(10.5, false), r(9, false)])).toBe(true);
    expect(cutSettledOnCountback([r(12, true), r(10.5, true), r(10, false)])).toBe(false);
    // It is the LOWEST through against the HIGHEST out.
    expect(cutSettledOnCountback([r(12, true), r(11, true), r(12, false)])).toBe(false);
    expect(cutSettledOnCountback([r(12, true), r(10.5, true), r(11, false), r(10.5, false)])).toBe(false);
    expect(cutSettledOnCountback([r(12, true), r(10.5, true), r(10.5, false), r(11, false)])).toBe(false);
  });

  it("with nobody on one side there is no line", () => {
    expect(cutSettledOnCountback([r(10, true), r(10, true)])).toBe(false);
    expect(cutSettledOnCountback([r(10, false), r(10, false)])).toBe(false);
    expect(cutSettledOnCountback([])).toBe(false);
  });
});

describe("where a cut line may be drawn", () => {
  const a = (...f: boolean[]) => f.map((advancing) => ({ advancing }));

  it("under the last advancing row when everything above it advances", () => {
    expect(cutLineIndex(a(true, true, false, false))).toBe(1);
    expect(cutLineIndex(a(true, false))).toBe(0);
  });

  it("not at all when a row above the last advancing one does not, or when nobody or everybody does", () => {
    expect(cutLineIndex(a(true, false, true, false))).toBeNull();
    expect(cutLineIndex(a(false, true))).toBeNull();
    expect(cutLineIndex(a(false, true, false))).toBeNull();
    expect(cutLineIndex(a(true, true))).toBeNull();
    expect(cutLineIndex(a(false, false))).toBeNull();
    expect(cutLineIndex([])).toBeNull();
  });
});

describe("the qualifying line as a person reads it", () => {
  const fmt = (n: number) => `<${n}>`;

  it("a score to par: E, plus, minus", () => {
    expect(qualifyingCutoffText({ kind: "toPar", value: 0 }, fmt)).toBe("E");
    expect(qualifyingCutoffText({ kind: "toPar", value: 16 }, fmt)).toBe("+16");
    expect(qualifyingCutoffText({ kind: "toPar", value: -2 }, fmt)).toBe("-2");
  });

  it("points go through the writer given", () => {
    expect(qualifyingCutoffText({ kind: "stableford", value: 31 }, fmt)).toBe("<31> pts");
    expect(qualifyingCutoffText({ kind: "pts", value: 10.5 }, fmt)).toBe("<10.5> pts");
  });

  it("no line is a dash", () => {
    expect(qualifyingCutoffText(null, fmt)).toBe("—");
  });
});
