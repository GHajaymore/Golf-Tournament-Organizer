import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource, stripComments } from "./source";
import { heldFromBoard, onBoard, cardsOnBoard } from "../domain/board-hold";

/**
 * A DISPUTED RESULT IS HELD OFF THE BOARD BY ONE RULE (2026-11-04).
 *
 * `a-disputed-result-stays-off-the-board.audit.test.ts` proved the defect on
 * real rows: the final result skipped a disputed card with
 * `c.status !== "disputed"` written inline, and the live board — a different
 * reader — did not, so the two named different winners. A rule spelled at the
 * one reader that remembered it is the shape that breaks; `heldFromBoard` in
 * domain/board-hold.ts is the one place it lives.
 *
 * Three parts, as "One rule, one place" asks:
 *   1. the rule itself, pinned to what a dispute IS (Rule 20.2c: the
 *      Committee decides; until then the result is not one);
 *   2. every standings reader named below goes through it;
 *   3. no service spells the exclusion for itself — with a control proving the
 *      sweep can see one.
 */

describe("the rule", () => {
  it("holds a disputed card or match, and nothing else", () => {
    expect(heldFromBoard("disputed")).toBe(true);
    for (const s of ["entered", "certified", "approved", "pending", "confirmed", "auto-confirmed", "", null, undefined]) {
      expect(heldFromBoard(s), String(s)).toBe(false);
    }
  });

  it("a held match is read as not yet played, forfeit included; any other is untouched", () => {
    const m = { scoreStatus: "disputed", holes: '["A","A"]', forfeitedBy: "p1", id: "x" };
    expect(onBoard(m)).toEqual({ scoreStatus: "disputed", holes: "[]", forfeitedBy: "", id: "x" });
    const ok = { ...m, scoreStatus: "pending" };
    expect(onBoard(ok)).toBe(ok);
    // A select without forfeitedBy is not given one.
    expect("forfeitedBy" in onBoard({ scoreStatus: "disputed", holes: "[]" })).toBe(false);
  });

  it("cardsOnBoard drops only the disputed card", () => {
    const cards = [{ status: "approved" }, { status: "disputed" }, { status: "entered" }];
    expect(cardsOnBoard(cards)).toEqual([{ status: "approved" }, { status: "entered" }]);
  });
});

/** The readers that rank or score a round. Each asks the rule. */
const BOARD_READERS = [
  "src/lib/services/tournament.ts", // the live board, console and public
  "src/lib/services/tournament-result.ts", // the day's result
  "src/lib/services/week-view.ts", // a league week's sheet
  "src/lib/services/points-standings.ts", // skins, modified Stableford, Nassau
  "src/lib/services/round-cards.ts", // the report's and money's cards
  "src/lib/services/cup.ts", // a cup's points
  "src/lib/services/teams.ts", // sides ranked on their matches
  "src/lib/services/league.ts", // interclub league points
];

/** The inline exclusion, in the spellings it has had. */
const INLINE = /(status|scoreStatus)\s*!==?\s*["']disputed["']/;

function inlineExclusions(src: string): boolean {
  return INLINE.test(stripComments(src));
}

describe("every standings reader asks the rule", () => {
  it.each(BOARD_READERS)("%s imports it from domain/board-hold", (file) => {
    const src = readSource(file);
    expect(src, `${file} ranks results without asking heldFromBoard`).toMatch(/from ["'](\.\.\/domain|@\/lib\/domain)\/board-hold["']/);
    // And USES it — not only imports it (the import line itself is set aside).
    const body = src.replace(/^import[^;]*;/gm, "");
    expect(body, `${file} imports the rule and never asks it`).toMatch(/\b(heldFromBoard|onBoard|cardsOnBoard)\b/);
  });

  it("no service spells the exclusion for itself", () => {
    const offenders = readdirSync("src/lib/services")
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => inlineExclusions(readSource("src/lib/services", f)));
    expect(offenders, "say heldFromBoard / cardsOnBoard / onBoard instead").toEqual([]);
  });

  it("CONTROL: the sweep sees an inline exclusion, and not one in a comment", () => {
    expect(inlineExclusions(`rows.filter((c) => c.status !== "disputed")`)).toBe(true);
    expect(inlineExclusions(`m.scoreStatus != 'disputed'`)).toBe(true);
    expect(inlineExclusions(`// c.status !== "disputed" was the old way\nrows.filter(Boolean)`)).toBe(false);
  });
});
