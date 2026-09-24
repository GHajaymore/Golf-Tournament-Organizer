import { describe, expect, it } from "vitest";
import { PRIZE_STRUCTURES, prizeStructure, prizeStructureLines } from "../prize-structures";

/**
 * Prize structures add editable lines and never anything else — no amount, no
 * winner, no money maths. The one that reads the event (flight winners) must
 * SCALE with the field: the control here is a field with two flights and a
 * field with none, which a "three lines, always" implementation fails.
 */

describe("prize structures", () => {
  const noFlights = { flights: [] as string[] };
  const twoFlights = { flights: ["Flight 1", "Flight 2"] };
  const threeFlights = { flights: ["A Flight", "B Flight", "C Flight"] };

  it("top 3 overall names the three places", () => {
    expect(prizeStructureLines("overall-top-3", noFlights).map((l) => l.category)).toEqual([
      "Winner",
      "Runner-up",
      "Third place",
    ]);
  });

  it("best gross & net is two lines", () => {
    expect(prizeStructureLines("gross-net", noFlights).map((l) => l.category)).toEqual([
      "Best gross",
      "Best net",
    ]);
  });

  it("CONTROL: flight winners scales with the flights the field is in", () => {
    expect(prizeStructureLines("flight-winners", twoFlights).map((l) => l.category)).toEqual([
      "Flight 1 — Winner",
      "Flight 2 — Winner",
    ]);
    expect(prizeStructureLines("flight-winners", threeFlights)).toHaveLength(3);
    // No flights: nothing to add, rather than a blank or wrong row.
    expect(prizeStructureLines("flight-winners", noFlights)).toHaveLength(0);
  });

  it("twos and specials carry helpful detail, not just a category", () => {
    const twos = prizeStructureLines("twos", noFlights);
    expect(twos).toHaveLength(1);
    expect(twos[0].detail && twos[0].detail.length).toBeGreaterThan(0);

    const specials = prizeStructureLines("specials", noFlights);
    expect(specials.map((l) => l.category)).toEqual(["Nearest the pin", "Longest drive"]);
  });

  it("an unknown key adds nothing rather than throwing", () => {
    expect(prizeStructure("nope")).toBeNull();
    expect(prizeStructureLines("nope", threeFlights)).toEqual([]);
  });

  it("every catalogued structure has a key, a label, a blurb and produces named lines", () => {
    for (const s of PRIZE_STRUCTURES) {
      expect(s.key.trim(), "a structure with no key").not.toBe("");
      expect(s.label.trim(), `${s.key} has no label`).not.toBe("");
      expect(s.blurb.trim(), `${s.key} has no blurb`).not.toBe("");
      // Given a field with flights, every structure yields at least one line
      // and no blank category — the resolver filters blanks, so a structure
      // that produced one would be caught here.
      const lines = prizeStructureLines(s.key, threeFlights);
      expect(lines.length, `${s.key} produced no lines`).toBeGreaterThan(0);
      for (const line of lines) expect(line.category.trim()).not.toBe("");
    }
  });

  it("keys are unique, so a button and its action cannot collide", () => {
    const keys = PRIZE_STRUCTURES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
