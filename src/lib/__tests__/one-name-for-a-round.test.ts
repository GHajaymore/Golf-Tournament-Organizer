import { describe, it, expect } from "vitest";
import { roundNameFor } from "@/lib/domain/round-label";
import { readSource } from "./source";

/**
 * ONE ROUND, ONE NAME, ON EVERY SCREEN THAT NAMES IT.
 *
 * Found 2026-09-26 running a club Scramble from scratch as a newcomer. The
 * console heading said "Round 1 · Scramble"; the dashboard's Current round
 * card directly under it said "Stroke Play Round"; the public board the club
 * sends its members said "Stroke Play Round · 18 Oct 2026". The stage TYPE is
 * how the app stores a round's shape and means nothing to a golfer; the
 * FORMAT is what they are playing.
 */

const round = (id: string, type: string, format = "") => ({ id, type, format });

describe("roundNameFor", () => {
  it("names a round by its format, not its stored type", () => {
    const r = round("a", "Stroke Play Round", "Scramble");
    expect(roundNameFor([r], r)).toBe("Round 1 · Scramble");
  });

  it("counts playing rounds, as every other round number does", () => {
    const rounds = [round("a", "Stroke Play Round", "Stroke Play"), round("b", "Round Robin", "Match Play")];
    expect(roundNameFor(rounds, rounds[1])).toBe("Round 2 · Match Play");
  });

  it("falls back to the type only where no format is set", () => {
    const r = round("a", "Round Robin", "  ");
    expect(roundNameFor([r], r)).toBe("Round 1 · Round Robin");
  });
});

describe("the screens that name the board's round", () => {
  // The console heading, the dashboard card under it, and the public board.
  const SCREENS = [
    "src/app/(app)/layout.tsx",
    "src/app/(app)/dashboard/page.tsx",
    "src/lib/services/live-board.ts",
  ];

  it.each(SCREENS)("%s names it through roundNameFor", (file) => {
    expect(readSource(file)).toMatch(/roundNameFor\(/);
  });

  it.each(SCREENS)("%s never falls back to a bare stage type", (file) => {
    // The spelling each of them used: `...?.type ?? "..."` / `|| activeStage?.type`.
    expect(readSource(file)).not.toMatch(/(\|\||\?\?)\s*(currentStage|activeStage|boardRound)\?\.type\b/);
  });
});
