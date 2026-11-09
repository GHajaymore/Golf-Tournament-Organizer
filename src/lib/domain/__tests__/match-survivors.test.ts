// Mutation survivors of `domain/match.ts` (J49, 2026-11-09): match play as the Rules of Golf write it.
//
// Every figure below is worked by hand from Rule 3.2 (a match is won by the side that is ahead by
// more holes than remain — Rule 3.2a(3); a hole is won by the side with the lower net score, halved
// if equal — Rule 3.2b; the state of a match is "N up", "all square" or "dormie" — Rule 3.2a), never
// copied from what the code printed. Handicap strokes: Rule 21 / Appendix C — the higher handicap
// receives the whole difference, on the holes with the lowest stroke index first.

import { describe, expect, it } from "vitest";
import {
  countedHoles,
  deriveNetHoles,
  marginRefusal,
  marginToHoles,
  matchIsOver,
  matchIsOverAfter,
  matchStandingText,
  matchStrokesGiven,
  namesAreDistinct,
  parseHolesTranscript,
  parseResultTranscript,
  resolveMatch,
  storedMatchIsOver,
} from "../match";
import type { HoleResult } from "../types";

/** Build a card from a compact string: A, B, H, and "." for a hole not yet played. */
function card(s: string): HoleResult[] {
  return s.split("").map((c) => (c === "." ? null : (c as "A" | "B" | "H")));
}

describe("resolveMatch — Rule 3.2a(3): over when one side leads by more holes than remain", () => {
  it("an untouched card (no holes) has nothing to play: all square, played 0", () => {
    const r = resolveMatch([]);
    expect(r).toEqual({
      played: 0, remaining: 0, lead: 0, holesWonA: 0, holesWonB: 0,
      complete: true, winner: "H", resultText: "AS",
    });
  });

  it("3 up after 16 of 18 is 3&2 and the 17th and 18th, lost by the winner, do not count", () => {
    // holes 1-3 A (3 up, 15 left), 4-16 halved: after 16 played, 3 up with 2 to play: 3 > 2.
    const holes = card("AAAHHHHHHHHHHHHH" + "BB");
    const r = resolveMatch(holes);
    expect(r.complete).toBe(true);
    expect(r.winner).toBe("A");
    expect(r.resultText).toBe("3&2");
    expect(r.played).toBe(16);
    expect(r.remaining).toBe(2);
    expect(r.lead).toBe(3);
    expect(r.holesWonA).toBe(3);
    expect(r.holesWonB).toBe(0);
  });

  it("B can win too: 4 up with 3 to play after 15 holes is 4&3 for B, lead negative", () => {
    const holes = card("BBBBHHHHHHHHHHH" + "AAA");
    const r = resolveMatch(holes);
    expect(r.winner).toBe("B");
    expect(r.resultText).toBe("4&3");
    expect(r.lead).toBe(-4);
    expect(r.holesWonB).toBe(4);
    expect(r.holesWonA).toBe(0);
    expect(r.played).toBe(15);
    expect(r.remaining).toBe(3);
  });

  it("2 up with 2 to play is DORMIE, not over: leading by exactly the holes left is not 'more'", () => {
    // 16 played: A wins 1 and 2, the rest halved
    const r = resolveMatch(card("AAHHHHHHHHHHHHHH" + ".."));
    expect(r.complete).toBe(false);
    expect(r.winner).toBeNull();
    expect(r.resultText).toBe("");
    expect(r.played).toBe(16);
    expect(r.remaining).toBe(2);
    expect(r.lead).toBe(2);
  });

  it("2 up with 2 to play, then the 17th halved: 2 up with 1 to play is over, 2&1", () => {
    const r = resolveMatch(card("AAHHHHHHHHHHHHHHH."));
    expect(r.complete).toBe(true);
    expect(r.resultText).toBe("2&1");
    expect(r.remaining).toBe(1);
    expect(r.played).toBe(17);
  });

  it("dormie 1 (1 up with 1 to play) is not over; the 18th halved gives 1 UP", () => {
    // A wins the 1st, halved to the 18th
    const live = resolveMatch(card("AHHHHHHHHHHHHHHHH."));
    expect(live.complete).toBe(false);
    expect(live.remaining).toBe(1);
    expect(live.lead).toBe(1);
    const done = resolveMatch(card("AHHHHHHHHHHHHHHHHH"));
    expect(done.complete).toBe(true);
    expect(done.winner).toBe("A");
    expect(done.resultText).toBe("1 UP");
    expect(done.remaining).toBe(0);
    expect(done.played).toBe(18);
  });

  it("2 UP after eighteen: all square after 16, A wins 17 and 18", () => {
    // After 17: 1 up with 1 to play (not over); after 18: 2 up, nothing left.
    const r = resolveMatch(card("HHHHHHHHHHHHHHHHAA"));
    expect(r.resultText).toBe("2 UP");
    expect(r.winner).toBe("A");
    expect(r.lead).toBe(2);
    expect(r.remaining).toBe(0);
  });

  it("B 1 UP on the last hole", () => {
    const r = resolveMatch(card("HHHHHHHHHHHHHHHHHB"));
    expect(r.winner).toBe("B");
    expect(r.resultText).toBe("1 UP");
    expect(r.lead).toBe(-1);
  });

  it("every hole halved is all square (AS), halved winner H", () => {
    const r = resolveMatch(card("HHHHHHHHHHHHHHHHHH"));
    expect(r).toMatchObject({ complete: true, winner: "H", resultText: "AS", lead: 0, played: 18, remaining: 0 });
  });

  it("all square through 18 after a win and a loss each is AS, not a win", () => {
    const r = resolveMatch(card("ABHHHHHHHHHHHHHHBA"));
    expect(r.winner).toBe("H");
    expect(r.resultText).toBe("AS");
    expect(r.holesWonA).toBe(2);
    expect(r.holesWonB).toBe(2);
  });

  it("a match in progress counts holes played and holes left, with no winner", () => {
    // 4 holes: A, halved, B, A -> A 2 holes, B 1 hole, 14 to play.
    const r = resolveMatch(card("AHBA" + "..............")) ;
    expect(r.complete).toBe(false);
    expect(r.winner).toBeNull();
    expect(r.resultText).toBe("");
    expect(r.played).toBe(4);
    expect(r.remaining).toBe(14);
    expect(r.lead).toBe(1);
    expect(r.holesWonA).toBe(2);
    expect(r.holesWonB).toBe(1);
  });

  it("nine holes: 5 up after 5 is 5&4", () => {
    const r = resolveMatch(card("AAAAA" + "...."));
    expect(r.resultText).toBe("5&4");
    expect(r.played).toBe(5);
    expect(r.remaining).toBe(4);
    expect(r.complete).toBe(true);
  });

  it("nine holes: 4 up after 4 with 5 left is NOT over (4 is not more than 5)", () => {
    const r = resolveMatch(card("AAAA" + "....."));
    expect(r.complete).toBe(false);
    expect(r.remaining).toBe(5);
  });

  it("a hole with no result stops the reading: nothing past it can prove a closeout", () => {
    // Hole 1 not recorded; the others are A. Eight holes won, one to play — but hole 1 is unknown.
    const r = resolveMatch(card(".AAAAAAAA"));
    expect(r.complete).toBe(false);
    expect(r.winner).toBeNull();
    expect(r.played).toBe(8);
    expect(r.remaining).toBe(1);
    expect(r.lead).toBe(8);
  });

  it("a gap in the middle stops the scan at the gap: 2 up with the 3rd missing", () => {
    // 5 holes: A, A, gap, A, A. Before the gap 2 up with 3 to play: not over. Past the gap is not read.
    const r = resolveMatch(card("AA.AA"));
    expect(r.complete).toBe(false);
    expect(r.played).toBe(4);
    expect(r.remaining).toBe(1);
    expect(r.lead).toBe(4);
  });

  it("a hole won on the very last hole from all square is a 1 UP closeout with nothing remaining", () => {
    const r = resolveMatch(card("HHHHHHHHA"));
    expect(r.complete).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.resultText).toBe("1 UP");
  });

  it("holes lost by the eventual winner count against the lead: A 3 up, B wins 2, A 1 up", () => {
    // 9 holes: A A A B B H H H H -> final lead 1, all nine played.
    const r = resolveMatch(card("AAABBHHHH"));
    expect(r.lead).toBe(1);
    expect(r.holesWonA).toBe(3);
    expect(r.holesWonB).toBe(2);
    expect(r.resultText).toBe("1 UP");
  });
});

