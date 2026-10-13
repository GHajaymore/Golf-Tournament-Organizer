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

/**
 * A SIDE CHOSEN AND NOTHING TYPED IS NOT "THIS HOLE ISN'T SET" (2026-10-10).
 *
 * The control crawler chose L on a hole and pressed Save. The form answered
 * "Pin sheet cleared", and after a reload the hole read C again: a row was
 * sent only when a NUMBER had been typed, so a side on its own was dropped by
 * the form and never reached the check that would have named the hole. A
 * choice somebody made was thrown away and the screen called it a save.
 *
 * The side is part of the row. A row with L or R and no paces is an
 * unfinished position, and it is named like any other slip.
 */
describe("a side chosen with no paces", () => {
  it("is sent by the form, not dropped as an empty row", async () => {
    const { pinRowsPayload } = await import("../pin-sheet");
    const rows = [
      { on: "", side: "L" as const, off: "" },
      { on: "", side: "C" as const, off: "" },
      { on: "22", side: "R" as const, off: "6" },
    ];
    const sent = pinRowsPayload(rows);
    expect(sent[0], "the side was dropped before anything could check it").not.toBeNull();
    expect(sent[1], "CONTROL: an untouched row is still no position").toBeNull();
    expect(sent[2]).toEqual({ on: "22", side: "R", off: "6" });
  });

  it("is refused by name rather than read as no position", () => {
    for (const side of ["L", "R"]) {
      const res = readPin({ on: "", side, off: "" });
      expect(res.pin).toBeNull();
      expect(res.error ?? "", `a ${side} with no paces was read as "not set"`).toMatch(/paces on/i);
    }
    expect(readPinSheet([null, { on: "", side: "L", off: "" }], 18).error).toMatch(/^Hole 2: /);
  });

  it("CONTROL: a centre row with nothing typed is still simply not set", () => {
    expect(readPin({ on: "", side: "C", off: "" })).toEqual({ pin: null });
    expect(readPin({ on: "", off: "" })).toEqual({ pin: null });
  });

  /**
   * A PIN TAKEN AWAY (2026-10-13). 22 / 6R, moved to centre, its paces
   * deleted: on centre the "from the edge" box is greyed and drawn EMPTY, but
   * the row still held the 6. It was sent as an unfinished position and the
   * committee was refused — "Paces on must be a whole number" — over a hole
   * with nothing showing in it, so a sheet could not be cleared that way.
   * `e2e/round-day.spec.ts` found it, by typing a pin and taking it away.
   */
  it("a row moved to centre and emptied is not set, whatever is left in the box nobody can see", async () => {
    const { pinRowsPayload } = await import("../pin-sheet");
    const cleared = { on: "", side: "C" as const, off: "6" };
    expect(pinRowsPayload([cleared])[0], "a hole that shows nothing was sent as a position").toBeNull();
    // And the whole sheet then reads as cleared, not as hole 1 being wrong.
    const sheet = readPinSheet(pinRowsPayload([cleared, { on: "", side: "C", off: "" }]), 2);
    expect(sheet.error).toBeUndefined();
    expect(sheet.sheet.every((p) => p === null)).toBe(true);
    // CONTROL: the same leftover on a side that SHOWS its box is still an unfinished position, and is named.
    const unfinished = pinRowsPayload([{ on: "", side: "R" as const, off: "6" }]);
    expect(unfinished[0]).not.toBeNull();
    expect(readPinSheet(unfinished, 1).error ?? "").toMatch(/^Hole 1: .*paces on/i);
    // CONTROL: and a centre pin that IS set keeps its paces on and drops the hidden figure.
    expect(pinRowsPayload([{ on: "18", side: "C" as const, off: "6" }])[0]).toEqual({ on: "18", side: "C", off: 0 });
  });
});

describe("a refusal names the hole the committee is looking at", () => {
  it("on a back nine the second row is the 11th, not hole 2", () => {
    // The form numbers a back-nine round 10 to 18; the refusal said "Hole 2".
    expect(readPinSheet([null, { on: "", side: "L", off: "" }], 9, 10).error).toMatch(/^Hole 11: /);
  });

  it("CONTROL: and still counts from one when it is not told otherwise", () => {
    expect(readPinSheet([{ on: "99", side: "C", off: "" }], 18).error).toMatch(/^Hole 1: /);
  });
});
