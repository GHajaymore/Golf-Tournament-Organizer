import { describe, it, expect } from "vitest";
import {
  awardOrder,
  isGrossPrize,
  looksLikeSkillPrize,
  onePrizeClashes,
  onePrizeRefusal,
  onePrizeTickRefusal,
  pickerFor,
  type PrizeHolding,
} from "../one-prize";
import { PRIZE_STRUCTURES, prizeStructureLines } from "../prize-structures";

/**
 * ONE PRIZE PER PLAYER (Ajay, 2026-10-21, C1).
 *
 * The rule as a club states it: with the box ticked, nobody ends up holding two
 * PLACING prizes. So the expectation here is worked out by the other route from
 * the code's: APPLY the award to a copy of the list, then COUNT what the player
 * holds. The code instead looks for one other prize before the award. Every
 * list of three lines, every way of having awarded them among three players,
 * and every award of every line to every player (and to nobody) is walked, with
 * the box on and off.
 */

const PLAYERS = ["ann", "bea", "cat"];
const NAMES: Record<string, string> = { ann: "Ann Example", bea: "Bea Example", cat: "Cat Example" };

/** Every way of awarding `n` lines among the players, nobody included. */
function assignments(n: number): Array<Array<string | null>> {
  if (n === 0) return [[]];
  const rest = assignments(n - 1);
  return [null, ...PLAYERS].flatMap((w) => rest.map((r) => [w, ...r]));
}

/** The rule's own statement: after the award, does the player hold at most one counting prize? */
function allowedByCounting(on: boolean, prizes: PrizeHolding[], prizeId: string, playerId: string): boolean {
  if (!on) return true;
  const after = prizes.map((p) => (p.id === prizeId ? { ...p, winnerId: playerId || null } : p));
  if (!playerId) return true;
  return after.filter((p) => p.counts && p.winnerId === playerId).length <= 1;
}

describe("who may receive a prize under one prize per player", () => {
  it("agrees with applying the award and counting, over every small list, both ways round", () => {
    let walked = 0;
    let refused = 0;
    let skipped = 0;
    for (const counts of [
      [true, true, true],
      [true, true, false],
      [true, false, false],
      [false, false, false],
    ]) {
      for (const winners of assignments(3)) {
        const prizes: PrizeHolding[] = winners.map((w, i) => ({
          id: `p${i}`,
          category: ["Best gross", "Best net", "Nearest the pin"][i],
          winnerId: w,
          counts: counts[i],
        }));
        for (const on of [true, false]) {
          // With the box on, a list where somebody ALREADY holds two counting
          // prizes cannot exist — the tick, the award and the line's switch
          // each refuse to make one — so it is not a state to judge an award in.
          if (on && onePrizeClashes(prizes).length > 0) {
            skipped += 1;
            continue;
          }
          for (const p of prizes) {
            for (const who of ["", ...PLAYERS]) {
              const refusal = onePrizeRefusal({ on, prizes, prizeId: p.id, playerId: who, playerName: NAMES[who] ?? "" });
              const allowed = allowedByCounting(on, prizes, p.id, who);
              expect(refusal === null, `${JSON.stringify({ on, prizes, award: p.id, who })}`).toBe(allowed);
              walked += 1;
              if (refusal) refused += 1;
            }
          }
        }
      }
    }
    // The walk can tell the two answers apart: it refused, and it allowed.
    expect(walked + skipped * 3 * 4).toBe(4 * 64 * 2 * 3 * 4);
    expect(skipped).toBeLessThan(4 * 64);
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(walked);
  });

  const list: PrizeHolding[] = [
    { id: "g", category: "Best gross", winnerId: "ann", counts: true },
    { id: "n", category: "Best net", winnerId: null, counts: true },
    { id: "k", category: "Nearest the pin", winnerId: null, counts: false },
  ];

  it("refuses a second placing prize, in words that name the player, the prize and the remedy", () => {
    expect(onePrizeRefusal({ on: true, prizes: list, prizeId: "n", playerId: "ann", playerName: "Ann Example" })).toBe(
      "Ann Example already has Best gross. This tournament gives one prize per player — choose the next player.",
    );
  });

  it("lets the same player take a skill prize — nearest the pin does not count", () => {
    expect(onePrizeRefusal({ on: true, prizes: list, prizeId: "k", playerId: "ann", playerName: "Ann Example" })).toBeNull();
    // And a skill prize held is not a placing prize held.
    const withPin = list.map((p) => (p.id === "k" ? { ...p, winnerId: "bea" } : p));
    expect(onePrizeRefusal({ on: true, prizes: withPin, prizeId: "n", playerId: "bea", playerName: "Bea Example" })).toBeNull();
  });

  it("does not refuse re-awarding a prize to the player who already holds it", () => {
    expect(onePrizeRefusal({ on: true, prizes: list, prizeId: "g", playerId: "ann", playerName: "Ann Example" })).toBeNull();
  });

  it("never refuses clearing a winner", () => {
    expect(onePrizeRefusal({ on: true, prizes: list, prizeId: "g", playerId: "", playerName: "" })).toBeNull();
  });

  it("CONTROL: with the box off, a player may hold two placing prizes", () => {
    expect(onePrizeRefusal({ on: false, prizes: list, prizeId: "n", playerId: "ann", playerName: "Ann Example" })).toBeNull();
  });

  it("says how to put gross first when the net was awarded first", () => {
    const netFirst: PrizeHolding[] = [
      { id: "g", category: "Best gross", winnerId: null, counts: true },
      { id: "n", category: "Best net", winnerId: "ann", counts: true },
    ];
    expect(onePrizeRefusal({ on: true, prizes: netFirst, prizeId: "g", playerId: "ann", playerName: "Ann Example" })).toBe(
      "Ann Example already has Best net. This tournament gives one prize per player, gross first — clear Best net to give Best gross here, or choose the next player.",
    );
  });
});