describe("countedHoles — the holes that count end at the closeout", () => {
  it("a 3&2 card of 18 counts 16 holes", () => {
    const holes = card("AAAHHHHHHHHHHHHH" + "BB");
    expect(countedHoles(holes)).toHaveLength(16);
    expect(countedHoles(holes)).toEqual(holes.slice(0, 16));
  });

  it("a match nobody closed out is returned unchanged (the same card)", () => {
    const holes = card("HHHHHHHHHHHHHHHHHH");
    expect(countedHoles(holes)).toBe(holes);
  });

  it("an unfinished card is returned unchanged", () => {
    const holes = card("AB" + "................");
    expect(countedHoles(holes)).toBe(holes);
  });

  it("a closeout at the first hole it is possible: 5&4 over nine holes counts 5", () => {
    const holes = card("AAAAAAAAA");
    expect(countedHoles(holes)).toHaveLength(5);
  });
});

describe("matchIsOver — decided, not merely started", () => {
  it("is false for a card nobody has touched, empty or all unplayed", () => {
    expect(matchIsOver([])).toBe(false);
    expect(matchIsOver(card(".................."))).toBe(false);
  });

  it("is false for one hole on a card of eighteen", () => {
    expect(matchIsOver(card("A" + "................."))).toBe(false);
  });

  it("is true once a side leads by more than remain (3&2), true when all holes are played", () => {
    expect(matchIsOver(card("AAAHHHHHHHHHHHHH.."))).toBe(true);
    expect(matchIsOver(card("HHHHHHHHHHHHHHHHHH"))).toBe(true);
  });

  it("is false while dormie", () => {
    expect(matchIsOver(card("AAHHHHHHHHHHHHHH.."))).toBe(false);
  });

  it("is true for a single played hole on a one-hole match", () => {
    expect(matchIsOver(card("A"))).toBe(true);
    expect(matchIsOver(card("H"))).toBe(true);
  });
});

describe("matchIsOverAfter — a list shorter than the round is padded, not read as fewer holes", () => {
  it("five wins in a list of five over eighteen is NOT over", () => {
    expect(matchIsOverAfter(card("AAAAA"), 18)).toBe(false);
  });

  it("five wins over a nine-hole round IS over (5&4)", () => {
    expect(matchIsOverAfter(card("AAAAA"), 9)).toBe(true);
  });

  it("an empty list is not over, whatever the round length", () => {
    expect(matchIsOverAfter([], 18)).toBe(false);
    expect(matchIsOverAfter([], 9)).toBe(false);
  });

  it("a full list is judged as it is: all eighteen halved is over", () => {
    expect(matchIsOverAfter(card("HHHHHHHHHHHHHHHHHH"), 18)).toBe(true);
  });

  it("holes past the list are unplayed: 3 up after 16 is over on 18, so is the card padded to 18 from 16", () => {
    expect(matchIsOverAfter(card("AAAHHHHHHHHHHHHH"), 18)).toBe(true);
  });
});

