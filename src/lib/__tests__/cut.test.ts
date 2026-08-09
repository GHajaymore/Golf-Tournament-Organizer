import { describe, it, expect } from "vitest";
import {
  survivors,
  survivorCount,
  cutAdvancesEveryone,
  describeCut,
  isCutScope,
  type CutCandidate,
  type CutRule,
} from "../domain/cut";
import { deadlineState, deadlinePassed, todayIso, isIsoDate } from "../deadline";

/**
 * Who goes through, and out of what.
 *
 * The cut line and the qualification screen were two mechanisms for one
 * question, each with half an answer: the cut could say "top 16" or "top 50%"
 * but only across the whole field; qualification could say "per flight" but
 * lived at tournament level and had no percentage. An organizer could set both
 * to different things and nothing reconciled them.
 */

/** Ranked field, `n` per flight, already in finishing order. */
const field = (flights: number, per: number): CutCandidate[] => {
  const out: CutCandidate[] = [];
  for (let r = 0; r < per; r += 1) {
    for (let f = 0; f < flights; f += 1) {
      out.push({ id: `f${f}p${r}`, groupId: `g${f}` });
    }
  }
  return out;
};

const rule = (over: Partial<CutRule> = {}): CutRule => ({
  scope: "overall",
  mode: "count",
  count: 8,
  percent: 50,
  ...over,
});

describe("an overall cut", () => {
  it("takes the top N of the whole field", () => {
    const s = survivors(field(4, 8), rule({ count: 8 }));
    expect(s.size).toBe(8);
  });

  it("takes a percentage of the whole field, rounding up", () => {
    // 50% of 33 is 16.5 — and half a player cannot be cut, so 17 go through.
    const players = Array.from({ length: 33 }, (_, i) => ({ id: `p${i}` }));
    expect(survivors(players, rule({ mode: "percent", percent: 50 })).size).toBe(17);
  });

  it("never cuts everyone", () => {
    expect(survivorCount(rule({ mode: "percent", percent: 0 }), 32)).toBe(1);
    expect(survivorCount(rule({ count: 0 }), 32)).toBe(1);
  });

  it("never advances more than the field", () => {
    expect(survivorCount(rule({ count: 99 }), 12)).toBe(12);
    expect(survivorCount(rule({ mode: "percent", percent: 400 }), 12)).toBe(12);
  });

  it("handles an empty field without inventing a survivor", () => {
    expect(survivorCount(rule(), 0)).toBe(0);
    expect(survivors([], rule()).size).toBe(0);
  });

  it("takes the front of the list, so ranking order is the caller's job", () => {
    const ranked = [{ id: "first" }, { id: "second" }, { id: "third" }];
    const s = survivors(ranked, rule({ count: 2 }));
    expect([...s]).toEqual(["first", "second"]);
  });
});

describe("a per-flight cut", () => {
  it("takes N from EVERY flight, not N from the tournament", () => {
    // The distinction that makes this worth having: "top 2" across four
    // flights is eight players and a full bracket, not two and a final.
    const s = survivors(field(4, 8), rule({ scope: "perFlight", count: 2 }));
    expect(s.size).toBe(8);
    for (const f of [0, 1, 2, 3]) {
      expect(s.has(`f${f}p0`), `flight ${f} winner`).toBe(true);
      expect(s.has(`f${f}p1`), `flight ${f} runner-up`).toBe(true);
      expect(s.has(`f${f}p2`), `flight ${f} third`).toBe(false);
    }
  });

  it("sizes a percentage against the flight, not the field", () => {
    // 50% of a flight of eight is four — regardless of how many flights there
    // are, which is exactly what an overall percentage gets wrong.
    const s = survivors(field(3, 8), rule({ scope: "perFlight", mode: "percent", percent: 50 }));
    expect(s.size).toBe(12);
  });

  it("copes with flights of different sizes", () => {
    const uneven: CutCandidate[] = [
      { id: "a1", groupId: "A" }, { id: "a2", groupId: "A" }, { id: "a3", groupId: "A" },
      { id: "b1", groupId: "B" },
    ];
    const s = survivors(uneven, rule({ scope: "perFlight", count: 2 }));
    // Two from A, and B's only player rather than a phantom second.
    expect(s.size).toBe(3);
    expect(s.has("b1")).toBe(true);
  });

  it("preserves ranking order within each flight", () => {
    // Interleaved input: the flight's own leader must survive, not whoever
    // happened to appear first in the array.
    const ranked: CutCandidate[] = [
      { id: "bLeader", groupId: "B" },
      { id: "aLeader", groupId: "A" },
      { id: "bSecond", groupId: "B" },
      { id: "aSecond", groupId: "A" },
    ];
    const s = survivors(ranked, rule({ scope: "perFlight", count: 1 }));
    expect([...s].sort()).toEqual(["aLeader", "bLeader"]);
  });

  it("treats a field with no flights as one group", () => {
    const flat = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }));
    expect(survivors(flat, rule({ scope: "perFlight", count: 3 })).size).toBe(3);
  });

  it("rejects an unknown scope", () => {
    expect(isCutScope("overall")).toBe(true);
    expect(isCutScope("perFlight")).toBe(true);
    expect(isCutScope("perGroup")).toBe(false);
  });
});

