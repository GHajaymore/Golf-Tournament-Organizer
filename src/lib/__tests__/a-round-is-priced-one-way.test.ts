import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import { playingHandicapInRound, playingHandicapPartsInRound } from "../round-allowance";

/**
 * ONE PLAYER'S PLAYING HANDICAP IN A ROUND IS PRICED ONE WAY:
 * `playingHandicapInRound` (or `playingHandicapPartsInRound`, for a screen that
 * lists the parts) in `round-allowance.ts`.
 *
 * The round's figure for the player, its allowance of the unrounded figure
 * (Rule 6.2a), then the strokes for tees of a higher par (Rule 6.2b). Until
 * 2026-10-14 nine places wrote those three steps out with
 * `roundPlayingHandicap(...)`, and one — the stored result of a singles match
 * decided from its two cards — had the first step alone: a woman shown a
 * stroke for the pars had her win stored as a half
 * (`stored-results-give-the-strokes-for-the-pars.audit.test.ts`).
 *
 * `domain/team.ts` keeps its call: `allocatedStrokes` spreads a figure it is
 * handed across the holes, and does not resolve a round.
 */
describe("a round's playing handicap", () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const PRICED_BY_HAND = /\broundPlayingHandicap\s*\(/;
  const MAY = ["lib/round-allowance.ts", "lib/domain/handicap.ts", "lib/domain/team.ts"];

  it("CONTROL: the sweep recognises the spellings it replaced", () => {
    expect(PRICED_BY_HAND.test("  const playsOff = (id: string): number => roundPlayingHandicap(frozenHandicapOf(id), allowance, parStrokesOf(id));")).toBe(true);
    expect(PRICED_BY_HAND.test("        playingHandicap: roundPlayingHandicap(\n          playsOffExact(m.player),")).toBe(true);
    expect(PRICED_BY_HAND.test("      playing: ownBall ? playing : null,")).toBe(false);
    expect(PRICED_BY_HAND.test("    playingHandicapInRound(stage, row, member)")).toBe(false);
  });

  /**
   * The one function, worked by hand from the Rules. An individual net medal is
   * 95% (Appendix C), taken of the unrounded figure and rounded once, a half up
   * (6.2a); the strokes for tees of a higher par come after, whole (6.2b).
   */
  const MEDAL = { format: "Stroke Play", type: "Stroke Play Round", scoringBasis: "net", handicapAllowance: 0 };
  const off = (exact: number, parStrokes: number) => ({ whole: Math.round(exact), exact, parStrokes });

  it("a 10.4 on the longer par: 95% is 9.88, which is 10, and one for the pars is 11", () => {
    const parts = playingHandicapPartsInRound(MEDAL, null, off(10.4, 1));
    expect(parts.allowance).toBe(95);
    expect(parts.parStrokes).toBe(1);
    expect(parts.playing).toBe(11);
    expect(playingHandicapInRound(MEDAL, null, off(10.4, 1))).toBe(11);
  });

  it("a round counted against par gives nothing for the pars (6.2b)", () => {
    expect(playingHandicapInRound({ ...MEDAL, scoringBasis: "stableford" }, null, off(10.4, 1))).toBe(10);
  });

  it("a frozen round keeps what it froze, the strokes for the pars with it", () => {
    // 95% of 12.4 is 11.78, which is 12; it froze none for the pars, and today's 1 is not its.
    const row = { frozen: 12, frozenExact: 12.4, frozenParStrokes: 0 };
    expect(playingHandicapInRound(MEDAL, row, off(10.4, 1))).toBe(12);
  });

  it("a committee's figure is the figure the allowance is taken of", () => {
    // 95% of 8 is 7.6, which is 8, and one for the pars.
    expect(playingHandicapInRound(MEDAL, { override: 8 }, off(10.4, 1))).toBe(9);
  });

  it("the committee's own allowance wins over the format's", () => {
    // 80% of 10.4 is 8.32, which is 8, and one for the pars.
    expect(playingHandicapInRound({ ...MEDAL, handicapAllowance: 80 }, null, off(10.4, 1))).toBe(9);
  });

  it("is priced in round-allowance.ts and nowhere else", () => {
    const files = sources("src");
    // The sweep reads the files it means to: the one place it is allowed is found.
    expect(files.some((f) => f.endsWith("lib/round-allowance.ts") && PRICED_BY_HAND.test(readSource(f)))).toBe(true);
    const strays = files.filter((f) => !MAY.some((m) => f.endsWith(m)) && PRICED_BY_HAND.test(readSource(f)));
    expect(strays, "price a round with playingHandicapInRound(round, row, member)").toEqual([]);
  });
});
