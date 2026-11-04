import { describe, it, expect } from "vitest";
import { leagueSideBalls } from "@/lib/services/league";
import { courseHandicapExact } from "@/lib/domain/handicap";
import { matchHolesOffTheLow } from "@/lib/domain/team";
import { parStrokesApply } from "@/lib/round-allowance";

/**
 * A LEAGUE WEEK PLAYED TO A SHARED BALL IS PRICED BY APPENDIX C, NOT AT SCRATCH.
 *
 * Backlog J22 (confirmed 2026-11-03). A league week accepts any team format,
 * foursomes and a scramble included, and `leagueMeetings` priced every card by
 * its player. A side that shares one ball returns ONE card, filed under no
 * player, so its handicap fell through `courseHcp.get("") ?? ... ?? 0` to
 * nought: every side in the week played off scratch, while the side's own
 * card, the Teams screen and the stored match (`recomputeTeamMatch`) gave it
 * strokes.
 *
 * EVERY EXPECTATION BELOW IS WORKED FROM THE RULES, IN WHOLE NUMBERS, by a
 * route the code does not take:
 *
 *   Rule 6.1    Course Handicap = Index x Slope / 113 + (Course Rating - Par)
 *   Rule 6.2a   the allowance is applied to the UNROUNDED Course Handicap as
 *               the final step, and the result rounded once, .5 upwards
 *   Appendix C  foursomes      50% of the side's combined course handicaps
 *               greensomes     60% of the lower + 40% of the higher
 *               scramble of 4  25 / 20 / 15 / 10   (lowest handicap first)
 *               scramble of 3  30 / 20 / 10        (2024 edition)
 *               scramble of 2  35 / 15
 *
 * An index and a rating have one decimal place, so ten times either is a whole
 * number, and a Course Handicap times 1130 is EXACTLY
 *
 *   (10 x Index) x Slope  +  (10 x Rating - 10 x Par) x 113
 *
 * The allowance then multiplies by a whole percentage, and the rounding is a
 * floor of whole numbers. No floating point, no `wholeStrokes`, no
 * `sideHandicap`, no `courseHandicapExact` on the expected side.
 */

interface Tee {
  slopeRating: number;
  courseRating: number;
  par: number;
}

/** The USGA's own example set: 71.0 / 125, par 71. */
const WHITES: Tee = { slopeRating: 125, courseRating: 71.0, par: 71 };
/** A set of a HIGHER PAR, with its rating above its par. */
const REDS: Tee = { slopeRating: 128, courseRating: 73.4, par: 72 };

/** A Course Handicap in 1130ths of a stroke, exactly. */
function ch1130(index: number, tee: Tee): number {
  const i10 = Math.round(index * 10);
  const cr10 = Math.round(tee.courseRating * 10);
  return i10 * tee.slopeRating + (cr10 - tee.par * 10) * 113;
}