describe("storedMatchIsOver — a stored row", () => {
  it("a forfeit is decided even with no holes", () => {
    expect(storedMatchIsOver({ holes: "[]", forfeitedBy: "A" })).toBe(true);
    expect(storedMatchIsOver({ holes: "not json", forfeitedBy: "B" })).toBe(true);
  });

  it("no forfeit (null, undefined, empty) reads the holes", () => {
    const done = JSON.stringify(card("AAAHHHHHHHHHHHHH.."));
    expect(storedMatchIsOver({ holes: done, forfeitedBy: null })).toBe(true);
    expect(storedMatchIsOver({ holes: done })).toBe(true);
    expect(storedMatchIsOver({ holes: done, forfeitedBy: "" })).toBe(true);
    expect(storedMatchIsOver({ holes: "[]", forfeitedBy: null })).toBe(false);
    expect(storedMatchIsOver({ holes: "[]" })).toBe(false);
    expect(storedMatchIsOver({ holes: "[]", forfeitedBy: "" })).toBe(false);
  });

  it("an unreadable card is not a finished match", () => {
    expect(storedMatchIsOver({ holes: "{not json" })).toBe(false);
    expect(storedMatchIsOver({ holes: "" })).toBe(false);
  });
});

describe("marginRefusal — a result a match can really finish on (Rule 3.2a(3))", () => {
  it("a halved match carries no margin, whatever is in the box", () => {
    expect(marginRefusal("H", "", 18)).toBeNull();
    expect(marginRefusal("H", "nonsense", 18)).toBeNull();
    expect(marginRefusal("H", "7&1", 18)).toBeNull();
  });

  it("a named winner with an empty or blank box is asked for a margin", () => {
    expect(marginRefusal("A", "", 18)).toMatch(/^Say by how much/);
    expect(marginRefusal("B", "   ", 18)).toMatch(/^Say by how much/);
    expect(marginRefusal("A", undefined as unknown as string, 18)).toMatch(/^Say by how much/);
  });

  it("AS is refused for a winner, in any case", () => {
    expect(marginRefusal("A", "AS", 18)).toMatch(/^All square means nobody won/);
    expect(marginRefusal("A", "as", 18)).toMatch(/^All square means nobody won/);
    expect(marginRefusal("A", " as ", 18)).toMatch(/^All square means nobody won/);
  });

  it("closed-out margins a match can finish on are accepted: 2&1, 3&2, 3&1, 4&3, 5&4, 10&8", () => {
    for (const m of ["2&1", "3&2", "3&1", "4&3", "4&2", "5&4", "5&3", "6&5", "6&4", "10&8", "10&9"]) {
      // 10&9 is 19 holes' worth over 18: refused below, so skip it here
      if (m === "10&9") continue;
      expect(marginRefusal("A", m, 18)).toBeNull();
    }
  });

  it("is forgiving about spaces and case", () => {
    expect(marginRefusal("A", " 3 & 2 ", 18)).toBeNull();
    expect(marginRefusal("B", "3&2", 18)).toBeNull();
  });

  it("transposed 'N&M' where the winner is not ahead of the holes left is refused, with the swap suggested", () => {
    expect(marginRefusal("A", "2&3", 18)).toBe(
      '"2&3" isn\'t a possible result — 2 up with 3 to play isn\'t a closed-out match. Did you mean "3&2"?',
    );
    expect(marginRefusal("A", "2&2", 18)).toMatch(/2 up with 2 to play isn't a closed-out match/);
    expect(marginRefusal("A", "1&1", 18)).toMatch(/1 up with 1 to play/);
    // the typed text (trimmed), not the upper-cased copy, is quoted back
    expect(marginRefusal("A", "  2&3  ", 18)).toMatch(/^"2&3" isn't/);
  });

  it("'N&0' is a match that went the distance: write it as 'N UP'", () => {
    expect(marginRefusal("A", "1&0", 18)).toBe('"1&0" is a match that went the distance — write it "1 UP".');
    expect(marginRefusal("A", "3&0", 18)).toBe('"3&0" is a match that went the distance — write it "3 UP".');
  });

  it("a margin needing more holes than the round has cannot happen", () => {
    // 10 up with 9 to play is 19 holes' worth
    expect(marginRefusal("A", "10&9", 18)).toBe(`"10&9" can't happen over 18 holes.`);
    // over nine holes 6&4 needs ten
    expect(marginRefusal("A", "6&4", 9)).toBe(`"6&4" can't happen over 9 holes.`);
    // but exactly the round's length is fine: 5&4 over nine holes (nine holes' worth)
    expect(marginRefusal("A", "5&4", 9)).toBeNull();
    expect(marginRefusal("A", "4&3", 9)).toBeNull();
  });

  it("a margin more than two clear of the holes left was already over earlier", () => {
    // 4&1: the match was over at 3&2 (3 up with 2 left)
    expect(marginRefusal("A", "4&1", 18)).toBe(`"4&1" can't happen — a match 3 up with 2 to play is already over.`);
    // 6&3 was over at 5&4
    expect(marginRefusal("A", "6&3", 18)).toBe(`"6&3" can't happen — a match 5 up with 4 to play is already over.`);
    expect(marginRefusal("A", "7&4", 18)).toMatch(/a match 6 up with 5 to play is already over/);
    // the boundary: two clear is possible, three clear is not
    expect(marginRefusal("A", "3&1", 18)).toBeNull();
    expect(marginRefusal("A", "4&2", 18)).toBeNull();
    expect(marginRefusal("A", "5&2", 18)).not.toBeNull();
  });

  it("'1 UP' and '2 UP' are the margins of a match that went to the last green", () => {
    expect(marginRefusal("A", "1 UP", 18)).toBeNull();
    expect(marginRefusal("A", "2 UP", 18)).toBeNull();
    expect(marginRefusal("A", "1up", 18)).toBeNull();
    expect(marginRefusal("A", "2 up", 18)).toBeNull();
    expect(marginRefusal("A", " 2  UP ", 18)).toBeNull();
  });

  it("3 UP or more cannot be the margin at the end: 2 up with 1 to play is over (2&1)", () => {
    expect(marginRefusal("A", "3 UP", 18)).toBe(`"3 UP" can't happen — a match two up with one to play is over (2&1).`);
    expect(marginRefusal("A", "12 UP", 18)).toMatch(/can't happen/);
    expect(marginRefusal("B", "10 up", 18)).toMatch(/can't happen/);
  });

  it("anything else is not a margin: 0 UP, words, stray text round a good margin", () => {
    expect(marginRefusal("A", "0 UP", 18)).toBe(`"0 UP" isn't a margin — write it like "2&1" or "1 UP".`);
    expect(marginRefusal("A", "01 UP", 18)).toMatch(/isn't a margin/);
    expect(marginRefusal("A", "won easily", 18)).toBe(`"won easily" isn't a margin — write it like "2&1" or "1 UP".`);
    expect(marginRefusal("A", "x2&1", 18)).toMatch(/isn't a margin/);
    expect(marginRefusal("A", "2&1x", 18)).toMatch(/isn't a margin/);
    expect(marginRefusal("A", "x1 UP", 18)).toMatch(/isn't a margin/);
    expect(marginRefusal("A", "1 UPX", 18)).toMatch(/isn't a margin/);
    expect(marginRefusal("A", "2&", 18)).toMatch(/isn't a margin/);
    expect(marginRefusal("A", "&1", 18)).toMatch(/isn't a margin/);
    expect(marginRefusal("A", "-2&1", 18)).toMatch(/isn't a margin/);
  });
});

describe("marginToHoles — a typed result rebuilt as a card that reads back as the same result", () => {
  const readBack = (winner: "A" | "B", margin: string, total = 18) => resolveMatch(marginToHoles(winner, margin, total));

  it("halved is every hole halved, whatever margin is typed, over the round's length", () => {
    expect(marginToHoles("H", "3&2", 18)).toEqual(card("HHHHHHHHHHHHHHHHHH"));
    expect(marginToHoles("H", "", 9)).toEqual(card("HHHHHHHHH"));
  });

  it("2&1 for A: the lead is built as late as legal, the 18th unplayed", () => {
    expect(marginToHoles("A", "2&1", 18)).toEqual(card("HHHHHHHHHHHHHHHAA."));
  });

  it("3&2 for B puts B's three holes at the end of the 16 played", () => {
    expect(marginToHoles("B", "3&2", 18)).toEqual(card("HHHHHHHHHHHHHBBB.."));
  });

  it("1 UP for A and 2 UP for B", () => {
    expect(marginToHoles("A", "1 UP", 18)).toEqual(card("HHHHHHHHHHHHHHHHHA"));
    expect(marginToHoles("B", "2 UP", 18)).toEqual(card("HHHHHHHHHHHHHHHHBB"));
  });

  it("is forgiving about case and spaces", () => {
    expect(marginToHoles("A", " 2 & 1 ", 18)).toEqual(card("HHHHHHHHHHHHHHHAA."));
    expect(marginToHoles("A", "1 up", 18)).toEqual(card("HHHHHHHHHHHHHHHHHA"));
    expect(marginToHoles("A", "1up", 18)).toEqual(card("HHHHHHHHHHHHHHHHHA"));
  });

  it("a named winner with a blank, AS or unreadable margin is the minimal 1 UP win, never a halved match", () => {
    const minimal = card("HHHHHHHHHHHHHHHHHA");
    expect(marginToHoles("A", "", 18)).toEqual(minimal);
    expect(marginToHoles("A", "AS", 18)).toEqual(minimal);
    expect(marginToHoles("A", "gibberish", 18)).toEqual(minimal);
    expect(marginToHoles("B", "", 18)).toEqual(card("HHHHHHHHHHHHHHHHHB"));
  });

  it("stray text round a margin is not read as one (the whole box must be the margin)", () => {
    expect(marginToHoles("A", "x2&1", 18)).toEqual(card("HHHHHHHHHHHHHHHHHA"));
    expect(marginToHoles("A", "2&1x", 18)).toEqual(card("HHHHHHHHHHHHHHHHHA"));
    expect(marginToHoles("A", "x2 UP", 18)).toEqual(card("HHHHHHHHHHHHHHHHHA"));
    expect(marginToHoles("A", "2 UPx", 18)).toEqual(card("HHHHHHHHHHHHHHHHHA"));
  });

  it("a lead bigger than the holes played starts at hole one rather than before it", () => {
    // 5&4 over nine: 5 holes played, lead 5, all five won; four unplayed
    expect(marginToHoles("A", "5&4", 9)).toEqual(card("AAAAA...."));
    // 3 UP over two holes cannot be built longer than the card
    expect(marginToHoles("A", "3 UP", 2)).toEqual(card("AA"));
  });

  it("always as long as the round", () => {
    expect(marginToHoles("A", "2&1", 9)).toHaveLength(9);
    expect(marginToHoles("B", "1 UP", 18)).toHaveLength(18);
    expect(marginToHoles("H", "", 0)).toEqual([]);
  });

  it("reads back as the margin typed (Rule 3.2a(3)), for each margin a match can finish on", () => {
    expect(readBack("A", "2&1")).toMatchObject({ winner: "A", resultText: "2&1", played: 17, remaining: 1 });
    expect(readBack("B", "3&2")).toMatchObject({ winner: "B", resultText: "3&2", played: 16, remaining: 2 });
    expect(readBack("A", "3&1")).toMatchObject({ winner: "A", resultText: "3&1" });
    expect(readBack("B", "5&4")).toMatchObject({ winner: "B", resultText: "5&4" });
    expect(readBack("A", "1 UP")).toMatchObject({ winner: "A", resultText: "1 UP", played: 18, remaining: 0 });
    expect(readBack("B", "2 UP")).toMatchObject({ winner: "B", resultText: "2 UP" });
    expect(readBack("A", "5&4", 9)).toMatchObject({ winner: "A", resultText: "5&4" });
  });
});

describe("two-digit margins (a longer card than eighteen, or a society's 36-hole final)", () => {
  it("marginRefusal reads a two-digit number of holes left", () => {
    // 3 up with 10 to play is not closed out, and it is SAID so, not called 'not a margin'
    expect(marginRefusal("A", "3&10", 36)).toMatch(/3 up with 10 to play isn't a closed-out match/);
    expect(marginRefusal("A", "12&10", 36)).toBeNull();
    expect(marginRefusal("A", "12&11", 36)).toBeNull();
    expect(marginRefusal("A", "13&10", 36)).toMatch(/already over/);
  });

  it("marginToHoles builds a two-digit number of holes left", () => {
    // 3&10 over 18: 8 played, the winner's 3 at the end of them
    expect(marginToHoles("A", "3&10", 18)).toEqual(card("HHHHHAAA.........."));
    expect(resolveMatch(marginToHoles("A", "12&10", 36))).toMatchObject({ resultText: "12&10", winner: "A" });
  });

  it("marginToHoles builds a two-digit lead and reads 'UP' with no space", () => {
    expect(marginToHoles("A", "12 UP", 18)).toEqual(card("HHHHHHAAAAAAAAAAAA"));
    expect(marginToHoles("A", "2up", 18)).toEqual(card("HHHHHHHHHHHHHHHHAA"));
    expect(marginToHoles("B", "2UP", 18)).toEqual(card("HHHHHHHHHHHHHHHHBB"));
  });
});

describe("parseResultTranscript — more of what is said", () => {
  it("'halve' is a halved match too", () => {
    expect(parseResultTranscript("they halve", "Sam", "Alex")).toEqual({ winner: "H", margin: "AS" });
  });

  it("'as' counts only when it is the whole of what was said", () => {
    expect(parseResultTranscript("was", "Sam", "Alex")).toEqual({ winner: null, margin: "" });
    expect(parseResultTranscript("as Sam wins 1 up", "Sam", "Alex")).toEqual({ winner: "A", margin: "1 UP" });
  });

  it("when both names are said and one is the start of the other, the longer name is the one that counts", () => {
    expect(parseResultTranscript("Sam lost to Samantha 3 and 2", "Sam", "Samantha").winner).toBe("B");
    expect(parseResultTranscript("Sam lost to Samantha 3 and 2", "Samantha", "Sam").winner).toBe("A");
    expect(parseResultTranscript("Samantha lost to Sam 3 and 2", "Sam", "Samantha").winner).toBe("B");
    expect(parseResultTranscript("Samantha lost to Sam 3 and 2", "Samantha", "Sam").winner).toBe("A");
  });

  it("reads margins of two digits", () => {
    expect(parseResultTranscript("Sam 10 and 8", "Sam", "Alex").margin).toBe("10&8");
    expect(parseResultTranscript("Sam 3 and 10", "Sam", "Alex").margin).toBe("3&10");
    expect(parseResultTranscript("Sam 12 up", "Sam", "Alex").margin).toBe("12 UP");
  });
});

describe("parseHolesTranscript — the round ends where it ends, whoever won the hole", () => {
  it("B's holes and halves also stop at the last hole", () => {
    expect(parseHolesTranscript("Alex Alex Alex Alex", "Sam", "Alex", 16, 18)).toEqual(card("BB"));
    expect(parseHolesTranscript("half half half half", "Sam", "Alex", 16, 18)).toEqual(card("HH"));
    expect(parseHolesTranscript("push tie tied", "Sam", "Alex", 16, 18)).toEqual(card("HH"));
  });
});

describe("deriveNetHoles — nothing past the stated hole count", () => {
  it("scores recorded beyond the round's length are not made into extra holes", () => {
    const si18 = Array.from({ length: 18 }, (_, i) => i + 1);
    const h = deriveNetHoles([4, 4, 4, 4, 4], [5, 5, 5, 5, 5], 0, 0, si18, 3);
    expect(h).toEqual(["A", "A", "A"]);
  });
});

describe("namesAreDistinct — two spoken first names that can be told apart", () => {
  it("the same name, in any case or padded, cannot be told apart", () => {
    expect(namesAreDistinct("Dave", "Dave")).toBe(false);
    expect(namesAreDistinct("Dave", "dave")).toBe(false);
    expect(namesAreDistinct(" Dave ", "dave")).toBe(false);
    expect(namesAreDistinct("DAVE", "  dave")).toBe(false);
  });

  it("a name that is blank tells nothing", () => {
    expect(namesAreDistinct("", "Sam")).toBe(false);
    expect(namesAreDistinct("Sam", "")).toBe(false);
    expect(namesAreDistinct("   ", "Sam")).toBe(false);
    expect(namesAreDistinct("Sam", "  ")).toBe(false);
    expect(namesAreDistinct("", "")).toBe(false);
  });

  it("different names are distinct, including one that prefixes the other", () => {
    expect(namesAreDistinct("Sam", "Alex")).toBe(true);
    expect(namesAreDistinct("Sam", "Samantha")).toBe(true);
    expect(namesAreDistinct(" Sam", "Alex ")).toBe(true);
  });
});

describe("parseResultTranscript — a spoken result", () => {
  it("halved, all square, or 'as' alone is a halved match", () => {
    expect(parseResultTranscript("the match was halved", "Sam", "Alex")).toEqual({ winner: "H", margin: "AS" });
    expect(parseResultTranscript("They halved", "Sam", "Alex")).toEqual({ winner: "H", margin: "AS" });
    expect(parseResultTranscript("all square", "Sam", "Alex")).toEqual({ winner: "H", margin: "AS" });
    expect(parseResultTranscript("As", "Sam", "Alex")).toEqual({ winner: "H", margin: "AS" });
    expect(parseResultTranscript("  as  ", "Sam", "Alex")).toEqual({ winner: "H", margin: "AS" });
  });

  it("'as' inside other words, or 'halved' inside a longer word, is not a halve", () => {
    expect(parseResultTranscript("Sam wins as 2 up", "Sam", "Alex").winner).toBe("A");
    expect(parseResultTranscript("alex has won", "Sam", "Alex").winner).toBe("B");
    expect(parseResultTranscript("unhalved Sam 1 up", "Sam", "Alex")).toEqual({ winner: "A", margin: "1 UP" });
  });

  it("names the winner and reads 'N and M' as N&M", () => {
    expect(parseResultTranscript("Sam wins 3 and 2", "Sam", "Alex")).toEqual({ winner: "A", margin: "3&2" });
    expect(parseResultTranscript("Alex won 4 and 3", "Sam", "Alex")).toEqual({ winner: "B", margin: "4&3" });
    expect(parseResultTranscript("ALEX WON 2&1", "Sam", "Alex")).toEqual({ winner: "B", margin: "2&1" });
    expect(parseResultTranscript("Sam 3 & 1", "Sam", "Alex")).toEqual({ winner: "A", margin: "3&1" });
    expect(parseResultTranscript("Sam 5and4", "Sam", "Alex")).toEqual({ winner: "A", margin: "5&4" });
  });

  it("reads 'N up' as N UP, and 'N and M' wins over 'up'", () => {
    expect(parseResultTranscript("Alex wins 1 up", "Sam", "Alex")).toEqual({ winner: "B", margin: "1 UP" });
    expect(parseResultTranscript("Sam two up 2up", "Sam", "Alex")).toEqual({ winner: "A", margin: "2 UP" });
    expect(parseResultTranscript("Sam 3 and 2 up", "Sam", "Alex").margin).toBe("3&2");
  });

  it("a margin with no digits is not a margin, and no name leaves the winner for the screen to ask", () => {
    expect(parseResultTranscript("wins by a mile", "Sam", "Alex")).toEqual({ winner: null, margin: "" });
    expect(parseResultTranscript("won 3 and 2", "Sam", "Alex")).toEqual({ winner: null, margin: "3&2" });
    expect(parseResultTranscript("Sam and Alex", "Sam", "Alex").margin).toBe("");
  });

  it("a first name that prefixes the other's goes to the whole word said (Samantha is not Sam)", () => {
    expect(parseResultTranscript("Samantha wins 3 and 2", "Sam", "Samantha")).toEqual({ winner: "B", margin: "3&2" });
    expect(parseResultTranscript("Samantha wins 3 and 2", "Samantha", "Sam")).toEqual({ winner: "A", margin: "3&2" });
    expect(parseResultTranscript("Sam wins 3 and 2", "Sam", "Samantha")).toEqual({ winner: "A", margin: "3&2" });
    expect(parseResultTranscript("Sam wins 3 and 2", "Samantha", "Sam")).toEqual({ winner: "B", margin: "3&2" });
    // equal length: either order must still find the one said
    expect(parseResultTranscript("Bo wins 1 up", "Al", "Bo").winner).toBe("B");
    expect(parseResultTranscript("Al wins 1 up", "Al", "Bo").winner).toBe("A");
  });

  it("a name is a whole word, not a part of one", () => {
    expect(parseResultTranscript("Samson wins 1 up", "Sam", "Alex").winner).toBeNull();
    expect(parseResultTranscript("pressam wins 1 up", "Sam", "Alex").winner).toBeNull();
  });

  it("the names are matched as text, not as a pattern", () => {
    // "." must not stand for any character: "axb" is not "a.b"
    expect(parseResultTranscript("axb wins 2 up", "A.B", "Zed").winner).toBeNull();
    expect(parseResultTranscript("a.b wins 2 up", "A.B", "Zed").winner).toBe("A");
  });

  it("two players with the same first name cannot be told apart: no winner, margin still read", () => {
    expect(parseResultTranscript("Dave wins 3 and 2", "Dave", "Dave")).toEqual({ winner: null, margin: "3&2" });
    expect(parseResultTranscript("dave wins 1 up", "Dave", "dave")).toEqual({ winner: null, margin: "1 UP" });
  });
});

describe("parseHolesTranscript — spoken hole-by-hole results", () => {
  it("reads each name and each halve word as one hole", () => {
    expect(parseHolesTranscript("Sam, Alex, half, push, tie, tied, sam", "Sam", "Alex", 0, 18)).toEqual(
      card("ABHHHHA"),
    );
  });

  it("is case-insensitive and splits on commas and spaces", () => {
    expect(parseHolesTranscript("SAM,alex   Sam", "Sam", "Alex", 0, 18)).toEqual(card("ABA"));
    expect(parseHolesTranscript(",, Sam ,Alex", "Sam", "Alex", 0, 18)).toEqual(card("AB"));
  });

  it("ignores words it does not know without moving on a hole", () => {
    expect(parseHolesTranscript("Sam um Alex the halve Sam samantha alexander", "Sam", "Alex", 0, 18)).toEqual(
      card("ABA"),
    );
  });

  it("refuses all of it when the two names are the same", () => {
    expect(parseHolesTranscript("Dave half Dave", "Dave", "Dave", 0, 18)).toEqual([]);
    expect(parseHolesTranscript("half half", "", "Sam", 0, 18)).toEqual([]);
  });

  it("stops at the last hole of the round, counting from where it starts", () => {
    expect(parseHolesTranscript("Sam Sam Sam Sam", "Sam", "Alex", 16, 18)).toEqual(card("AA"));
    expect(parseHolesTranscript("Sam Sam Sam", "Sam", "Alex", 0, 2)).toEqual(card("AA"));
    expect(parseHolesTranscript("Sam Alex", "Sam", "Alex", 17, 18)).toEqual(card("A"));
    expect(parseHolesTranscript("Sam Alex", "Sam", "Alex", 18, 18)).toEqual([]);
    expect(parseHolesTranscript("Sam", "Sam", "Alex", 0, 0)).toEqual([]);
  });

  it("an empty transcript is no holes", () => {
    expect(parseHolesTranscript("", "Sam", "Alex", 0, 18)).toEqual([]);
    expect(parseHolesTranscript("   ", "Sam", "Alex", 0, 18)).toEqual([]);
  });

  it("'half', 'push', 'tie' and 'tied' are halves but 'halving' and 'halfway' are not", () => {
    expect(parseHolesTranscript("halving halfway halve", "Sam", "Alex", 0, 18)).toEqual([]);
    expect(parseHolesTranscript("xhalf halfx", "Sam", "Alex", 0, 18)).toEqual([]);
    expect(parseHolesTranscript("pushed tiedx atie", "Sam", "Alex", 0, 18)).toEqual([]);
  });
});

describe("matchStrokesGiven — Rule 21 / Appendix C: the higher handicap receives the whole difference", () => {
  const si18 = Array.from({ length: 18 }, (_, i) => i + 1);

  it("A 10 v B 4: A is given 6 strokes, on stroke indexes 1 to 6, and B none", () => {
    const { toA, toB } = matchStrokesGiven(10, 4, si18);
    expect(toA).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(toB).toEqual(new Array(18).fill(0));
  });

  it("B 12 v A 5: B is given 7 strokes, A none", () => {
    const { toA, toB } = matchStrokesGiven(5, 12, si18);
    expect(toA).toEqual(new Array(18).fill(0));
    expect(toB.slice(0, 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 0]);
    expect(toB.reduce((a, b) => a + b, 0)).toBe(7);
  });

  it("equal handicaps give nobody a stroke", () => {
    const { toA, toB } = matchStrokesGiven(9, 9, si18);
    expect(toA).toEqual(new Array(18).fill(0));
    expect(toB).toEqual(new Array(18).fill(0));
  });

  it("follows the stroke index of each hole, not the hole number", () => {
    // holes 1..4 have stroke indexes 3,1,4,2 (a four-hole shorthand card): difference 2 -> SI 1 and 2.
    const { toA } = matchStrokesGiven(6, 4, [3, 1, 4, 2]);
    expect(toA).toEqual([0, 1, 0, 1]);
  });

  it("a difference over 18 gives a second stroke on the hardest holes", () => {
    // diff 20: every hole once, SI 1 and 2 twice
    const { toA } = matchStrokesGiven(30, 10, si18);
    expect(toA[0]).toBe(2);
    expect(toA[1]).toBe(2);
    expect(toA[2]).toBe(1);
    expect(toA.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it("nine holes spread the difference over nine: diff 10 is every hole once and SI 1 twice", () => {
    const si9 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const { toA, toB } = matchStrokesGiven(14, 4, si9);
    expect(toA).toEqual([2, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(toB).toEqual(new Array(9).fill(0));
  });

  it("works from whole handicaps: 10.6 and 4.4 are 11 and 4, a difference of 7", () => {
    const { toA } = matchStrokesGiven(10.6, 4.4, si18);
    expect(toA.reduce((a, b) => a + b, 0)).toBe(7);
    const { toB } = matchStrokesGiven(4.4, 10.6, si18);
    expect(toB.reduce((a, b) => a + b, 0)).toBe(7);
  });
});

describe("deriveNetHoles — a hole is won by the lower net score, halved if equal (Rule 3.2b)", () => {
  const si18 = Array.from({ length: 18 }, (_, i) => i + 1);

  it("level handicaps: lower gross wins, equal halves", () => {
    const h = deriveNetHoles([4, 5, 3], [5, 5, 4], 0, 0, si18);
    expect(h.slice(0, 3)).toEqual(["A", "H", "A"]);
    const h2 = deriveNetHoles([6, 3], [4, 3], 0, 0, si18);
    expect(h2.slice(0, 2)).toEqual(["B", "H"]);
  });

  it("a hole either side has not scored is undecided", () => {
    const h = deriveNetHoles([4, null, 4, undefined as unknown as null], [5, 5, null, 5], 0, 0, si18);
    expect(h.slice(0, 4)).toEqual(["A", null, null, null]);
  });

  it("a card of eighteen when nothing says otherwise, nulls past what was entered", () => {
    const h = deriveNetHoles([4, 4, 4], [4, 4, 4], 0, 0, si18);
    expect(h).toHaveLength(18);
    expect(h.slice(3)).toEqual(new Array(15).fill(null));
  });

  it("the length is the longest of the cards and the stroke index when no hole count is given", () => {
    expect(deriveNetHoles([4, 4, 4, 4, 4], [4], 0, 0, [1, 2, 3])).toHaveLength(5);
    expect(deriveNetHoles([4], [4, 4, 4, 4, 4, 4], 0, 0, [1, 2, 3])).toHaveLength(6);
    expect(deriveNetHoles([4], [4], 0, 0, [1, 2, 3, 4, 5, 6, 7])).toHaveLength(7);
  });

  it("a stated hole count sets the length, so nine holes on an eighteen-hole index is nine", () => {
    expect(deriveNetHoles([4], [4], 0, 0, si18, 9)).toHaveLength(9);
    expect(deriveNetHoles([4], [4], 0, 0, si18, 3)).toHaveLength(3);
    // rounded
    expect(deriveNetHoles([4], [4], 0, 0, si18, 8.6)).toHaveLength(9);
    expect(deriveNetHoles([4], [4], 0, 0, si18, 8.4)).toHaveLength(8);
  });

  it("a hole count of zero or less is ignored, not read as an empty match", () => {
    expect(deriveNetHoles([4, 4], [4, 4], 0, 0, si18, 0)).toHaveLength(18);
    expect(deriveNetHoles([4, 4], [4, 4], 0, 0, si18, -5)).toHaveLength(18);
  });

  it("A receives the strokes: A 18 v B 0, one stroke on every hole turns a gross loss into a halve", () => {
    // gross A 5 v B 4: net 4 v 4 halved; A 4 v B 4: net 3 v 4, A wins; A 6 v B 4: net 5 v 4, B wins
    const h = deriveNetHoles([5, 4, 6], [4, 4, 4], 18, 0, si18);
    expect(h.slice(0, 3)).toEqual(["H", "A", "B"]);
  });

  it("B receives the strokes when B has the higher handicap", () => {
    // B 18 v A 0: B has one on each hole. Gross A 4 v B 5: net 4 v 4 halved; A 4 v B 4: net 4 v 3, B wins.
    const h = deriveNetHoles([4, 4, 3], [5, 4, 6], 0, 18, si18);
    expect(h.slice(0, 3)).toEqual(["H", "B", "A"]);
  });

  it("strokes fall on the hardest holes only: A 2 v B 0 gets a stroke on SI 1 and 2", () => {
    // holes 1,2 (SI 1,2): A gross 5 v 4: net 4 v 4 halved. Hole 3 (SI 3): no stroke, 5 v 4 -> B wins.
    const h = deriveNetHoles([5, 5, 5], [4, 4, 4], 2, 0, si18);
    expect(h.slice(0, 3)).toEqual(["H", "H", "B"]);
  });

  it("a hole beyond the stroke index card is played off gross, never lost", () => {
    // three-hole index, five holes of scores, A has 3 handicap: strokes on the three SI holes only.
    const h = deriveNetHoles([4, 4, 4, 3, 5], [4, 4, 4, 4, 4], 3, 0, [1, 2, 3], 5);
    expect(h).toEqual(["A", "A", "A", "A", "B"]);
  });
});

describe("matchStandingText — what a player on the tee says", () => {
  const r = (over: Partial<Parameters<typeof matchStandingText>[0]>) => ({
    complete: false, winner: null as "A" | "B" | "H" | null, resultText: "", lead: 0, remaining: 18, played: 0, ...over,
  });

  it("a finished match says who won and by how much, or Halved", () => {
    expect(matchStandingText(r({ complete: true, winner: "A", resultText: "3&2" }), "Sam", "Alex")).toBe("Sam 3&2");
    expect(matchStandingText(r({ complete: true, winner: "B", resultText: "1 UP" }), "Sam", "Alex")).toBe("Alex 1 UP");
    expect(matchStandingText(r({ complete: true, winner: "H", resultText: "AS" }), "Sam", "Alex")).toBe("Halved");
  });

  it("nobody has played a hole: Not started", () => {
    expect(matchStandingText(r({ played: 0, remaining: 18 }), "Sam", "Alex")).toBe("Not started");
  });

  it("all square names the holes left", () => {
    expect(matchStandingText(r({ played: 4, remaining: 14, lead: 0 }), "Sam", "Alex")).toBe("All square with 14 to play");
    expect(matchStandingText(r({ played: 17, remaining: 1, lead: 0 }), "Sam", "Alex")).toBe("All square with 1 to play");
  });

  it("leading by exactly the holes left is dormie, for either side", () => {
    expect(matchStandingText(r({ played: 15, remaining: 3, lead: 3 }), "Sam", "Alex")).toBe("Sam dormie 3");
    expect(matchStandingText(r({ played: 16, remaining: 2, lead: -2 }), "Sam", "Alex")).toBe("Alex dormie 2");
    expect(matchStandingText(r({ played: 17, remaining: 1, lead: 1 }), "Sam", "Alex")).toBe("Sam dormie 1");
  });

  it("any other lead is 'N up with M to play', the leader named", () => {
    expect(matchStandingText(r({ played: 4, remaining: 14, lead: 2 }), "Sam", "Alex")).toBe("Sam 2 up with 14 to play");
    expect(matchStandingText(r({ played: 4, remaining: 14, lead: -3 }), "Sam", "Alex")).toBe("Alex 3 up with 14 to play");
    expect(matchStandingText(r({ played: 16, remaining: 2, lead: 1 }), "Sam", "Alex")).toBe("Sam 1 up with 2 to play");
  });
});