describe("ticking the box", () => {
  const name = (id: string) => NAMES[id] ?? "";

  it("is refused while somebody holds two counting prizes, naming them and both prizes", () => {
    const two: PrizeHolding[] = [
      { id: "w", category: "Winner", winnerId: "ann", counts: true },
      { id: "g", category: "Best gross", winnerId: "ann", counts: true },
      { id: "n", category: "Best net", winnerId: "bea", counts: true },
    ];
    expect(onePrizeClashes(two)).toEqual([{ playerId: "ann", categories: ["Winner", "Best gross"] }]);
    expect(onePrizeTickRefusal(two, name)).toBe(
      "Ann Example has Winner and Best gross. Clear one of them before giving one prize per player.",
    );
  });

  it("is allowed where the second prize is a skill prize, or nobody holds two", () => {
    const pin: PrizeHolding[] = [
      { id: "g", category: "Best gross", winnerId: "ann", counts: true },
      { id: "k", category: "Nearest the pin", winnerId: "ann", counts: false },
      { id: "n", category: "Best net", winnerId: "bea", counts: true },
    ];
    expect(onePrizeTickRefusal(pin, name)).toBeNull();
    expect(onePrizeTickRefusal([], name)).toBeNull();
  });

  it("names everybody who clashes", () => {
    const many: PrizeHolding[] = [
      { id: "1", category: "Winner", winnerId: "ann", counts: true },
      { id: "2", category: "Best gross", winnerId: "ann", counts: true },
      { id: "3", category: "Runner-up", winnerId: "bea", counts: true },
      { id: "4", category: "Best net", winnerId: "bea", counts: true },
    ];
    expect(onePrizeTickRefusal(many, name)).toBe(
      "Ann Example has Winner and Best gross and Bea Example has Runner-up and Best net. Clear the extra awards before giving one prize per player.",
    );
  });
});

describe("gross first", () => {
  const lines = [
    { id: "w", category: "Winner", counts: true },
    { id: "k", category: "Nearest the pin", counts: false },
    { id: "n", category: "Best net", counts: true },
    { id: "g", category: "Best gross", counts: true },
    { id: "fg", category: "Flight A — Gross winner", counts: true },
  ];

  it("awards the gross lines first, then the other placings, then the skill prizes, each in list order", () => {
    expect(awardOrder(lines, true).map((l) => l.id)).toEqual(["g", "fg", "w", "n", "k"]);
  });

  it("CONTROL: with the box off the committee's order stands", () => {
    expect(awardOrder(lines, false).map((l) => l.id)).toEqual(["w", "k", "n", "g", "fg"]);
  });

  it("reads a gross prize by its name, and not one that is gross and net", () => {
    expect(isGrossPrize("Best gross")).toBe(true);
    expect(isGrossPrize("Gross and net combined")).toBe(false);
    expect(isGrossPrize("Best net")).toBe(false);
  });
});

describe("the winner picker", () => {
  const field = [
    { id: "ann", name: "Ann Example", place: 1 },
    { id: "bea", name: "Bea Example", place: 2 },
    { id: "cat", name: "Cat Example", place: 3 },
  ];
  const prizes: PrizeHolding[] = [
    { id: "g", category: "Best gross", winnerId: "ann", counts: true },
    { id: "n", category: "Best net", winnerId: null, counts: true },
    { id: "k", category: "Nearest the pin", winnerId: null, counts: false },
  ];

  it("puts a holder out of the way, saying what they hold, and suggests the first who holds nothing", () => {
    const p = pickerFor(field, prizes, "n", true);
    expect(p.free.map((o) => [o.id, o.suggested])).toEqual([
      ["bea", true],
      ["cat", false],
    ]);
    expect(p.holding).toEqual([{ id: "ann", name: "Ann Example", place: 1, holds: "Best gross" }]);
  });

  it("offers a skill prize, and the box off, in finishing order with nobody set aside", () => {
    expect(pickerFor(field, prizes, "k", true).holding).toEqual([]);
    expect(pickerFor(field, prizes, "n", false).free.map((o) => o.id)).toEqual(["ann", "bea", "cat"]);
    expect(pickerFor(field, prizes, "n", false).free.some((o) => o.suggested)).toBe(false);
  });
});

describe("what counts", () => {
  it("the structures add their skill lines as not counting and every placing line as counting", () => {
    const ctx = { flights: ["Flight A", "Flight B"] };
    const all = PRIZE_STRUCTURES.flatMap((s) => prizeStructureLines(s.key, ctx));
    const skill = all.filter((l) => !l.counts).map((l) => l.category);
    expect(skill).toEqual(["Nearest the pin", "Longest drive"]);
    // Each structure's lines agree with the name-reader a hand-typed line is defaulted by.
    for (const l of all) expect(looksLikeSkillPrize(l.category), l.category).toBe(!l.counts);
  });

  it("reads a hand-typed skill prize by its name, and a placing prize as counting", () => {
    for (const s of ["Closest to Pin (Hole 7)", "KP 12th", "Longest drive, 9th", "Long drive", "Twos", "Straightest drive", "Hole in one"]) {
      expect(looksLikeSkillPrize(s), s).toBe(true);
    }
    for (const s of ["Winner", "Runner-up", "Best gross", "Best net", "Flight A — Winner", "Day two winner", "Longest-serving member's salver"]) {
      expect(looksLikeSkillPrize(s), s).toBe(false);
    }
  });
});