/** n / d rounded to the nearest whole number, .5 upwards — for n, d > 0, in integers. */
function roundHalfUp(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

/**
 * The Rule's figure for a side: each partner's exact Course Handicap times
 * their percentage, best player first, summed, then rounded once.
 */
function byTheRule(partners: { index: number; tee: Tee }[], shares: number[]): number {
  const sorted = partners.map((p) => ch1130(p.index, p.tee)).sort((a, b) => a - b);
  const total = sorted.reduce((sum, c, i) => sum + c * (shares[i] ?? 0), 0);
  return roundHalfUp(total, 1130 * 100);
}

/** What the league is handed for a partner: their exact figure, as the service resolves it. */
const partner = (index: number, tee: Tee, withdrawn = false) => ({
  exact: courseHandicapExact(index, tee),
  withdrawn,
});

const ROUND = (format: string, handicapAllowance = 0, allowanceWeights: number[] | null = []) => ({
  format,
  handicapAllowance,
  allowanceWeights,
});

/** A side's one shared card. */
const sharedCard = (strokes: (number | null)[]) => [{ playerId: "", strokes: JSON.stringify(strokes) }];

/** Never consulted for a shared ball: there is no player to ask. */
const noPlayer = (id: string): number => {
  throw new Error(`a shared ball was priced by a player ("${id}")`);
};

const priced = (
  format: string,
  partners: { exact: number; withdrawn: boolean }[],
  round = ROUND(format),
): number => {
  const balls = leagueSideBalls(round, sharedCard(new Array(18).fill(4)), partners, noPlayer);
  expect(balls, `${format}: a shared ball is ONE ball`).toHaveLength(1);
  return balls[0].playingHandicap;
};

describe("Appendix C prices a league side on one ball", () => {
  it("foursomes: 8.6 and 10.3 off 71.0/125 play off 10 — 50% of 20.91, rounded once", () => {
    // 8.6 -> 9.513..., 10.3 -> 11.393...; combined 20.907; half 10.45 -> 10.
    // Rounding each first (10 + 11 = 21, half 10.5) would say 11.
    const rule = byTheRule(
      [
        { index: 8.6, tee: WHITES },
        { index: 10.3, tee: WHITES },
      ],
      [50, 50],
    );
    expect(rule, "the Rule's own figure, worked in whole numbers").toBe(10);
    expect(priced("Foursomes", [partner(8.6, WHITES), partner(10.3, WHITES)])).toBe(rule);
  });

  it("mixed foursomes, one partner on a set of HIGHER PAR: 8.6 whites + 14.7 reds play off 14", () => {
    // 14.7 off 73.4/128, par 72: 14.7 x 128/113 + 1.4 = 18.051...  (Rule 6.1's
    // rating-minus-par term is how the higher set's difficulty reaches the side).
    // Combined with 9.513... is 27.564; half 13.78 -> 14.
    const rule = byTheRule(
      [
        { index: 8.6, tee: WHITES },
        { index: 14.7, tee: REDS },
      ],
      [50, 50],
    );
    expect(rule).toBe(14);
    expect(priced("Foursomes", [partner(8.6, WHITES), partner(14.7, REDS)])).toBe(rule);
    // And NOTHING added for the pars on top (Rule 6.2b's difference): what a
    // difference in pars adds to a SIDE on one ball is a committee procedure
    // the app does not have — `parStrokesApply` and docs/deferred-register.md
    // ("A side that shares one ball gives none either"). The board, the Teams
    // screen and the stored match give none; the league gives the same.
    expect(parStrokesApply("Foursomes", "net")).toBe(false);
  });

  it("greensomes: 60% of the lower + 40% of the higher — 8.6 whites + 14.7 reds play off 13", () => {
    // 0.6 x 9.513 + 0.4 x 18.051 = 5.708 + 7.221 = 12.93 -> 13.
    const rule = byTheRule(
      [
        { index: 14.7, tee: REDS },
        { index: 8.6, tee: WHITES },
      ],
      [60, 40],
    );
    expect(rule).toBe(13);
    expect(priced("Greensomes", [partner(14.7, REDS), partner(8.6, WHITES)])).toBe(rule);
  });

  const FOUR = [
    { index: 27.4, tee: WHITES },
    { index: 3.2, tee: WHITES },
    { index: 18.9, tee: WHITES },
    { index: 12.5, tee: WHITES },
  ];

  it("a scramble of four: 25/20/15/10, lowest first — 3.2, 12.5, 18.9, 27.4 play off 10", () => {
    const rule = byTheRule(FOUR, [25, 20, 15, 10]);
    expect(rule).toBe(10);
    expect(priced("Scramble", FOUR.map((p) => partner(p.index, p.tee)))).toBe(rule);
  });

  it("a scramble of three: 30/20/10 — and a partner who withdrew is not in it", () => {
    const three = FOUR.filter((p) => p.index !== 27.4);
    const rule = byTheRule(three, [30, 20, 10]);
    expect(rule).toBe(6);
    expect(priced("Scramble", three.map((p) => partner(p.index, p.tee)))).toBe(rule);
    // The same side with the 27.4 withdrawn is a side of three, as the Teams
    // screen prices it — not a four with somebody who never hit a shot.
    const withWithdrawn = FOUR.map((p) => partner(p.index, p.tee, p.index === 27.4));
    expect(priced("Scramble", withWithdrawn)).toBe(rule);
  });

  it("a scramble of two: 35/15 — 3.2 and 12.5 play off 3", () => {
    const two = FOUR.filter((p) => p.index === 3.2 || p.index === 12.5);
    const rule = byTheRule(two, [35, 15]);
    expect(rule).toBe(3);
    expect(priced("Texas Scramble", two.map((p) => partner(p.index, p.tee)))).toBe(rule);
  });
});

describe("the committee's own allowance overrides the Rule's, as everywhere else", () => {
  it("a flat 40% on foursomes: 8.6 and 10.3 play off 8, not 10", () => {
    const rule = byTheRule(
      [
        { index: 8.6, tee: WHITES },
        { index: 10.3, tee: WHITES },
      ],
      [40, 40],
    );
    expect(rule).toBe(8);
    expect(priced("Foursomes", [partner(8.6, WHITES), partner(10.3, WHITES)], ROUND("Foursomes", 40))).toBe(rule);
  });

  it("a committee's own split, 70/30, on greensomes: 12, not the Rule's 13", () => {
    const rule = byTheRule(
      [
        { index: 8.6, tee: WHITES },
        { index: 14.7, tee: REDS },
      ],
      [70, 30],
    );
    expect(rule).toBe(12);
    expect(
      priced("Greensomes", [partner(8.6, WHITES), partner(14.7, REDS)], ROUND("Greensomes", 0, [70, 30])),
    ).toBe(rule);
  });
});

describe("and the match is played off the low SIDE", () => {
  it("level fours all round: the side off 14 wins the four hardest holes against the side off 10", () => {
    // Appendix C, match play: the side with the higher playing handicap
    // receives the difference, on the holes of stroke index 1 to 4.
    const SI = Array.from({ length: 18 }, (_, i) => i + 1);
    const fours = new Array(18).fill(4);
    const low = leagueSideBalls(
      ROUND("Foursomes"),
      sharedCard(fours),
      [partner(8.6, WHITES), partner(10.3, WHITES)],
      noPlayer,
    );
    const high = leagueSideBalls(
      ROUND("Foursomes"),
      sharedCard(fours),
      [partner(8.6, WHITES), partner(14.7, REDS)],
      noPlayer,
    );
    const holes = matchHolesOffTheLow(low, high, SI, 18);
    expect(holes).toEqual([...new Array(4).fill("B"), ...new Array(14).fill("H")]);
  });

  it("an unplayed side is one ball of no scores — unplayed, never a walkover", () => {
    const balls = leagueSideBalls(ROUND("Foursomes"), [], [partner(8.6, WHITES), partner(10.3, WHITES)], noPlayer);
    expect(balls).toHaveLength(1);
    expect(balls[0].strokes).toEqual([]);
    expect(balls[0].playingHandicap).toBe(10);
  });

  it("a four-ball is still priced by each player's own card, as before", () => {
    const cards = [
      { playerId: "p1", strokes: JSON.stringify(new Array(18).fill(4)) },
      { playerId: "p2", strokes: JSON.stringify(new Array(18).fill(5)) },
    ];
    const asked: string[] = [];
    const balls = leagueSideBalls(ROUND("Four-Ball"), cards, [], (id) => {
      asked.push(id);
      return id === "p1" ? 7 : 12;
    });
    expect(asked).toEqual(["p1", "p2"]);
    expect(balls.map((b) => b.playingHandicap)).toEqual([7, 12]);
  });
});
