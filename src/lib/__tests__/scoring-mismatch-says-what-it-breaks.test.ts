import { describe, it, expect } from "vitest";
import { scoringMismatch } from "@/lib/domain/scoring-mismatch";
import { readSource } from "./source";

/**
 * THE SCORING-SETTING WARNING SAYS WHAT IT STILL BREAKS (2026-10-08).
 *
 * Walked as the tournament grid's round robin: a tournament set to Stroke play
 * whose only round was match play. The banner read "Nothing here can be
 * ranked … the standings look for cards that match play does not return" —
 * directly above a table ranking all four players correctly, and a highlight
 * naming the leader. Boards rank each round by its own format now; what still
 * reads the setting is a knockout draw or a cut made from the standings.
 */
const MATCH_ROUND = { type: "Round Robin", headToHead: true };
const STROKE_ROUND = { type: "Stroke Play Round", headToHead: false };

describe("the warning", () => {
  it("still fires on the two mismatches — the control", () => {
    expect(scoringMismatch("stroke", [MATCH_ROUND])).not.toBeNull();
    expect(scoringMismatch("match", [STROKE_ROUND])).not.toBeNull();
    // And not on a tournament set up consistently, or a mixed one.
    expect(scoringMismatch("match", [MATCH_ROUND])).toBeNull();
    expect(scoringMismatch("stroke", [STROKE_ROUND])).toBeNull();
    expect(scoringMismatch("stroke", [MATCH_ROUND, STROKE_ROUND])).toBeNull();
  });

  it("names the draw and the cut, and never claims the board cannot rank", () => {
    for (const m of [scoringMismatch("stroke", [MATCH_ROUND]), scoringMismatch("match", [STROKE_ROUND])]) {
      expect(m!.message).toMatch(/knockout draw or a cut/);
      expect(m!.message).not.toMatch(/leaderboard stays empty|look for cards that match play does not return/);
    }
  });

  it("is headed as a mismatch, not as nothing being rankable", () => {
    for (const file of ["src/app/(app)/leaderboard/page.tsx", "src/app/(app)/stages/page.tsx"]) {
      const src = readSource(file);
      expect(src, file).not.toMatch(/Nothing here can be ranked|These rounds cannot be scored as set/);
      expect(src, file).toMatch(/The Scoring setting does not match/);
    }
  });
});
