import { describe, expect, it } from "vitest";
import { allowanceMeans, effectiveAllowance, overridesAfterFormatChange, recommendedAllowance } from "@/lib/round-allowance";
import { FORMAT_NAMES } from "@/lib/formats";
import { STAGE_TYPES } from "@/lib/stage-types";
import { sidePlayingHandicap } from "@/lib/services/teams";
import { readSource } from "./source";

/**
 * A COMMITTEE'S ALLOWANCE IS A PERCENTAGE OF SOMETHING, AND A FORMAT CHANGE CAN
 * CHANGE WHAT (found by the panel, 2026-10-17).
 *
 * Expectations are worked from the Rules of Handicapping, Appendix C, by hand:
 * foursomes is 50% of the pair's COMBINED course handicaps. A pair off 10.0 and
 * 20.0 therefore plays off 15. The fault this closes kept a medal's committee
 * 95 through a switch to Foursomes and played that pair off 95% of 30 = 28.5,
 * i.e. 29 — fourteen strokes the Rules never gave them.
 */

const MEDAL = { format: "Stroke Play", type: "Stroke Play Round" };

describe("the cases a committee meets", () => {
  it("a medal's 95, switched to Foursomes, is dropped: the pair plays off Appendix C's half of the combined", () => {
    const next = overridesAfterFormatChange({ ...MEDAL, handicapAllowance: 95, allowanceWeights: [] }, "Foursomes");
    expect(next.handicapAllowance).toBe(0);
    expect(sidePlayingHandicap([10.0, 20.0], "Foursomes", next.handicapAllowance, next.allowanceWeights)).toBe(15);
    // CONTROL: the stale figure really would have priced it differently.
    expect(sidePlayingHandicap([10.0, 20.0], "Foursomes", 95, [])).toBe(29);
  });

  it("a greensomes 55/45, switched to Foursomes, is dropped: foursomes has no split", () => {
    const next = overridesAfterFormatChange(
      { format: "Greensomes", type: "Stroke Play Round", handicapAllowance: 0, allowanceWeights: [55, 45] },
      "Foursomes",
    );
    expect(next.allowanceWeights).toEqual([]);
    expect(sidePlayingHandicap([10.0, 20.0], "Foursomes", next.handicapAllowance, next.allowanceWeights)).toBe(15);
    // CONTROL: 55% of 10 + 45% of 20 = 14.5 → 15 would hide it, so use a pair where it shows.
    expect(sidePlayingHandicap([4.0, 30.0], "Foursomes", 0, [55, 45])).toBe(16); // 2.2 + 13.5 = 15.7
    expect(sidePlayingHandicap([4.0, 30.0], "Foursomes", 0, [])).toBe(17); // half of 34
  });

  it("a medal's 100 (a field under thirty) is KEPT when the medal becomes Stableford — both are each player's own handicap", () => {
    const next = overridesAfterFormatChange({ ...MEDAL, handicapAllowance: 100, allowanceWeights: [] }, "Stableford");
    expect(next.handicapAllowance).toBe(100);
  });

  it("a re-save of the same format keeps everything", () => {
    const g = { format: "Greensomes", type: "Stroke Play Round", handicapAllowance: 0, allowanceWeights: [55, 45] };
    expect(overridesAfterFormatChange(g, "Greensomes")).toEqual({ handicapAllowance: 0, allowanceWeights: [55, 45] });
  });

  it("a four-ball's committee figure does not carry into a Best Ball or a scramble", () => {
    const fb = { format: "Four-Ball", type: "Stroke Play Round", handicapAllowance: 80, allowanceWeights: [] };
    for (const to of ["Best Ball", "Scramble"]) {
      if (!FORMAT_NAMES.includes(to)) continue;
      expect(overridesAfterFormatChange(fb, to).handicapAllowance, to).toBe(0);
    }
  });
});

describe("over every format × every kind of round", () => {
  it("what is kept after any change still means the same thing, and nothing else is", () => {
    let kept = 0;
    let cleared = 0;
    for (const type of STAGE_TYPES) {
      for (const from of FORMAT_NAMES) {
        for (const to of FORMAT_NAMES) {
          const before = { format: from, type, handicapAllowance: 77, allowanceWeights: [70, 30] };
          const next = overridesAfterFormatChange(before, to);
          const same = allowanceMeans({ format: from, type }) === allowanceMeans({ format: to, type });
          expect(next.handicapAllowance, `${type}: ${from} → ${to}`).toBe(same ? 77 : 0);
          expect(next.allowanceWeights, `${type}: ${from} → ${to}`).toEqual(from === to ? [70, 30] : []);
          // And the allowance in force is the committee's only where it kept its meaning.
          const inForce = effectiveAllowance(to, next.handicapAllowance, type);
          expect(inForce).toBe(same ? 77 : recommendedAllowance(to, type));
          if (from !== to) (same ? kept++ : cleared++);
        }
      }
    }
    // CONTROL: the sweep exercised both branches, so neither is vacuous.
    expect(kept).toBeGreaterThan(0);
    expect(cleared).toBeGreaterThan(0);
  });

  it("a side's figure never carries to another side format, nor to or from a player's", () => {
    for (const type of STAGE_TYPES) {
      for (const from of FORMAT_NAMES) {
        for (const to of FORMAT_NAMES) {
          if (from === to) continue;
          const a = allowanceMeans({ format: from, type });
          const b = allowanceMeans({ format: to, type });
          if (a.startsWith("side:") || b.startsWith("side:")) expect(a, `${from} → ${to}`).not.toBe(b);
        }
      }
    }
  });
});

describe("the door", () => {
  it("setStageFormat writes the format through overridesAfterFormatChange", () => {
    const src = readSource("src/app/actions/tournament.ts");
    const body = src.slice(src.indexOf("export async function setStageFormat("), src.indexOf("export async function setStageHoles("));
    expect(body).toMatch(/overridesAfterFormatChange\(before, value\)/);
    expect(body).toMatch(/select: \{[^}]*handicapAllowance: true[^}]*allowanceWeights: true/);
  });
});
