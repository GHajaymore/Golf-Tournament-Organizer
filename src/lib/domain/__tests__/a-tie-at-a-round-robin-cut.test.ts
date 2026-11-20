import { describe, it, expect } from "vitest";
import { computeStandings } from "../standings";
import {
  roundRobinCutOutcome,
  tableCutLineRows,
  roundHasSomethingToCutOn,
  cutTieRuleWords,
  type CutStageFields,
} from "../cut";
import { DEFAULT_SCORING, type HoleResult, type Match, type Player } from "../types";

/**
 * A TIE FOR THE LAST PLACE AT A ROUND ROBIN'S CUT (J31, 2026-11-06).
 *
 * The committee decides how a tie at a qualifying line is settled, and says so
 * in the Terms of the Competition before play — Rules of Golf, Committee
 * Procedures 5A(6), "Deciding ties"; for a field qualifying into match play the
 * draw itself is 5A(7). Nothing in the Rules lets the order a table happens to
 * be printed in — past the tie-breaks, the order players entered — decide it,
 * which is what the cut did until this (`regroup.ts`, `survivors` on the
 * table's list).
 *
 * It is the stroke cut's rule (#932) asked of a table: everybody level goes
 * through (the default — "the leading N and ties", which a round robin or a
 * medal after it can take, its field being any size), a play-off the
 * committee records, or a countback then a draw by lot the committee records.
 * On a table "level" is level on POINTS, and the countback is the TABLE'S OWN
 * tie-breaks in the order the committee set for the round — here the default:
 * head-to-head, holes won less lost, fewest holes lost. A handicap is not a
 * result and separates nobody (`rankPlayers`).
 *
 * WORKED BY HAND, not by the code's route: each match below is a single hole
 * won (1 up) or all square, so every player's points, holes won and holes lost
 * are counted off the list of results in the comment, and each expectation is
 * a literal. Scoring is the app's default — win 2, halve 1, loss 0.
 */

const H = (first: HoleResult): HoleResult[] => [first, ...new Array<HoleResult>(17).fill("H")];
const halved = (): HoleResult[] => new Array<HoleResult>(18).fill("H");
let n = 0;
const match = (a: string, b: string, holes: HoleResult[]): Match => ({
  id: `m${++n}`,
  stageId: "r1",
  groupId: "g1",
  round: 1,
  playerAId: a,
  playerBId: b,
  holes,
});
/** Handicaps in the order that would put the WRONG player through on handicap. */
const field: Player[] = [
  { id: "ann", name: "Ann", handicap: 4, seed: 1, groupId: "g1" },
  { id: "bea", name: "Bea", handicap: 9, seed: 2, groupId: "g1" },
  { id: "cat", name: "Cat", handicap: 2, seed: 3, groupId: "g1" },
  { id: "dot", name: "Dot", handicap: 6, seed: 4, groupId: "g1" },
  { id: "eve", name: "Eve", handicap: 7, seed: 5, groupId: "g1" },
];
const nameOf = (id: string) => field.find((p) => p.id === id)!.name;
const names = (ids: Iterable<string>) => [...ids].map(nameOf).sort();

const cut = (count: number, cutTies: string, decisions: unknown[] = []): CutStageFields => ({
  cutScope: "overall",
  cutMode: "count",
  cutCount: count,
  cutPercent: 50,
  cutTies,
  cutTieDecisions: JSON.stringify(decisions),
});

/**
 * TABLE ONE — Bea and Cat level on points for the second place; Bea beat Cat.
 *
 *   Ann b Bea, Ann b Cat, Ann b Dot, Ann b Eve      Ann 4 wins          8 pts
 *   Bea b Cat, Bea b Dot, Eve b Bea                 Bea 2 wins, 2 lost  4 pts
 *   Cat b Dot, Cat b Eve                            Cat 2 wins, 2 lost  4 pts
 *   Dot b Eve                                       Dot 1 win           2 pts
 *                                                   Eve 1 win           2 pts
 *
 * Top 2. Ann is through on 8; Bea and Cat are level on 4 for the last place;
 * head-to-head (the first tie-break) puts Bea above Cat.
 */
