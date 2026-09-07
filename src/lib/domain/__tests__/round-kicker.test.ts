import { describe, it, expect } from "vitest";
import { roundKicker } from "../round-label";

/**
 * A kicker is the small, upper-cased, letter-spaced line above a heading —
 * a LABEL slot, not a prose slot.
 *
 * Both player screens filled it from the round's description, which holds
 * whatever the organizer typed and, from a template, a whole sentence. The
 * seeded round robin's is "Every player meets every other in their group over
 * 3 rounds.", which arrived on screen as
 *
 *   EVERY PLAYER MEETS EVERY OTHER IN THEIR GROUP OVER 3 ROUNDS.
 *
 * across two lines above a heading reading "Board".
 */
describe("what may go in a kicker", () => {
  it("keeps a description that reads as a label", () => {
    // The whole reason the description is preferred at all: an organizer's own
    // name for a round beats any number the app can generate.
    expect(roundKicker("Semi-finals", "Round 3")).toBe("Semi-finals");
    expect(roundKicker("Match 3 of 5", "Round 3")).toBe("Match 3 of 5");
    expect(roundKicker("  Final round  ", "Round 4")).toBe("Final round");
  });

  it("refuses a sentence, and says Round 3 instead", () => {
    // The sharper of the two tests: a label does not end in a full stop.
    expect(roundKicker("Every player meets every other in their group over 3 rounds.", "Round 1")).toBe("Round 1");
    expect(roundKicker("Who wins?", "Round 2")).toBe("Round 2");
    expect(roundKicker("Play well!", "Round 2")).toBe("Round 2");
  });

  it("refuses one that rambles without ever reaching a full stop", () => {
    // The length cap exists for exactly this — punctuation alone would let it
    // through.
    const rambling = "The one where everybody plays everybody else";
    expect(rambling.endsWith(".")).toBe(false);
    expect(roundKicker(rambling, "Round 1")).toBe("Round 1");
  });

  it("falls back when there is no description at all", () => {
    expect(roundKicker("", "Round 1")).toBe("Round 1");
    expect(roundKicker(null, "Round 1")).toBe("Round 1");
    expect(roundKicker(undefined, "Round 1")).toBe("Round 1");
    expect(roundKicker("   ", "Round 1")).toBe("Round 1");
  });

  it("returns the fallback verbatim, whatever it is", () => {
    // The caller owns the fallback — "Round 3", the stage type, "Standings" —
    // and this must not second-guess it.
    expect(roundKicker("A sentence about the round.", "Round Robin")).toBe("Round Robin");
    expect(roundKicker("A sentence about the round.", "")).toBe("");
  });
});
