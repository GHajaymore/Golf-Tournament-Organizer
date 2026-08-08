import { describe, it, expect } from "vitest";
import {
  resolveMatchEntry,
  entryModesFor,
  isNetBasis,
  MATCH_ENTRY_MODES,
  type MatchEntry,
  type MatchScoringContext,
} from "../domain/match-entry";
import type { HoleResult } from "../domain/types";

/**
 * One resolver for every way a match gets written down.
 *
 * The three shapes reached the standings by separate routes, so whether
 * handicaps applied depended on which screen the score was typed into. These
 * pin the single path: same round settings, same answer, whichever way it
 * arrived.
 */

const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];

const ctx = (over: Partial<MatchScoringContext> = {}): MatchScoringContext => ({
  basis: "gross",
  handicapA: 0,
  handicapB: 0,
  strokeIndex: SI,
  holes: 18,
  tiebreak: [],
  ...over,
});

/** Both players level except where told otherwise. */
const cards = (aWins: number[], bWins: number[]) => {
  const a: (number | null)[] = new Array(18).fill(4);
  const b: (number | null)[] = new Array(18).fill(4);
  for (const h of aWins) a[h - 1] = 3;
  for (const h of bWins) b[h - 1] = 3;
  return { strokesA: a, strokesB: b };
};

describe("gross cards", () => {
  it("gives the hole to the lower gross score", () => {
    const e: MatchEntry = { mode: "gross-cards", ...cards([1, 2, 3], []) };
    const r = resolveMatchEntry(e, ctx());
    expect(r.holes[0]).toBe("A");
    expect(r.winner).toBe("A");
    expect(r.net).toBe(false);
  });

  it("leaves a hole undecided until both cards have a score", () => {
    const { strokesA, strokesB } = cards([], []);
    strokesB[5] = null;
    const r = resolveMatchEntry({ mode: "gross-cards", strokesA, strokesB }, ctx());
    expect(r.holes[5]).toBeNull();
  });

  it("applies handicap strokes on a net round", () => {
    // B is 4 shots worse, so takes one on stroke index 1–4 — which is the 4th,
    // 2nd, 11th and 13th holes on this card. Level gross on the 4th becomes a
    // win for B once the shot lands.
    const { strokesA, strokesB } = cards([], []);
    const r = resolveMatchEntry(
      { mode: "gross-cards", strokesA, strokesB },
      ctx({ basis: "net", handicapA: 0, handicapB: 4 }),
    );
    expect(r.net).toBe(true);
    expect(r.holes[3]).toBe("B");
    // Stroke index 15 gets no shot, so that hole stays halved.
    expect(r.holes[4]).toBe("H");
  });

  it("re-scores when the round changes from gross to net", () => {
    // The property that makes gross cards worth the typing: the strokes are
    // still there, so the result follows the setting.
    const e: MatchEntry = { mode: "gross-cards", ...cards([], []) };
    expect(resolveMatchEntry(e, ctx()).winner).toBe("H");
    expect(resolveMatchEntry(e, ctx({ basis: "net", handicapB: 6 })).winner).toBe("B");
  });

  it("refuses to fake a net result with no stroke index", () => {
    // Without a card there is nowhere to allocate the shots, so "net" would be
    // gross wearing a different label.
    const r = resolveMatchEntry(
      { mode: "gross-cards", ...cards([], []) },
      ctx({ basis: "net", handicapB: 6, strokeIndex: [] }),
    );
    expect(r.problem).toContain("stroke index");
  });

  it("treats 'both' as net, because a match can only be one", () => {
    // You cannot be 2 up gross and 1 down net and have won.
    expect(isNetBasis("both")).toBe(true);
    expect(isNetBasis("net")).toBe(true);
    expect(isNetBasis("gross")).toBe(false);
  });
});

