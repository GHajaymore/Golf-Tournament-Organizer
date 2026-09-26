import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * NO ROUNDS, NO BOARD.
 *
 * Found 2026-09-26 on the seeded Captain's Day — eighteen entered, no round
 * added: the Live leaderboard said "Overall standings · stroke play (gross /
 * net / to-par)" over eighteen rows of dashes. The format was a default, not a
 * fact. The page is a server component, so its first decision is pinned here;
 * `verify-lifecycle.mjs` renders it at the "named only" stage and requires the
 * heading it keeps.
 */
describe("the Live leaderboard before any round exists", () => {
  const src = readSource("src/app/(app)/leaderboard/page.tsx");
  const at = src.indexOf("if (!state.stages.some((s) => isPlayingRound(s.type)))");

  it("checks for a playing round before building any board", () => {
    expect(at, "no early no-rounds branch").toBeGreaterThan(0);
    // Before the first board kind is chosen — nothing below may run first.
    expect(at).toBeLessThan(src.indexOf('if (kind === "manual")'));
  });

  it("says so, keeps its heading, and names where to fix it", () => {
    const branch = src.slice(at, src.indexOf('if (kind === "manual")'));
    expect(branch).toMatch(/No rounds yet/);
    expect(branch).toMatch(/<h1 className="page-title">Live leaderboard<\/h1>/);
    expect(branch).toMatch(/href="\/stages"/);
  });
});
