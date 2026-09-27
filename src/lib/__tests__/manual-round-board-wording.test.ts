import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A HAND-SCORED ROUND'S BOARD MAKES NO PROMISE ABOUT WHEN.
 *
 * The finished Festival of Formats' public board — its last round is scored by
 * hand — read "the committee works out the result and posts it when it is
 * settled" directly above "Final · these scores no longer change" (walked
 * 2026-09-27 as the anonymous viewer). Both boards say the same thing now, and
 * nothing in the future tense.
 */
describe("the board for a round scored by hand", () => {
  const live = () => readSource("src", "app", "live", "[token]", "page.tsx");
  const player = () => readSource("src", "app", "(player)", "me", "board", "page.tsx");

  it("on the public board", () => {
    expect(live()).toContain("There is no leaderboard for it here — the committee works out the result.");
    expect(live()).not.toMatch(/posts it when/);
    expect(live()).not.toMatch(/no live leaderboard/);
  });

  it("on the player's Board", () => {
    expect(player()).toContain("so there is no board for it here — the committee works out the result.");
    expect(player()).not.toMatch(/when it's settled/);
  });
});
