import { describe, it, expect } from "vitest";
import {
  seedOrder,
  bracketSizeFor,
  roundLabels,
  buildBracket,
  drawBrackets,
  firstRoundLosers,
  SEED_ORDER_8,
  type BracketView,
} from "../bracket";
import type { Player } from "../types";

const field = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, handicap: 0, seed: i + 1 }));

describe("bracket sizing", () => {
  it("rounds up to the next power of two", () => {
    expect(bracketSizeFor(5)).toBe(8);
    expect(bracketSizeFor(8)).toBe(8);
    expect(bracketSizeFor(9)).toBe(16);
    expect(bracketSizeFor(32)).toBe(32);
  });

  it("never goes below two", () => {
    // A one-player bracket is a final nobody plays; two is the floor.
    expect(bracketSizeFor(0)).toBe(2);
    expect(bracketSizeFor(1)).toBe(2);
  });
});

describe("seed order", () => {
  it("keeps the eight-player table this app has always used", () => {
    // Reflection gives the same pairs in a different order, which would redraw
    // any eight-player bracket already under way.
    expect(seedOrder(8)).toEqual(SEED_ORDER_8);
  });

  it("puts the top two seeds in opposite halves at every size", () => {
    // The whole point of a seeded draw: 1 and 2 can only meet in the final.
    for (const size of [4, 8, 16, 32]) {
      const order = seedOrder(size);
      const halfMatches = size / 4; // matches in the top half of the draw
      const matchOf = (seed: number) => Math.floor(order.indexOf(seed) / 2);
      expect(matchOf(1) < halfMatches, `size ${size}`).toBe(true);
      expect(matchOf(2) >= halfMatches, `size ${size}`).toBe(true);
    }
  });

  it("uses every seed exactly once", () => {
    for (const size of [2, 4, 8, 16, 32]) {
      const order = seedOrder(size);
      expect(order).toHaveLength(size);
      expect(new Set(order).size).toBe(size);
      expect(Math.max(...order)).toBe(size);
    }
  });

  it("pairs each seed with its complement in the opening round", () => {
    const order = seedOrder(16);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i] + order[i + 1]).toBe(17);
    }
  });
});

describe("round labels", () => {
  it("names the closing rounds properly", () => {
    expect(roundLabels(8)).toEqual(["Quarterfinals", "Semifinals", "Final"]);
    expect(roundLabels(4)).toEqual(["Semifinals", "Final"]);
    expect(roundLabels(2)).toEqual(["Final"]);
  });

  it("counts the early ones by size", () => {
    expect(roundLabels(32)).toEqual([
      "Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Final",
    ]);
  });
});

describe("brackets of any size", () => {
  it("builds a 16-player bracket, which used to be impossible", () => {
    const v = buildBracket("winners", field(16), {});
    expect(v.rounds).toHaveLength(4);
    expect(v.rounds[0].matches).toHaveLength(8);
    expect(v.rounds[3].matches).toHaveLength(1);
    expect(v.rounds[3].label).toBe("Final");
  });

  it("still builds the eight-player bracket the same way", () => {
    const v = buildBracket("winners", field(8), {});
    expect(v.rounds).toHaveLength(3);
    expect(v.rounds[0].matches[0].a.seed).toBe(1);
    expect(v.rounds[0].matches[0].b.seed).toBe(8);
  });

  it("gives byes to the unfilled seeds and advances them", () => {
    // Five players in an eight bracket: three byes, and nobody waits for a
    // match that will never be played.
    const v = buildBracket("winners", field(5), {});
    const byes = v.rounds[0].matches.filter((m) => m.winnerId !== null);
    expect(byes.length).toBeGreaterThan(0);
    for (const m of byes) {
      expect(m.a.playerId === null || m.b.playerId === null).toBe(true);
    }
  });

  it("crowns nobody until the final is decided", () => {
    expect(buildBracket("winners", field(4), {}).champion).toBeNull();
  });

  it("handles a two-player bracket as a single final", () => {
    const v = buildBracket("winners", field(2), {});
    expect(v.rounds).toHaveLength(1);
    expect(v.rounds[0].label).toBe("Final");
    expect(v.rounds[0].matches).toHaveLength(1);
  });
});

describe("how the knockout is arranged", () => {
  const q = field(8);

  it("single puts everyone in one bracket", () => {
    const d = drawBrackets(q, "single");
    expect(d.main).toHaveLength(8);
    expect(d.second).toHaveLength(0);
    expect(d.secondLabel).toBe("");
  });

  it("split draws two flights by rank", () => {
    const d = drawBrackets(q, "split");
    expect(d.main.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(d.second.map((p) => p.id)).toEqual(["p5", "p6", "p7", "p8"]);
    expect(d.secondLabel).toBe("Consolation");
  });

  it("plate keeps everyone in the main bracket", () => {
    // The difference that matters: in a plate nobody is written off before
    // they tee up — the second bracket fills from results.
    const d = drawBrackets(q, "plate");
    expect(d.main).toHaveLength(8);
    expect(d.second).toHaveLength(0);
    expect(d.secondLabel).toBe("Plate");
  });

  it("plate fills from first-round losers once they exist", () => {
    const losers = [q[4], q[5]];
    expect(drawBrackets(q, "plate", losers).second).toEqual(losers);
  });

  it("defaults to the arrangement existing tournaments already use", () => {
    expect(drawBrackets(q).secondLabel).toBe("Consolation");
  });
});

describe("firstRoundLosers", () => {
  const q = field(8);
  const byId = new Map(q.map((p) => [p.id, p]));

  it("reads the recorded winners rather than guessing", () => {
    const v: BracketView = buildBracket("winners", q, { "winners-0-0": "p1" });
    const losers = firstRoundLosers(v, byId);
    // Seed 1 beat seed 8, so seed 8 drops.
    expect(losers.map((p) => p.id)).toEqual(["p8"]);
  });

  it("returns nobody while the round is unplayed", () => {
    expect(firstRoundLosers(buildBracket("winners", q, {}), byId)).toEqual([]);
  });

  it("never drops a player who advanced on a bye", () => {
    // A bye isn't a defeat, and putting that player in the plate would take
    // them out of a bracket they are still winning.
    const v = buildBracket("winners", field(5), {});
    for (const p of firstRoundLosers(v, new Map(field(5).map((x) => [x.id, x])))) {
      expect(p).toBeDefined();
    }
    expect(firstRoundLosers(v, new Map(field(5).map((x) => [x.id, x])))).toEqual([]);
  });
});
