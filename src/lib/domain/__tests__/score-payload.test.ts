import { describe, it, expect } from "vitest";
import {
  cleanHoleResults,
  cleanStrokes,
  cleanWinner,
  cleanMargin,
  MAX_STROKES_PER_HOLE,
} from "../score-payload";

/**
 * These payloads arrive from a browser over a public endpoint. The TypeScript
 * signature on the action is erased at runtime and guarantees nothing, so the
 * cases that matter are the ones a normal client would never send.
 */

const nine = (v: unknown) => Array(9).fill(v);

describe("hole-by-hole results", () => {
  it("accepts a real card", () => {
    const card = ["A", "B", "H", "A", null, "B", "H", "A", "B"];
    expect(cleanHoleResults(card, 9)).toEqual(card);
  });

  it("refuses an array longer than the round", () => {
    // The finding this module exists for: holes.length drives nassau
    // segmentation and tiebreak hole selection, so forty entries on an
    // eighteen-hole round produces a result the course cannot generate.
    expect(cleanHoleResults(Array(40).fill("A"), 18)).toBeNull();
    expect(cleanHoleResults(Array(19).fill("A"), 18)).toBeNull();
  });

  it("refuses an array shorter than the round", () => {
    expect(cleanHoleResults(nine("A"), 18)).toBeNull();
  });

  it("refuses values outside A, B and H", () => {
    expect(cleanHoleResults([...Array(8).fill("A"), "X"], 9)).toBeNull();
    expect(cleanHoleResults([...Array(8).fill("A"), 1], 9)).toBeNull();
    expect(cleanHoleResults([...Array(8).fill("A"), { a: 1 }], 9)).toBeNull();
  });

  it("refuses anything that is not an array", () => {
    expect(cleanHoleResults(null, 18)).toBeNull();
    expect(cleanHoleResults("AAAA", 18)).toBeNull();
    expect(cleanHoleResults({ length: 18 }, 18)).toBeNull();
    expect(cleanHoleResults(undefined, 18)).toBeNull();
  });

  it("treats undefined entries as an unplayed hole", () => {
    // A sparse array from a client is a gap, not an attack.
    expect(cleanHoleResults(nine(undefined), 9)).toEqual(nine(null));
  });
});

describe("stroke cards", () => {
  it("accepts a real card", () => {
    const card = [4, 5, 3, 4, null, 4, 3, 4, 5];
    expect(cleanStrokes(card, 9)).toEqual(card);
  });

  it("refuses a wrong length", () => {
    expect(cleanStrokes(Array(30).fill(4), 18)).toBeNull();
    expect(cleanStrokes([4, 4], 9)).toBeNull();
  });

  it("refuses a score nobody wrote on a card", () => {
    // Rejected rather than clamped: turning a 0 into a 1 puts a number on the
    // leaderboard that no player recorded.
    expect(cleanStrokes([...Array(8).fill(4), 0], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), -3], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), MAX_STROKES_PER_HOLE + 1], 9)).toBeNull();
  });

  it("refuses non-integers and non-numbers", () => {
    expect(cleanStrokes([...Array(8).fill(4), 4.5], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), "4"], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), NaN], 9)).toBeNull();
    expect(cleanStrokes([...Array(8).fill(4), Infinity], 9)).toBeNull();
  });

  it("accepts the boundaries", () => {
    expect(cleanStrokes(nine(1), 9)).toEqual(nine(1));
    expect(cleanStrokes(nine(MAX_STROKES_PER_HOLE), 9)).toEqual(nine(MAX_STROKES_PER_HOLE));
  });
});

describe("winner and margin", () => {
  it("narrows the winner to the three real outcomes", () => {
    expect(cleanWinner("A")).toBe("A");
    expect(cleanWinner("H")).toBe("H");
    expect(cleanWinner("a")).toBeNull();
    expect(cleanWinner("winner")).toBeNull();
    expect(cleanWinner(null)).toBeNull();
    expect(cleanWinner(1)).toBeNull();
  });

  it("bounds the margin without dictating its wording", () => {
    // A committee words this its own way — "3&2", "2 up", "won by default" —
    // so it is bounded rather than enumerated.
    expect(cleanMargin("3&2")).toBe("3&2");
    expect(cleanMargin("  2 up  ")).toBe("2 up");
    expect(cleanMargin("x".repeat(500))).toHaveLength(24);
    expect(cleanMargin(null)).toBe("");
    expect(cleanMargin({})).toBe("");
  });
});