const tableOne = computeStandings(
  field,
  [
    match("ann", "bea", H("A")),
    match("ann", "cat", H("A")),
    match("ann", "dot", H("A")),
    match("ann", "eve", H("A")),
    match("bea", "cat", H("A")),
    match("bea", "dot", H("A")),
    match("bea", "eve", H("B")),
    match("cat", "dot", H("A")),
    match("cat", "eve", H("A")),
    match("dot", "eve", H("A")),
  ],
  DEFAULT_SCORING,
);

/**
 * TABLE TWO — nothing a player DID separates Bea and Cat.
 *
 *   Ann b everybody                                 Ann 8 pts
 *   Eve b Bea, Eve b Cat; Dot b Eve                 Eve 4 pts
 *   Bea halved Cat; Bea b Dot; lost to Ann, Eve     Bea 3 pts, won 1 hole, lost 2
 *   Cat halved Bea; Cat b Dot; lost to Ann, Eve     Cat 3 pts, won 1 hole, lost 2
 *   Dot b Eve; lost to Ann, Bea, Cat                Dot 2 pts
 *
 * Top 3. Bea and Cat are level on 3 for the last place, halved their meeting,
 * and have the same holes won and lost: the table's tie-breaks run out, and
 * only the handicap — which is not a result — would split them.
 */
const tableTwo = computeStandings(
  field,
  [
    match("ann", "bea", H("A")),
    match("ann", "cat", H("A")),
    match("ann", "dot", H("A")),
    match("ann", "eve", H("A")),
    match("bea", "cat", halved()),
    match("bea", "dot", H("A")),
    match("bea", "eve", H("B")),
    match("cat", "dot", H("A")),
    match("cat", "eve", H("B")),
    match("dot", "eve", H("A")),
  ],
  DEFAULT_SCORING,
);

describe("the tables, worked by hand (the absolute rows)", () => {
  it("table one: Bea and Cat on 4 points, Bea placed above Cat on head-to-head", () => {
    const row = (id: string) => tableOne.find((r) => r.player.id === id)!;
    expect([row("ann").stats.totalPoints, row("bea").stats.totalPoints, row("cat").stats.totalPoints]).toEqual([8, 4, 4]);
    expect([row("ann").rank, row("bea").rank, row("cat").rank]).toEqual([1, 2, 3]);
    expect(tableCutLineRows(tableOne).find((r) => r.id === "bea")).toEqual({ id: "bea", groupId: "g1", rank: 2, score: 4 });
  });

  it("table two: Bea and Cat on 3 points, one hole won and two lost each, SHARING third", () => {
    const row = (id: string) => tableTwo.find((r) => r.player.id === id)!;
    expect([row("bea").stats.totalPoints, row("bea").stats.holesWon, row("bea").stats.holesLost]).toEqual([3, 1, 2]);
    expect([row("cat").stats.totalPoints, row("cat").stats.holesWon, row("cat").stats.holesLost]).toEqual([3, 1, 2]);
    expect([row("ann").rank, row("eve").rank, row("bea").rank, row("cat").rank, row("dot").rank]).toEqual([1, 2, 3, 3, 5]);
  });
});

describe("the default — everybody level on points for the last place goes through (5A(6))", () => {
  it("top 2 of table one sends three: Ann, and both players on 4", () => {
    const out = roundRobinCutOutcome(tableOne, cut(2, "ties"));
    expect(names(out.through)).toEqual(["Ann", "Bea", "Cat"]);
    expect(out.undecided).toEqual([]);
  });

  it("even where the tie-breaks split them: level means level on POINTS", () => {
    // Cat lost the head-to-head and is still level on points — "and ties" is a
    // promise about the points, which the rules sheet prints.
    expect(roundRobinCutOutcome(tableOne, cut(2, "ties")).through.has("cat")).toBe(true);
  });

  it("CONTROL: a line that falls in a gap takes exactly N", () => {
    expect(names(roundRobinCutOutcome(tableOne, cut(3, "ties")).through)).toEqual(["Ann", "Bea", "Cat"]);
    expect(names(roundRobinCutOutcome(tableOne, cut(1, "ties")).through)).toEqual(["Ann"]);
  });

  it("the words are the table's", () => {
    expect(cutTieRuleWords("ties", "table")).toBe("Everybody level on points for the last place goes through");
    expect(cutTieRuleWords("countback", "table")).not.toMatch(/last 9/);
    expect(cutTieRuleWords("countback", "card")).toMatch(/last 9, 6, 3/);
  });
});

