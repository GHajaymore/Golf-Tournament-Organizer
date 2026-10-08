import { describe, it, expect } from "vitest";
import { buildBracket } from "@/lib/domain/bracket";
import { isStraightKnockout } from "@/lib/stage-types";
import { readSource } from "./source";
import type { Player } from "@/lib/domain/types";

/**
 * A BYE SAYS "BYE" (2026-10-08).
 *
 * Walked as the tournament grid's knockout of five. Every empty slot printed
 * "TBD", so the opening round read "Alder 1 v TBD", "Cedar 3 v TBD", "Briar 2 v
 * TBD" beside the one real match — three opponents "to be decided" who do not
 * exist. "TBD" is right for a slot waiting on a result, and wrong for one that
 * can never be filled.
 */
const field = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, handicap: i, seed: i + 1 }));

const names = (m: { a: { name: string }; b: { name: string } }) => [m.a.name, m.b.name];

describe("a knockout of five", () => {
  const view = buildBracket("winners", field(5), {});
  const [qf, sf, final] = view.rounds;

  it("prints Bye against the three top seeds, and the one real tie as a tie", () => {
    // 1 v 8, 4 v 5, 3 v 6, 2 v 7 — seeds 6, 7 and 8 do not exist.
    expect(qf.matches.map(names)).toEqual([
      ["P1", "Bye"],
      ["P4", "P5"],
      ["P3", "Bye"],
      ["P2", "Bye"],
    ]);
  });

  it("still says TBD where somebody IS coming — the control", () => {
    // P1 waits on the winner of 4 v 5: that opponent exists, undecided.
    expect(names(sf.matches[0])).toEqual(["P1", "TBD"]);
    expect(names(sf.matches[1])).toEqual(["P3", "P2"]);
    expect(names(final.matches[0])).toEqual(["TBD", "TBD"]);
  });
});

describe("where an empty slot is not a bye", () => {
  it("an undrawn bracket is all TBD, not a bracket of byes", () => {
    const view = buildBracket("winners", [], {});
    const all = view.rounds.flatMap((r) => r.matches.flatMap(names));
    expect(all.every((n) => n === "TBD")).toBe(true);
  });

  it("a plate still filling from results keeps TBD", () => {
    // Three losers known of four to come: the fourth slot is somebody not yet
    // known, not nobody.
    const view = buildBracket("consolation", field(3), {}, false);
    expect(view.rounds[0].matches.flatMap(names)).not.toContain("Bye");
    expect(view.rounds[0].matches.flatMap(names)).toContain("TBD");
  });
});

describe("a straight knockout ranks nobody on Today", () => {
  it("is the draw as the first round, and only that", () => {
    expect(isStraightKnockout([{ type: "Bracket Stage" }])).toBe(true);
    expect(isStraightKnockout([{ type: "Stroke Play Round" }, { type: "Bracket Stage" }])).toBe(false);
    expect(isStraightKnockout([{ type: "Stroke Play Round" }])).toBe(false);
  });

  it("Today asks it before building a leaders table", () => {
    // A member of a knockout of five read "QUALIFYING" over the whole field as
    // "Not ranked · not started" — a table for a tournament with no qualifying.
    const src = readSource("src/app/(player)/me/page.tsx");
    const at = src.indexOf("const boardRows =");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, src.indexOf("standingRows(state)", at))).toMatch(/!isStraightKnockout\(state\.stages\)/);
  });
});