describe("hole results", () => {
  it("takes them as given", () => {
    const holes = new Array(18).fill("H") as HoleResult[];
    holes[0] = "A";
    const r = resolveMatchEntry({ mode: "hole-results", holes }, ctx());
    expect(r.winner).toBe("A");
  });

  it("never applies handicaps twice", () => {
    // The player already used their shot on the course when they decided who
    // won the hole. Applying it again here would hand it over a second time.
    const holes = new Array(18).fill("H") as HoleResult[];
    const r = resolveMatchEntry(
      { mode: "hole-results", holes },
      ctx({ basis: "net", handicapB: 10 }),
    );
    expect(r.winner).toBe("H");
    expect(r.strokesGiven.toB.every((n) => n === 0)).toBe(true);
  });

  it("pads a short card rather than losing holes", () => {
    const r = resolveMatchEntry({ mode: "hole-results", holes: ["A", "A"] }, ctx());
    expect(r.holes).toHaveLength(18);
    expect(r.holes[17]).toBeNull();
  });
});

describe("the result only", () => {
  it("reads a margin", () => {
    const r = resolveMatchEntry({ mode: "match-result", winner: "A", margin: "3&2" }, ctx());
    expect(r.winner).toBe("A");
    expect(r.resolution.resultText).toBe("3&2");
  });

  it("reads all square", () => {
    const r = resolveMatchEntry({ mode: "match-result", winner: "H", margin: "AS" }, ctx());
    expect(r.winner).toBe("H");
  });
});

describe("the round's all-square rule", () => {
  const level = () => {
    const holes = new Array(18).fill("H") as HoleResult[];
    holes[17] = "A";
    holes[15] = "B";
    return holes;
  };

  it("decides a finished match by the configured countback", () => {
    const r = resolveMatchEntry(
      { mode: "hole-results", holes: level() },
      ctx({ tiebreak: ["last-9", "last-6", "last-3", "last-1"] }),
    );
    expect(r.winner).toBe("A");
    expect(r.decidedBy).toBe("last-1");
    expect(r.detail).toContain("All square");
  });

  it("leaves it halved when no rule is configured", () => {
    const r = resolveMatchEntry({ mode: "hole-results", holes: level() }, ctx());
    expect(r.winner).toBe("H");
    expect(r.decidedBy).toBeNull();
  });

  it("never decides a match still on the course", () => {
    // Applying the countback to a half-played card would declare a winner at
    // the turn.
    const holes = new Array(18).fill(null) as HoleResult[];
    holes[0] = "A";
    holes[1] = "B";
    const r = resolveMatchEntry({ mode: "hole-results", holes }, ctx({ tiebreak: ["last-1"] }));
    expect(r.resolution.complete).toBe(false);
    expect(r.decidedBy).toBeNull();
  });
});

describe("the organizer's override", () => {
  it("beats the card", () => {
    const r = resolveMatchEntry(
      { mode: "match-result", winner: "A", margin: "5&4", override: { winner: "B" } },
      ctx(),
    );
    expect(r.winner).toBe("B");
    expect(r.overridden).toBe(true);
  });

  it("beats the countback too", () => {
    const holes = new Array(18).fill("H") as HoleResult[];
    holes[17] = "A";
    const r = resolveMatchEntry(
      { mode: "hole-results", holes, override: { winner: "H", note: "match conceded, halved" } },
      ctx({ tiebreak: ["last-1"] }),
    );
    expect(r.winner).toBe("H");
    expect(r.decidedBy).toBeNull();
  });

  it("says it was overruled, and why", () => {
    // A result that does not match the card has to say so, or the next person
    // to read it assumes the card is wrong.
    const r = resolveMatchEntry(
      { mode: "match-result", winner: "A", margin: "2 UP", override: { winner: "B", note: "A disqualified" } },
      ctx(),
    );
    expect(r.detail).toContain("Set by the organizer");
    expect(r.detail).toContain("A disqualified");
  });

  it("keeps the underlying card intact", () => {
    // The override changes the result, not the record of what was played.
    const r = resolveMatchEntry(
      { mode: "match-result", winner: "A", margin: "3&2", override: { winner: "B" } },
      ctx(),
    );
    expect(r.resolution.winner).toBe("A");
    expect(r.winner).toBe("B");
  });
});