describe("describing the cut before it happens", () => {
  it("spells out the total for a per-flight count", () => {
    // "Top 2" is ambiguous until you know how many flights there are.
    expect(describeCut(rule({ scope: "perFlight", count: 2 }), 32, 4)).toContain("8 in total");
  });

  it("gives the actual number for an overall cut", () => {
    expect(describeCut(rule({ count: 16 }), 32, 4)).toContain("Top 16 of 32");
  });

  it("gives the number for an overall percentage", () => {
    expect(describeCut(rule({ mode: "percent", percent: 25 }), 32, 4)).toContain("8 of 32");
  });
});

describe("a cut that cuts nobody", () => {
  // The default cut count is a fixed 16, so a club that enables a cut on a
  // field of 16 or fewer advances everyone and reads "16 of 16 advance" — a
  // cut line that does nothing. The number is deliberately left as-is; this is
  // the flag that lets the screen say so.

  it("flags an overall count cut as big as the field", () => {
    expect(cutAdvancesEveryone(rule({ count: 16 }), 16)).toBe(true);
    expect(cutAdvancesEveryone(rule({ count: 16 }), 15)).toBe(true); // clamped, still everyone
  });

  it("does not flag an overall cut that actually removes players", () => {
    expect(cutAdvancesEveryone(rule({ count: 16 }), 32)).toBe(false);
  });

  it("flags a percentage of 100 or more, which keeps the whole field", () => {
    expect(cutAdvancesEveryone(rule({ mode: "percent", percent: 100 }), 40)).toBe(true);
    expect(cutAdvancesEveryone(rule({ mode: "percent", percent: 50 }), 40)).toBe(false);
  });

  it("measures a per-flight cut against the largest flight, not the whole field", () => {
    // Overall the field is 24, so a top-16 count looks like a real cut — but
    // per flight it is applied inside each flight, and no flight has 16, so
    // every flight advances everyone.
    const rule16 = rule({ scope: "perFlight", count: 16 });
    expect(cutAdvancesEveryone(rule16, 24, [8, 8, 8])).toBe(true);
    // A top-4 per-flight cut on flights of eight removes half of each.
    expect(cutAdvancesEveryone(rule({ scope: "perFlight", count: 4 }), 24, [8, 8, 8])).toBe(false);
  });

  it("uses the biggest flight, so an uneven draw still counts as cutting", () => {
    // Flights of 9 and 3: top-5 per flight advances all of the small flight
    // but only five of the large one — it still cuts, so it is not a no-op.
    expect(cutAdvancesEveryone(rule({ scope: "perFlight", count: 5 }), 12, [9, 3])).toBe(false);
  });

  it("never reports a no-op for an empty field", () => {
    expect(cutAdvancesEveryone(rule({ count: 16 }), 0)).toBe(false);
    expect(cutAdvancesEveryone(rule({ scope: "perFlight", count: 16 }), 0, [])).toBe(false);
  });
});

describe("a deadline the organizer controls", () => {
  it("counts the deadline day itself as still open", () => {
    const on = new Date("2026-06-14T12:00:00");
    expect(deadlinePassed("2026-06-14", on)).toBe(false);
    expect(deadlineState("2026-06-14", null, on).open).toBe(true);
  });

  it("closes the day after", () => {
    const after = new Date("2026-06-15T12:00:00");
    expect(deadlineState("2026-06-14", null, after).state).toBe("closed");
  });

  it("extends past it when the organizer says so", () => {
    const after = new Date("2026-06-15T12:00:00");
    const s = deadlineState("2026-06-14", false, after);
    expect(s.state).toBe("extended");
    expect(s.open).toBe(true);
    expect(s.overridden).toBe(true);
  });

  it("closes early when the organizer says so", () => {
    const before = new Date("2026-06-01T12:00:00");
    const s = deadlineState("2026-06-14", true, before);
    expect(s.state).toBe("closed-manual");
    expect(s.open).toBe(false);
  });

  it("treats 'keep open' before the deadline as a no-op", () => {
    const before = new Date("2026-06-01T12:00:00");
    expect(deadlineState("2026-06-14", false, before).state).toBe("open");
  });

  it("ignores a deadline it cannot read", () => {
    expect(deadlineState("Sat 14 Jun", null, new Date("2030-01-01")).open).toBe(true);
    expect(deadlineState("", null, new Date("2030-01-01")).open).toBe(true);
    expect(isIsoDate("Sat 14 Jun")).toBe(false);
  });

  it("formats today the same way a date input does", () => {
    expect(todayIso(new Date("2026-06-04T23:00:00"))).toBe("2026-06-04");
    expect(todayIso(new Date("2026-11-30T00:30:00"))).toBe("2026-11-30");
  });
});
