import { describe, it, expect } from "vitest";
import { hasPins, parsePinSheet, pinLong, pinShort, readPin, readPinSheet } from "../pin-sheet";

/**
 * The pin sheet is caller-supplied data on a public endpoint, and a wrong one
 * sends a field to the wrong side of every green. The boundary is the thing
 * worth pinning: what is refused, and which hole the refusal names.
 */
describe("reading one hole position", () => {
  it("reads the card notation's three parts", () => {
    expect(readPin({ on: 22, side: "R", off: 6 })).toEqual({ pin: { on: 22, side: "R", off: 6 } });
    // Typed into a box, so it arrives as text.
    expect(readPin({ on: "18", side: "L", off: "4" })).toEqual({ pin: { on: 18, side: "L", off: 4 } });
  });

  it("a centre pin has no distance from a side, whatever was sent", () => {
    expect(readPin({ on: 30, side: "C", off: 9 })).toEqual({ pin: { on: 30, side: "C", off: 0 } });
  });

  it("an empty row is no position rather than an error", () => {
    expect(readPin(null)).toEqual({ pin: null });
    expect(readPin({ on: "", side: "C", off: "" })).toEqual({ pin: null });
  });

  it("refuses what no green holds", () => {
    expect(readPin({ on: 0, side: "C" }).error).toMatch(/1 to 60/);
    expect(readPin({ on: 61, side: "C" }).error).toMatch(/1 to 60/);
    expect(readPin({ on: 12.5, side: "C" }).error).toMatch(/whole number/);
    expect(readPin({ on: 20, side: "R", off: 0 }).error).toMatch(/right/);
    expect(readPin({ on: 20, side: "L", off: 31 }).error).toMatch(/left/);
    expect(readPin({ on: 20, side: "X", off: 3 }).error).toMatch(/left, centre or right/);
    // A distance from the side with nothing on is a half-typed row, not a blank one.
    expect(readPin({ on: "", side: "R", off: "5" }).error).toMatch(/Paces on/);
  });

  it("CONTROL: the limits themselves are allowed", () => {
    expect(readPin({ on: 1, side: "L", off: 1 }).pin).not.toBeNull();
    expect(readPin({ on: 60, side: "R", off: 30 }).pin).not.toBeNull();
  });
});

describe("a whole sheet", () => {
  it("names the hole to fix", () => {
    const raw = [{ on: 20, side: "C" }, null, { on: 99, side: "C" }];
    expect(readPinSheet(raw, 9).error).toBe("Hole 3: Paces on must be a whole number from 1 to 60.");
  });

  it("is sized to the round, and refuses more holes than it has", () => {
    expect(readPinSheet([{ on: 20, side: "C" }], 9).sheet).toHaveLength(9);
    expect(readPinSheet(new Array(18).fill(null), 9).error).toMatch(/9 holes/);
  });

  it("round-trips through storage", () => {
    const { sheet } = readPinSheet([{ on: 22, side: "R", off: 6 }, null, { on: 15, side: "L", off: 3 }], 9);
    const back = parsePinSheet(JSON.stringify(sheet), 9);
    expect(back).toEqual(sheet);
    expect(hasPins(back)).toBe(true);
    expect(hasPins(parsePinSheet("", 9))).toBe(false);
    expect(parsePinSheet("not json", 9)).toEqual([]);
  });
});

describe("how it reads", () => {
  it("in card notation and aloud", () => {
    expect(pinShort({ on: 22, side: "R", off: 6 })).toBe("22 / 6R");
    expect(pinShort({ on: 18, side: "C", off: 0 })).toBe("18 / C");
    expect(pinLong({ on: 22, side: "R", off: 6 })).toBe("22 paces on, 6 from the right");
    expect(pinLong({ on: 9, side: "L", off: 4 })).toBe("9 paces on, 4 from the left");
    expect(pinLong({ on: 18, side: "C", off: 0 })).toBe("18 paces on, centre");
    expect(pinShort(null)).toBe("");
  });
});
