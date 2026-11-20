import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import { sideHandicapFromPartners } from "@/lib/services/teams";
import { courseHandicapExact } from "@/lib/domain/handicap";

/**
 * A PARTNER WHO WITHDREW IS NOT IN THE SIDE'S HANDICAP — ON ANY SCREEN, OR IN
 * THE STORED MATCH.
 *
 * Until 2026-11-04 the Teams screen and the league table priced a side on one
 * ball off `partnersWhoPlay`, and `recomputeTeamMatch` — the result that is
 * actually filed — handed EVERY member's figure to `sidePlayingHandicap`. A
 * scramble of three with one partner withdrawn was a two (35/15) on the screen
 * and a three (30/20/10) in the match. One function now holds the rule,
 * `sideHandicapFromPartners`, with `withdrawn` required of every partner.
 *
 * The figures, worked from the Rules in WHOLE NUMBERS by a route the code does
 * not take (no `courseHandicapExact`, `sideHandicap` or `wholeStrokes` on the
 * expected side). Tees 71.0 / 125, par 71, so Rule 6.1's rating-minus-par term
 * is nought and a Course Handicap x 1130 is exactly (10 x Index) x 125:
 *
 *   side A   4.3 -> 5375    11.8 -> 14750    26.7 -> 33375   (26.7 withdrawn)
 *   App. C   scramble of 2 (who plays): 35 x 5375 + 15 x 14750 = 409375
 *              / 113000 = 3.62 -> 4
 *            scramble of 3 (counting the withdrawn partner):
 *              30 x 5375 + 20 x 14750 + 10 x 33375 = 790000 / 113000 = 6.99 -> 7
 *   side B   9.4 -> 11750   15.2 -> 19000    21.6 -> 27000   (all play)
 *            30 x 11750 + 20 x 19000 + 10 x 27000 = 1002500 / 113000 = 8.87 -> 9
 *   match    off the low side: B receives 9 - 4 = 5 strokes, not 9 - 7 = 2.
 *
 * `a-withdrawn-partner-is-not-in-the-stored-match.audit.test.ts` files that
 * match through `recomputeTeamMatch` against real rows and reads the holes.
 */

const WHITES = { slopeRating: 125, courseRating: 71.0, par: 71 };

/** A Course Handicap in 1130ths of a stroke, exactly (one-decimal index and rating). */
function ch1130(index: number): number {
  return Math.round(index * 10) * WHITES.slopeRating + (Math.round(WHITES.courseRating * 10) - WHITES.par * 10) * 113;
}

/** n / d to the nearest whole number, .5 upwards, in integers. */
const roundHalfUp = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));

/** The Rule's figure: each partner's exact Course Handicap times their share, best first, rounded once. */
function byTheRule(indexes: number[], shares: number[]): number {
  const sorted = indexes.map(ch1130).sort((a, b) => a - b);
  return roundHalfUp(
    sorted.reduce((sum, c, i) => sum + c * (shares[i] ?? 0), 0),
    1130 * 100,
  );
}

const partner = (index: number, withdrawn = false) => ({ exact: courseHandicapExact(index, WHITES), withdrawn });
const SCRAMBLE = { format: "Scramble", handicapAllowance: 0, allowanceWeights: null };

describe("a withdrawn partner is not in the side's handicap", () => {
  it("side A, 4.3 and 11.8 playing and 26.7 withdrawn, plays off 4 — a scramble of two, not of three", () => {
    const rule = byTheRule([4.3, 11.8], [35, 15]);
    expect(rule, "the Rule's own figure, in whole numbers").toBe(4);
    expect(sideHandicapFromPartners([partner(4.3), partner(11.8), partner(26.7, true)], SCRAMBLE)).toBe(rule);
  });

  it("CONTROL: counting the withdrawn partner gives a DIFFERENT figure, so the case can tell the two apart", () => {
    const counted = byTheRule([4.3, 11.8, 26.7], [30, 20, 10]);
    expect(counted).toBe(7);
    expect(counted).not.toBe(byTheRule([4.3, 11.8], [35, 15]));
    // And the function, handed the same three with nobody withdrawn, says the three's figure.
    expect(sideHandicapFromPartners([partner(4.3), partner(11.8), partner(26.7)], SCRAMBLE)).toBe(counted);
  });

  it("the match off the low side: B (9) receives five strokes from A (4), not two from A (7)", () => {
    const b = byTheRule([9.4, 15.2, 21.6], [30, 20, 10]);
    expect(b).toBe(9);
    expect(sideHandicapFromPartners([partner(9.4), partner(15.2), partner(21.6)], SCRAMBLE)).toBe(b);
    const a = sideHandicapFromPartners([partner(4.3), partner(11.8), partner(26.7, true)], SCRAMBLE);
    expect(b - a).toBe(5);
    expect(b - byTheRule([4.3, 11.8, 26.7], [30, 20, 10])).toBe(2);
  });

  it("a side whose every partner withdrew is priced off all of them, not off nobody", () => {
    const all = [partner(4.3, true), partner(11.8, true), partner(26.7, true)];
    expect(sideHandicapFromPartners(all, SCRAMBLE)).toBe(byTheRule([4.3, 11.8, 26.7], [30, 20, 10]));
  });
});

/**
 * ONE PLACE PRICES A SIDE. Every call of `sidePlayingHandicap(` in the app
 * (tests aside, comments stripped) is inside `sideHandicapFromPartners`, so no
 * reader can price a side off a list that forgot who withdrew.
 */
describe("one function prices a side, and a sweep refuses a second", () => {
  function sources(dir = "src", out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }

  /** Each call of `sidePlayingHandicap(` in a file, named by the function it sits in. */
  function callsOf(code: string): string[] {
    const out: string[] = [];
    const call = /(?<![A-Za-z0-9_$.])sidePlayingHandicap\(/g;
    for (let m = call.exec(code); m; m = call.exec(code)) {
      if (code.slice(Math.max(0, m.index - 9), m.index) === "function ") continue;
      const before = code.slice(0, m.index);
      const fn = [...before.matchAll(/(?:export )?function (\w+)\(/g)].pop();
      out.push(fn ? fn[1] : "(top level)");
    }
    return out;
  }

  const files = sources();

  it("CONTROL: the sweep reads the app, and sees a second copy where one is written", () => {
    expect(files.length).toBeGreaterThan(400);
    const sample = [
      "export function sidePlayingHandicap(a: number[], f: string) { return 0; }",
      "export function sideHandicapFromPartners(p, r) { return sidePlayingHandicap(p.map((x) => x.exact), r.format); }",
      "export async function recomputeTeamMatch() { const h = sidePlayingHandicap(members.map((m) => m.exact), f); }",
    ].join("\n");
    expect(callsOf(sample)).toEqual(["sideHandicapFromPartners", "recomputeTeamMatch"]);
  });

  it("every call of sidePlayingHandicap in the app is inside sideHandicapFromPartners", () => {
    const found = files.flatMap((f) => callsOf(readSource(f)).map((fn) => `${f}: ${fn}`));
    expect(found).toEqual(["src/lib/services/teams.ts: sideHandicapFromPartners"]);
  });

  it("the Teams screen, the league table and the stored match each ask it", () => {
    expect(readSource("src/lib/services/teams.ts")).toMatch(/playingHandicap: sideHandicapFromPartners\(/);
    expect(readSource("src/lib/services/league.ts")).toMatch(/playingHandicap: sideHandicapFromPartners\(partners, round\)/);
    expect(readSource("src/lib/services/match-from-cards.ts")).toMatch(/const hcp = sideHandicapFromPartners\(/);
  });
});