describe("a play-off — the players level on points play off, and the committee records it", () => {
  it("holds the last place: Ann through, Bea and Cat owed a play-off for one place", () => {
    const out = roundRobinCutOutcome(tableOne, cut(2, "playoff"));
    expect(names(out.through)).toEqual(["Ann"]);
    expect(out.undecided).toEqual([{ groupId: null, playerIds: ["bea", "cat"], places: 1, by: "playoff" }]);
  });

  it("is not the head-to-head: the play-off's winner goes through, even the one it placed lower", () => {
    const out = roundRobinCutOutcome(tableOne, cut(2, "playoff", [{ tied: ["cat", "bea"], through: ["cat"] }]));
    expect(names(out.through)).toEqual(["Ann", "Cat"]);
    expect(out.undecided).toEqual([]);
    expect(out.decided).toEqual([{ groupId: null, playerIds: ["bea", "cat"], places: 1, by: "playoff", through: ["cat"] }]);
  });

  it("a decision about OTHER players settles nothing (a corrected result changed the tie)", () => {
    const out = roundRobinCutOutcome(tableOne, cut(2, "playoff", [{ tied: ["bea", "dot"], through: ["dot"] }]));
    expect(names(out.through)).toEqual(["Ann"]);
    expect(out.undecided).toHaveLength(1);
  });
});

describe("a countback — the table's tie-breaks, then a draw by lot", () => {
  it("where the tie-breaks separate them, they decide it: Bea beat Cat", () => {
    const out = roundRobinCutOutcome(tableOne, cut(2, "countback"));
    expect(names(out.through)).toEqual(["Ann", "Bea"]);
    expect(out.undecided).toEqual([]);
  });

  it("where they run out, lots are drawn — never the handicap, never the entry order", () => {
    // Cat has the lower handicap and Bea the earlier entry: neither decides it.
    const out = roundRobinCutOutcome(tableTwo, cut(3, "countback"));
    expect(names(out.through)).toEqual(["Ann", "Eve"]);
    // In the table's order — the handicap ORDERS the list (Cat, 2, before Bea,
    // 9) without deciding anything, which is the whole point.
    expect(out.undecided).toEqual([{ groupId: null, playerIds: ["cat", "bea"], places: 1, by: "draw" }]);
    const drawn = roundRobinCutOutcome(tableTwo, cut(3, "countback", [{ tied: ["bea", "cat"], through: ["bea"] }]));
    expect(names(drawn.through)).toEqual(["Ann", "Bea", "Eve"]);
  });
});

describe("nothing entered is nothing to cut on (`roundHasSomethingToCutOn`, the board's and the draw's one predicate)", () => {
  const blank = JSON.stringify(new Array(18).fill(null));
  it("a round drawn and unplayed has nothing; one hole of any kind is something", () => {
    expect(roundHasSomethingToCutOn({ matches: [{ holes: blank }, { holes: blank }], cards: [] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [], cards: [] }), "an empty round").toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: JSON.stringify(H("A")) }], cards: [] })).toBe(true);
    // A HALVE is a result — the draw has always cut on it, and the board's
    // table reading (no hole won, no match over, points level) did not see it.
    const halvedOnly = JSON.stringify(["H", "H", ...new Array(16).fill(null)]);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: halvedOnly }], cards: [] })).toBe(true);
  });
  it("a concession, and a stroke on a card filed for the round, are something; blanks and rubbish are not", () => {
    expect(roundHasSomethingToCutOn({ matches: [{ holes: blank, forfeitedBy: "A" }], cards: [] })).toBe(true);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: blank, forfeitedBy: "" }], cards: [] })).toBe(false);
    expect(roundHasSomethingToCutOn({ matches: [], cards: [{ strokes: JSON.stringify([4, null]) }] })).toBe(true);
    expect(roundHasSomethingToCutOn({ matches: [{ holes: "not json" }], cards: [{ strokes: "[]" }, { strokes: "[0,null]" }] })).toBe(false);
  });
});