describe("which shapes a format allows", () => {
  it("offers all three for match play", () => {
    expect(entryModesFor("Match Play")).toEqual(["hole-results", "gross-cards", "match-result"]);
  });

  it("offers only gross cards for stroke-based formats", () => {
    // A stroke round has no concept of winning a hole, so a "hole result" is a
    // shape its scoring cannot read.
    for (const f of ["Stroke Play", "Stableford", "Skins", "Four-Ball"]) {
      expect(entryModesFor(f), f).toEqual(["gross-cards"]);
    }
  });

  it("describes every mode, and marks which survive a re-score", () => {
    expect(MATCH_ENTRY_MODES).toHaveLength(3);
    for (const m of MATCH_ENTRY_MODES) {
      expect(m.label.length, m.key).toBeGreaterThan(3);
      expect(m.blurb.length, m.key).toBeGreaterThan(20);
    }
    expect(MATCH_ENTRY_MODES.filter((m) => m.rescorable).map((m) => m.key)).toEqual(["gross-cards"]);
  });
});

describe("who receives the shots", () => {
  // This was inverted and untested: the strokes went to whoever had the LOWER
  // handicap, so a scratch golfer was given four shots against a
  // 4-handicapper. Nothing on a card shows it — the holes simply go the wrong
  // way, and the better player wins by more than they should.
  const total = (n: number[]) => n.reduce((s, x) => s + x, 0);

  it("gives them to the higher handicap, whichever side that is", () => {
    const worseIsB = resolveMatchEntry(
      { mode: "gross-cards", ...cards([], []) },
      ctx({ basis: "net", handicapA: 0, handicapB: 4 }),
    );
    expect(total(worseIsB.strokesGiven.toB)).toBe(4);
    expect(total(worseIsB.strokesGiven.toA)).toBe(0);

    const worseIsA = resolveMatchEntry(
      { mode: "gross-cards", ...cards([], []) },
      ctx({ basis: "net", handicapA: 12, handicapB: 5 }),
    );
    expect(total(worseIsA.strokesGiven.toA)).toBe(7);
    expect(total(worseIsA.strokesGiven.toB)).toBe(0);
  });

  it("gives the full difference, not half of it", () => {
    // Standard match-play allowance is 100% of the difference.
    const r = resolveMatchEntry(
      { mode: "gross-cards", ...cards([], []) },
      ctx({ basis: "net", handicapA: 18, handicapB: 4 }),
    );
    expect(total(r.strokesGiven.toA)).toBe(14);
  });

  it("allocates them to the hardest holes first", () => {
    const r = resolveMatchEntry(
      { mode: "gross-cards", ...cards([], []) },
      ctx({ basis: "net", handicapA: 3, handicapB: 0 }),
    );
    // Stroke index 1, 2 and 3 are the 4th, 13th and 2nd holes on this card.
    expect(r.strokesGiven.toA[3]).toBe(1);
    expect(r.strokesGiven.toA[12]).toBe(1);
    expect(r.strokesGiven.toA[1]).toBe(1);
    // Stroke index 4 is the 11th, and gets nothing off three shots.
    expect(r.strokesGiven.toA[10]).toBe(0);
  });

  it("gives nobody anything when the handicaps match", () => {
    const r = resolveMatchEntry(
      { mode: "gross-cards", ...cards([], []) },
      ctx({ basis: "net", handicapA: 9, handicapB: 9 }),
    );
    expect(total(r.strokesGiven.toA)).toBe(0);
    expect(total(r.strokesGiven.toB)).toBe(0);
  });

  it("wraps past 18 — two shots on the hardest holes", () => {
    const r = resolveMatchEntry(
      { mode: "gross-cards", ...cards([], []) },
      ctx({ basis: "net", handicapA: 22, handicapB: 0 }),
    );
    expect(total(r.strokesGiven.toA)).toBe(22);
    // Stroke index 1 (the 4th hole) takes the second shot.
    expect(r.strokesGiven.toA[3]).toBe(2);
  });
});
