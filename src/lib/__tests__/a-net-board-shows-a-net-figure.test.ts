import { describe, it, expect } from "vitest";
import { rankedScore, unitIsNet, type RankedRow } from "@/lib/domain/ranked-score";

/**
 * THE NUMBER ON A BOARD HAS TO EXPLAIN THE ORDER OF THE BOARD.
 *
 * Found on 2026-09-22 by opening the PUBLIC share link — the one a club sends
 * its members — for the seeded club's April Medal. The board was headed
 * "Ranked by net strokes", was sorted correctly on net, and printed the GROSS
 * to-par on every row:
 *
 *     1  Marnie     gross 81   net 53    shown  +10
 *     2  Hattie           80       61    shown   +9
 *     3  Nkechi           70       63    shown   -1
 *     4  Priyanka         91       65    shown  +20
 *
 * A member reads the leader at +10, third place at -1 and fourth at +20, and
 * there is nothing on the screen that reconciles them. Both figures were
 * individually right; nothing compared them. That is the class CLAUDE.md says
 * only eyes on real rows ever find — and it is the same fault `ranked-score.ts`
 * already records for match play in its own docstring: "a board headed 'Ranked
 * by match points', sorted by match points, with no match points on it."
 *
 * These are the REAL rows, and the assertion that matters is the last one in
 * the first block: the printed figures must ascend. A test that only checked
 * one row's arithmetic would pass just as happily on a board nobody can read.
 */

const PAR = 71;

/** The four rows off the seeded club's April Medal, as the board received them. */
const MEDAL: Array<{ name: string; gross: number; net: number }> = [
  { name: "Marnie", gross: 81, net: 53 },
  { name: "Hattie", gross: 80, net: 61 },
  { name: "Nkechi", gross: 70, net: 63 },
  { name: "Priyanka", gross: 91, net: 65 },
];

const row = (over: Partial<RankedRow> = {}): RankedRow => ({
  pts: "",
  points: 0,
  toPar: 0,
  thru: 18,
  holesOwed: 18,
  started: true,
  ...over,
});

const medalRow = (p: (typeof MEDAL)[number]) =>
  row({ gross: p.gross, net: p.net, toPar: p.gross - PAR });

const num = (s: string) => (s === "E" ? 0 : Number(s.replace("+", "")));

describe("a net board shows a net figure", () => {
  it("prints net to par, not gross to par", () => {
    const shown = MEDAL.map((p) => rankedScore(medalRow(p), { isStroke: true, isNet: true }).text);
    expect(shown).toEqual(["-18", "-10", "-8", "-6"]);
  });

  /**
   * THE ASSERTION THAT IS ACTUALLY ABOUT THE DEFECT. The board is sorted by
   * net, so the figures it prints must ascend down the page. Before the fix
   * they ran +10, +9, -1, +20 — each correct, together unreadable.
   */
  it("prints figures that ascend down a board sorted by net", () => {
    const shown = MEDAL.map((p) => num(rankedScore(medalRow(p), { isStroke: true, isNet: true }).text));
    for (let i = 1; i < shown.length; i += 1) {
      expect(shown[i], `row ${i + 1} (${MEDAL[i].name}) must not be better than row ${i}`).toBeGreaterThanOrEqual(shown[i - 1]);
    }
  });

  it("agrees with net minus the round's par", () => {
    // The independent reading: net to par IS net minus par. Asserting the
    // formula against the RULE rather than against itself.
    for (const p of MEDAL) {
      const shown = num(rankedScore(medalRow(p), { isStroke: true, isNet: true }).text);
      expect(shown, p.name).toBe(p.net - PAR);
    }
  });
});

describe("and nothing else changes", () => {
  it("leaves a gross board on gross to par", () => {
    // The Club Championship is "36 Holes Gross" and its board was correct.
    const shown = MEDAL.map((p) => rankedScore(medalRow(p), { isStroke: true, isNet: false }).text);
    expect(shown).toEqual(["+10", "+9", "-1", "+20"]);
  });

  it("leaves a Stableford board on points", () => {
    const r = row({ points: 21, gross: 80, net: 61, toPar: 9 });
    expect(rankedScore(r, { isStroke: true, isStableford: true, isNet: true }).text).toBe("21");
  });

  it("leaves a match board on match points", () => {
    const r = row({ pts: "10.5", gross: 80, net: 61 });
    expect(rankedScore(r, { isStroke: false, isNet: true }).text).toBe("10.5");
  });

  it("still refuses a round with no par to be under", () => {
    const r = row({ parKnown: false, gross: 80, net: 61, toPar: 80 });
    expect(rankedScore(r, { isStroke: true, isNet: true }).text).toBe("–");
  });

  /**
   * The guard that matters most on a PUBLIC page. A caller that has not
   * supplied gross and net must fall back to the gross reading rather than
   * subtract `undefined` and print NaN to a club's members.
   */
  it("falls back to gross rather than printing NaN when the figures are absent", () => {
    const r = row({ toPar: 4 });
    expect(rankedScore(r, { isStroke: true, isNet: true }).text).toBe("+4");
  });

  it("keeps level par as a real answer", () => {
    const r = row({ gross: 71, net: 71, toPar: 0 });
    expect(rankedScore(r, { isStroke: true, isNet: true }).text).toBe("E");
  });
});

describe("the figure follows the caption", () => {
  /**
   * The defect was a caption and a number disagreeing, so the number is chosen
   * FROM the caption. These pin that the two cannot drift apart again.
   */
  it.each([
    ["net strokes", true],
    ["gross strokes", false],
    ["Stableford points", false],
    ["match points", false],
    ["", false],
    [undefined, false],
  ])("reads %s as net=%s", (unit, expected) => {
    expect(unitIsNet(unit as string | undefined)).toBe(expected);
  });
});
