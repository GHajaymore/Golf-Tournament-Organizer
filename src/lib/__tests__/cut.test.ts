import { describe, it, expect } from "vitest";
import {
  survivors,
  survivorCount,
  cutAdvancesEveryone,
  reflightSurvivors,
  nextRoundFlights,
  describeCut,
  currentRoundCut,
  currentRoundCutRule,
  isCutScope,
  type CutCandidate,
  type CutRule,
  type RoundCutFields,
} from "../domain/cut";
import type { Player } from "../domain/types";
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

describe("re-flighting the survivors of a cut", () => {
  // A flighted field of 24 (three flights of eight) with an overall cut. The
  // best six across everyone survive, and they happen to come out 4 from flight
  // A, 1 from B, 1 from C — the shape that strands the two lone survivors when
  // the next round is drawn inside the old flights.
  const survivorField = (): Player[] => {
    const out: Player[] = [];
    const add = (id: string, group: string, hcp: number, seed: number) =>
      out.push({ id, name: id, handicap: hcp, seed, groupId: group });
    add("a1", "A", 2, 1);
    add("a2", "A", 5, 2);
    add("a3", "A", 8, 3);
    add("a4", "A", 11, 4);
    add("b1", "B", 6, 5);
    add("c1", "C", 9, 6);
    return out;
  };

  it("reforms an overall cut's survivors so every one of them has an opponent", () => {
    // The bug: b1 and c1 are alone in their old flights, so a round robin drawn
    // per flight gives them no matches. Pooled and reformed against the
    // original flight size of eight, six survivors make a single flight — and
    // everybody in it has five opponents.
    const flights = nextRoundFlights(survivorField(), "overall", 8);
    const placed = flights.flatMap((f) => f.playerIds);
    expect(placed.sort()).toEqual(["a1", "a2", "a3", "a4", "b1", "c1"]);
    for (const f of flights) {
      expect(f.playerIds.length, "no flight of one after a reform").toBeGreaterThanOrEqual(2);
      expect(f.keepGroupId, "a reformed flight is not an old flight").toBeNull();
    }
    expect(flights).toHaveLength(1);
  });

  it("leaves a per-flight cut's flights exactly as they were", () => {
    // The ordinary case, and the one this rule exists for: every flight still
    // has players to play each other, so nothing moves. Survivors keep their
    // flight and its mates, and the arrangement is untouched.
    const twoApiece: Player[] = [
      { id: "a1", name: "a1", handicap: 2, seed: 1, groupId: "A" },
      { id: "a2", name: "a2", handicap: 5, seed: 2, groupId: "A" },
      { id: "b1", name: "b1", handicap: 6, seed: 3, groupId: "B" },
      { id: "b2", name: "b2", handicap: 9, seed: 4, groupId: "B" },
    ];
    const flights = nextRoundFlights(twoApiece, "perFlight", 8);
    const byGroup = Object.fromEntries(flights.map((f) => [f.keepGroupId, f.playerIds.sort()]));
    expect(byGroup).toEqual({ A: ["a1", "a2"], B: ["b1", "b2"] });
    for (const f of flights) expect(f.keepGroupId).not.toBeNull();
  });

  it("pools a per-flight cut that would leave somebody on their own", () => {
    /**
     * This test used to assert `B: ["b1"], C: ["c1"]` — two flights of ONE —
     * under a comment reading "nobody is stranded by a per-flight cut". Both
     * of those players were stranded: a round robin of one draws no pairings,
     * the caller drops any flight under two, and they were simply not in the
     * round. A cut of "1 from each of 3 flights" produced an empty round.
     *
     * A per-flight cut down to one means the flight winners go through, and
     * flight winners play each other. So the survivors are pooled.
     */
    const flights = nextRoundFlights(survivorField(), "perFlight", 8);
    const placed = flights.flatMap((f) => f.playerIds);

    expect(placed.sort()).toEqual(["a1", "a2", "a3", "a4", "b1", "c1"]);
    for (const f of flights) {
      expect(f.playerIds.length, "no flight of one after pooling").toBeGreaterThanOrEqual(2);
      expect(f.keepGroupId, "a pooled flight is not an old flight").toBeNull();
    }
  });

  it("splits into several balanced flights when the target size is small", () => {
    const flights = reflightSurvivors(survivorField(), 2);
    expect(flights).toHaveLength(3); // six survivors, ~two apiece
    for (const f of flights) expect(f.playerIds.length).toBeGreaterThanOrEqual(2);
  });

  it("never leaves a flight of one, even at an awkward count", () => {
    // Five survivors with a target of two would naively be 3,2 → a flight of
    // one is impossible, but the risk is a 2,2,1 split; the ⌊n/2⌋ cap forbids
    // it, so the worst case is a flight of three.
    const five = survivorField().slice(0, 5);
    for (const f of reflightSurvivors(five, 2)) {
      expect(f.playerIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("falls back to a single flight when too few survive to split", () => {
    const three = survivorField().slice(0, 3);
    expect(reflightSurvivors(three, 8)).toHaveLength(1);
  });

  it("emits nothing when a single player survives — a round robin of one", () => {
    expect(reflightSurvivors(survivorField().slice(0, 1), 8)).toEqual([]);
    expect(nextRoundFlights(survivorField().slice(0, 1), "overall", 8)).toEqual([]);
  });
});

describe("the cut line for the current round", () => {
  // The dashboard shows this for a tournament that cuts round to round with no
  // knockout to qualify into. The cut lives on the round it feeds, so the cut
  // out of the active round is the NEXT round's.
  const round = (over: Partial<RoundCutFields> = {}): RoundCutFields => ({
    cutEnabled: false,
    cutMode: "count",
    cutCount: 16,
    cutPercent: 50,
    cutScope: "overall",
    ...over,
  });

  it("reads the cut from the round the survivors advance into", () => {
    const rounds = [round(), round({ cutEnabled: true, cutCount: 8 })];
    const line = currentRoundCut(rounds, 0);
    expect(line).not.toBeNull();
    expect(line).toMatchObject({ fromRound: 1, toRound: 2 });
    expect(line!.label).toBe("Round 1 → Round 2 · top 8 advance");
  });

  it("phrases a percentage cut", () => {
    const rounds = [round(), round({ cutEnabled: true, cutMode: "percent", cutPercent: 25 })];
    expect(currentRoundCut(rounds, 0)!.label).toBe("Round 1 → Round 2 · top 25% advance");
  });

  it("names the per-flight scope so 'top N' isn't read as the whole field", () => {
    const rounds = [round(), round({ cutEnabled: true, cutCount: 4, cutScope: "perFlight" })];
    expect(currentRoundCut(rounds, 0)!.advance).toBe("top 4 per flight advance");
  });

  it("numbers the rounds from the active one, not always 1→2", () => {
    const rounds = [round(), round(), round({ cutEnabled: true, cutCount: 6 })];
    expect(currentRoundCut(rounds, 1)!.label).toBe("Round 2 → Round 3 · top 6 advance");
  });

  it("shows nothing when the next round has no cut", () => {
    expect(currentRoundCut([round(), round()], 0)).toBeNull();
  });

  it("shows nothing on the last round — there is nothing to advance into", () => {
    expect(currentRoundCut([round(), round({ cutEnabled: true })], 1)).toBeNull();
  });

  it("shows nothing when there is no active round", () => {
    expect(currentRoundCut([round({ cutEnabled: true })], -1)).toBeNull();
  });

  it("exposes the receiving round's config as a CutRule for the highlight", () => {
    const rounds = [round(), round({ cutEnabled: true, cutMode: "percent", cutPercent: 30, cutScope: "perFlight" })];
    expect(currentRoundCutRule(rounds, 0)).toEqual({ scope: "perFlight", mode: "percent", count: 16, percent: 30 });
  });

  it("gives the highlight and the label the same rule — the CDG shape cuts to top 4, not 8", () => {
    // The bug this closes: a 4-flight event highlighted qualifyPerGroup (2/flight
    // = 8) regardless of the top-4 the organizer set. The rule that labels the
    // card must be the one that picks the surviving players.
    const rounds = [round(), round({ cutEnabled: true, cutCount: 4, cutScope: "overall" })];
    const rule = currentRoundCutRule(rounds, 0)!;
    const ranked: CutCandidate[] = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, groupId: `g${i % 4}` }));
    expect(survivors(ranked, rule).size).toBe(4);
    expect(currentRoundCut(rounds, 0)!.advance).toBe("top 4 advance");
  });

  it("returns no rule when there is nothing to cut into", () => {
    expect(currentRoundCutRule([round(), round()], 0)).toBeNull();
    expect(currentRoundCutRule([round(), round({ cutEnabled: true })], 1)).toBeNull();
    expect(currentRoundCutRule([round({ cutEnabled: true })], -1)).toBeNull();
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
