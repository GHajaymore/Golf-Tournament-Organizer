import { describe, it, expect } from "vitest";
import { roundStanding } from "@/lib/domain/round-standing";

/**
 * A POSITION IS NOT A FACT ABOUT WHETHER A ROUND HAS BEEN PLAYED.
 *
 * The chip on Rounds & formats came from the round's index against a single
 * pointer, so everything after the active round read "Upcoming" whatever the
 * field had done. Measured on the seeded Demo Cup, 2026-09-16: Round 2 chipped
 * Upcoming with seven of thirty-three scorecards in, while the dashboard called
 * the same round current and the leaderboard was ranking it.
 *
 * Asserted against the question the chip is actually asked — "can I still
 * change this round safely" — rather than against what the code did.
 */

const at = (index: number, activeIndex: number, hasResult = false) =>
  roundStanding({ isActive: index === activeIndex, index, activeIndex, hasResult });

describe("the ordinary sequence still reads the way it did", () => {
  it("calls the round being played active", () => {
    expect(at(1, 1)).toBe("active");
  });

  it("calls a round behind it played", () => {
    expect(at(0, 1)).toBe("played");
  });

  it("calls an untouched round ahead of it upcoming", () => {
    expect(at(2, 1)).toBe("upcoming");
  });

  it("calls everything upcoming before a tournament starts", () => {
    // No active round at all — nothing is behind anything.
    expect(at(0, -1)).toBe("upcoming");
    expect(at(3, -1)).toBe("upcoming");
  });
});

describe("a round ahead of the active one that has been started", () => {
  it("is not upcoming", () => {
    /**
     * THE DEFECT, in one line. Demo Cup's Round 2: index 1, active index 0,
     * seven cards returned.
     */
    expect(at(1, 0, true)).not.toBe("upcoming");
    expect(at(1, 0, true)).toBe("active");
  });

  it("is still upcoming when nothing has been returned for it", () => {
    // THE CONTROL. Without this the rule could be "never say upcoming", which
    // would be just as wrong and would pass every assertion above it.
    expect(at(1, 0, false)).toBe("upcoming");
  });

  it("holds several rounds ahead, not just the next one", () => {
    // A knockout three rounds away with a recorded winner is under way too.
    expect(at(3, 0, true)).toBe("active");
    expect(at(3, 0, false)).toBe("upcoming");
  });
});

describe("what a result does NOT change", () => {
  it("a round behind the active one stays played, result or not", () => {
    /**
     * Both directions on purpose. A round the field skipped entirely is still
     * behind us and must not climb back to "upcoming"; a round that was played
     * must not be re-described as active just because it has cards in it.
     */
    expect(at(0, 2, true)).toBe("played");
    expect(at(0, 2, false)).toBe("played");
  });

  it("the active round is active whether or not anybody has started it", () => {
    expect(at(1, 1, false)).toBe("active");
    expect(at(1, 1, true)).toBe("active");
  });
});
