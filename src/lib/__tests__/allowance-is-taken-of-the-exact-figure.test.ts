import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import {
  CourseHandicaps,
  courseHandicap,
  courseHandicapExact,
  courseHandicapMap,
  explainHandicap,
  playingHandicapFrom,
  wholeStrokes,
  type TeeRating,
} from "../domain/handicap";
import {
  exactHandicapToFreeze,
  handicapToFreeze,
  resolveRoundHandicap,
  roundHandicapExactOf,
} from "../domain/round-handicap";
import { aggregateTeamCard, allocatedStrokes, sideHandicap } from "../domain/team";
import { HANDICAP_EXAMPLE } from "../landing/example";

/**
 * AN ALLOWANCE IS TAKEN OF THE UNROUNDED COURSE HANDICAP, AND ROUNDED ONCE.
 *
 * Rules of Handicapping, Rule 6.2a and Appendix C: handicap allowances "are
 * applied to the unrounded Course Handicap as the final step in calculating a
 * player's Playing Handicap", the result rounded to the nearest whole number,
 * .5 upwards. For a format with one team handicap the allowance is applied to
 * each player's unrounded Course Handicap, the results combined, and the total
 * rounded as the final step (USGA Committee Procedures, other formats of play).
 *
 * Until 2026-10-13 the app rounded the course handicap, took the allowance of
 * that, and rounded again — on purpose, with a comment saying so. Found while
 * writing a browser test that worked a four-ball's net out independently. It is
 * a stroke too many or too few for between a fifth and a quarter of any field,
 * in every net round with an allowance below 100: every individual net round
 * (95%) and every four-ball (85% or 90%). The front door's own worked example,
 * headed as the calculation most golf software gets wrong, printed 14 where the
 * Rule gives 13.
 *
 * Eleven thousand tests were green over it, because nearly every one hands the
 * engine a WHOLE-number handicap, where the two methods cannot differ. So the
 * axis here is the index to one decimal place, which is what a real golfer has.
 *
 * WHAT THIS DOES NOT COVER: that the figure a screen prints is the one this
 * computes (the browser test `e2e/team-allowance.spec.ts` holds a board to it),
 * and four-ball MATCH play's regional variants, which are a different question.
 */

/** The USGA's own example tees: Course Rating 71.0, Slope 125, par 71. */
const USGA: TeeRating = { courseRating: 71.0, slopeRating: 125, par: 71 };
const TEES: TeeRating[] = [
  USGA,
  { courseRating: 70.8, slopeRating: 129, par: 71 },
  { courseRating: 71.5, slopeRating: 140, par: 72 },
  { courseRating: 72.0, slopeRating: 113, par: 72 },
  { courseRating: 67.3, slopeRating: 104, par: 70 },
  { courseRating: 74.9, slopeRating: 148, par: 72 },
];
const ALLOWANCES = [100, 95, 90, 85, 75, 60, 50, 40, 25];

/**
 * THE RULE, WORKED IN WHOLE NUMBERS, so that it shares nothing with the code
 * under test — not its formula, not its floating point.
 *
 * An index has one decimal and so does a course rating, so everything is an
 * exact number of 1,130ths of a stroke: index×10 × slope + (rating×10 − par×10) × 113.
 * The allowance makes it 113,000ths. Rounding to nearest, .5 upwards, is
 * floor(x + 1/2), which in whole numbers is floor((2n + d) / 2d).
 */
function byTheRule(indexTenths: number, tee: TeeRating, allowancePct: number): number {
  const ratingTenths = Math.round(tee.courseRating * 10);
  const parTenths = tee.par * 10;
  const n = (indexTenths * tee.slopeRating + (ratingTenths - parTenths) * 113) * allowancePct;
  const d = 113_000;
  return Math.floor((2 * n + d) / (2 * d));
}

/** What the app did: round the course handicap, take the allowance, round again. */
function roundedTwice(indexTenths: number, tee: TeeRating, allowancePct: number): number {
  const course = byTheRule(indexTenths, tee, 100);
  return Math.floor((2 * course * allowancePct + 100) / 200);
}

describe("the Rule's own figures", () => {
  it("the USGA's two players at 85% play off 8 and 10 — rounding twice makes both 9", () => {
    expect(playingHandicapFrom(courseHandicapExact(8.6, USGA), 85)).toBe(8);
    expect(playingHandicapFrom(courseHandicapExact(10.3, USGA), 85)).toBe(10);
    // CONTROL: this pair really does tell the two methods apart.
    expect(roundedTwice(86, USGA, 85)).toBe(9);
    expect(roundedTwice(103, USGA, 85)).toBe(9);
    // And the whole numbers they are told on the tee are untouched.
    expect(courseHandicap(8.6, USGA)).toBe(10);
    expect(courseHandicap(10.3, USGA)).toBe(11);
  });

  it("the front door's example reads 15 and 13", () => {
    expect(HANDICAP_EXAMPLE.index).toBe(12.4);
    expect(HANDICAP_EXAMPLE.exact).toBeCloseTo(14.8628, 3);
    expect(HANDICAP_EXAMPLE.course).toBe(15);
    expect(HANDICAP_EXAMPLE.playing).toBe(13);
    // What it printed before: 90% of 15, rounded.
    expect(roundedTwice(124, HANDICAP_EXAMPLE.tee, 90)).toBe(14);
  });

  it("rounds a half UP, including the halves a machine nearly misses", () => {
    expect(wholeStrokes(8.5)).toBe(9);
    expect(wholeStrokes(8.4999)).toBe(8);
    // A plus handicap moves towards zero: plus 2.5 is plus 2.
    expect(wholeStrokes(-2.5)).toBe(-2);
    expect(wholeStrokes(-2.51)).toBe(-3);
    expect(Object.is(wholeStrokes(-0.4), 0)).toBe(true);
    // 33.9 off an 85 slope is 25.5 exactly, and arrives as 25.499999999999996,
    // which a bare Math.round calls 25.
    expect(33.9 * (85 / 113)).toBeLessThan(25.5);
    expect(courseHandicap(33.9, { slopeRating: 85 })).toBe(26);
    // 10.0 off the standard slope at 85% is 8.5.
    expect(playingHandicapFrom(courseHandicapExact(10, { slopeRating: 113 }), 85)).toBe(9);
  });

  it("at 100% the playing handicap IS the course handicap", () => {
    for (const tee of TEES) {
      for (let t = -50; t <= 540; t += 1) {
        expect(playingHandicapFrom(courseHandicapExact(t / 10, tee), 100)).toBe(courseHandicap(t / 10, tee));
      }
    }
  });
});

describe("every index a golfer can hold, on every set of tees, at every allowance", () => {
  it("agrees with the Rule worked in whole numbers", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const tee of TEES) {
      for (const allowance of ALLOWANCES) {
        // Plus 5.0 to 54.0, in tenths.
        for (let t = -50; t <= 540; t += 1) {
          const got = playingHandicapFrom(courseHandicapExact(t / 10, tee), allowance);
          const want = byTheRule(t, tee, allowance);
          checked += 1;
          if (got !== want) wrong.push(`${t / 10} off ${tee.courseRating}/${tee.slopeRating} at ${allowance}%: ${got}, Rule ${want}`);
        }
      }
    }
    expect(checked).toBe(TEES.length * ALLOWANCES.length * 591);
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it("CONTROL: rounding twice is a different answer for a fifth of a field or more", () => {
    // If this ever reads zero the sweep above has stopped being able to fail.
    for (const allowance of [95, 90, 85]) {
      for (const tee of TEES) {
        let differ = 0;
        for (let t = 0; t <= 360; t += 1) if (roundedTwice(t, tee, allowance) !== byTheRule(t, tee, allowance)) differ += 1;
        expect(differ / 361, `${allowance}% off ${tee.slopeRating}`).toBeGreaterThan(0.15);
        expect(differ / 361, `${allowance}% off ${tee.slopeRating}`).toBeLessThan(0.3);
      }
    }
  });

  it("an unrated field takes the allowance of the index itself", () => {
    // No conversion to make, and the same principle: round once, at the end.
    expect(courseHandicapExact(9.5, null)).toBe(9.5);
    expect(courseHandicap(9.5, null)).toBe(10);
    expect(playingHandicapFrom(courseHandicapExact(9.5, null), 95)).toBe(9); // 9.025; not 95% of 10
  });

  it("says where the figure came from in words that add up", () => {
    const e = explainHandicap(12.4, { courseRating: 71.5, slopeRating: 140, par: 72 }, 90);
    expect(e.courseHandicap).toBe(15);
    expect(e.playingHandicap).toBe(13);
    expect(e.detail).toContain("= 14.86, a course handicap of 15");
    expect(e.detail).toContain("90% of 14.86 = 13 playing handicap");
    // At 100% there is nothing to explain, and the sentence is what it was.
    expect(explainHandicap(12.4, { courseRating: 71.5, slopeRating: 140, par: 72 }, 100).detail).toMatch(
      /= 15 course handicap$/,
    );
  });
});

describe("the field's map gives both figures and cannot give two different handicaps", () => {
  const tees = new Map([["white", { ...USGA, courseId: "c" }]]);
  const field = [
    { id: "a", handicap: 8.6, teeId: null, flightTeeId: null },
    { id: "b", handicap: 10.3, teeId: null, flightTeeId: null },
  ];
  const map = courseHandicapMap(field, tees, "white", 18, "one");

  it("`.get` is the whole number, `.exact` the figure it was rounded from", () => {
    expect(map).toBeInstanceOf(CourseHandicaps);
    expect(map.get("a")).toBe(10);
    expect(map.get("b")).toBe(11);
    expect(map.exact("a")).toBeCloseTo(9.5133, 3);
    expect(map.exact("b")).toBeCloseTo(11.3938, 3);
    expect(map.exact("nobody")).toBeUndefined();
    for (const id of ["a", "b"]) expect(wholeStrokes(map.exact(id)!)).toBe(map.get(id));
  });

  it("a whole number set over the top wins — the two never describe different players", () => {
    const copy = courseHandicapMap(field, tees, "white", 18, "one");
    copy.set("a", 14);
    expect(copy.exact("a")).toBe(14);
  });

  it("a nine-hole round halves the index before anything is rounded", () => {
    const nine = courseHandicapMap(field, tees, "white", 9, "one");
    // 4.3 × 125/113 + (35.5 − 35.5) = 4.7566
    expect(nine.exact("a")).toBeCloseTo(4.7566, 3);
    expect(nine.get("a")).toBe(5);
  });
});

describe("what a round says about a player, before rounding", () => {
  it("the roster's figure passes through unrounded", () => {
    const r = resolveRoundHandicap({ member: 10, memberExact: 9.5133 });
    expect(r.handicap).toBe(10);
    expect(r.exact).toBe(9.5133);
    expect(roundHandicapExactOf(null, 10, 9.5133)).toBe(9.5133);
  });

  it("with no unrounded figure in hand, the whole number stands", () => {
    expect(resolveRoundHandicap({ member: 10 }).exact).toBe(10);
    expect(roundHandicapExactOf(undefined, 10)).toBe(10);
  });

  it("an unrounded figure that is somebody else's is ignored", () => {
    // 12.4 does not round to 10, so it is not this handicap before rounding.
    expect(resolveRoundHandicap({ member: 10, memberExact: 12.4 }).exact).toBe(10);
  });

  it("a committee's figure is a whole number, and the allowance is taken of it", () => {
    const r = resolveRoundHandicap({ override: 12, member: 10, memberExact: 9.5133 });
    expect(r.handicap).toBe(12);
    expect(r.exact).toBe(12);
  });

  it("a frozen round keeps the figure it froze, whatever the roster does next", () => {
    const r = resolveRoundHandicap({ frozen: 10, frozenExact: 9.5133, member: 14, memberExact: 14.2 });
    expect(r.handicap).toBe(10);
    expect(r.exact).toBe(9.5133);
    expect(playingHandicapFrom(r.exact, 85)).toBe(8);
  });

  it("a round frozen before the exact figure was kept is priced as it was played", () => {
    const r = resolveRoundHandicap({ frozen: 10, frozenExact: null, member: 10, memberExact: 9.5133 });
    expect(r.exact).toBe(10);
    // 9, the figure that round's cards were scored off, and not the Rule's 8:
    // a played round is not a thing anyone gets to change their mind about.
    expect(playingHandicapFrom(r.exact, 85)).toBe(9);
  });

  it("freezes the pair together, and says honestly when there is only a whole number", () => {
    expect(handicapToFreeze({ member: 10, memberExact: 9.5133 })).toBe(10);
    expect(exactHandicapToFreeze({ member: 10, memberExact: 9.5133 })).toBe(9.5133);
    expect(handicapToFreeze({ override: 12, member: 10, memberExact: 9.5133 })).toBe(12);
    expect(exactHandicapToFreeze({ override: 12, member: 10, memberExact: 9.5133 })).toBeNull();
    expect(exactHandicapToFreeze({ member: 10 })).toBeNull();
  });
});

describe("a side's handicap is rounded once, at the end", () => {
  it("foursomes: 50% of the two unrounded figures added together", () => {
    // 10.6 + 9.6 = 20.2, half is 10.1. Rounding each first: 11 + 10 = 21, half 10.5, 11.
    expect(sideHandicap([10.6, 9.6], 50)).toBe(10);
    expect(sideHandicap([11, 10], 50)).toBe(11);
  });

  it("greensomes: 60% of the lower and 40% of the higher, unrounded", () => {
    // 0.6 × 9.4 + 0.4 × 10.4 = 9.8. Off the rounded 9 and 10 it is 9.4.
    expect(sideHandicap([10.4, 9.4], 0, [60, 40])).toBe(10);
    expect(sideHandicap([10, 9], 0, [60, 40])).toBe(9);
  });

  it("a four-ball player's strokes are the Rule's number of them", () => {
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    const total = (exact: number, pct: number) => allocatedStrokes(exact, pct, si).reduce((a, b) => a + b, 0);
    expect(total(courseHandicapExact(8.6, USGA), 85)).toBe(8);
    expect(total(courseHandicapExact(10.3, USGA), 85)).toBe(10);
    expect(total(10, 85)).toBe(9); // what the rounded figure gave the first of them
  });

  it("and the better ball is scored off them", () => {
    const pars = new Array(18).fill(4);
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    const fives = new Array(18).fill(5);
    // One ball only, so the side's net is that player's gross less their strokes.
    const net = (exact: number) =>
      aggregateTeamCard([{ playerId: "a", strokes: fives, courseHandicap: exact }], pars, si, 85).netTotal;
    expect(net(courseHandicapExact(8.6, USGA))).toBe(90 - 8);
    expect(net(courseHandicapExact(10.3, USGA))).toBe(90 - 10);
  });
});

/**
 * NOBODY TAKES AN ALLOWANCE OF A ROUNDED FIGURE, AND NOBODY WRITES THE
 * ARITHMETIC OUT AGAIN.
 *
 * There were four copies of it: `playingHandicapFrom`, `allocatedStrokes`, a
 * `playingHandicap` in formats.ts nothing called, and one written out by hand on
 * the score-entry screen — in a file whose own guard bans a second pipeline and
 * could not see this one, because it was spelled as arithmetic.
 */
describe("the arithmetic is written once and handed the unrounded figure", () => {
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
  const files = sources();
  const codeOf = new Map(files.map((f) => [f, readSource(f)]));

  /** A handicap multiplied by something and divided by a hundred, written out by hand. */
  const BY_HAND = /(?:[Hh]andicap|[Hh]cp)\w*\s*\*\s*\w+\)\s*\/\s*100/;
  /** The one function allowed to write it. */
  const HOME = "src/lib/domain/handicap.ts";

  it("CONTROL: the sweep reads the app and recognises the three lines it replaced", () => {
    expect(files.length).toBeGreaterThan(400);
    expect(codeOf.get(HOME)).toContain("export function playingHandicapFrom(");
    expect(BY_HAND.test(codeOf.get(HOME)!)).toBe(true);
    expect(BY_HAND.test("const playing = Math.round((courseHandicap * allowancePct) / 100);")).toBe(true);
    expect(BY_HAND.test("Math.round((courseHandicap * teamAllowancePct) / 100)")).toBe(true);
    expect(BY_HAND.test("return Math.round((courseHandicap * pct) / 100);")).toBe(true);
    expect(BY_HAND.test("playingHandicapFrom(resolved.exact, allowance)")).toBe(false);
  });

  it("no file but the rule's own multiplies a handicap by a percentage", () => {
    const offenders = files.filter((f) => f !== HOME && BY_HAND.test(codeOf.get(f)!));
    expect(offenders, "take an allowance with playingHandicapFrom(exact, pct)").toEqual([]);
  });

  /** Every call of `name(` in a file, with the text of its first argument. */
  function firstArgs(code: string, name: string): string[] {
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const at = code.indexOf(`${name}(`, from);
      if (at < 0) break;
      from = at + name.length + 1;
      const before = code[at - 1] ?? " ";
      // Part of a longer name (`sidePlayingHandicap(` when looking for `playingHandicap(`).
      if (/[A-Za-z0-9_$.]/.test(before)) continue;
      // The definition itself.
      if (code.slice(Math.max(0, at - 9), at) === "function ") continue;
      let depth = 0;
      let i = from;
      for (; i < code.length; i += 1) {
        const c = code[i];
        if (c === "(" || c === "[" || c === "{") depth += 1;
        else if (c === ")" || c === "]" || c === "}") {
          if (depth === 0) break;
          depth -= 1;
        } else if (c === "," && depth === 0) break;
      }
      out.push(code.slice(from, i).replace(/\s+/g, " ").trim());
    }
    return out;
  }

  it("CONTROL: finds the callers, and tells the definition from a call", () => {
    const sample = "export function playingHandicapFrom(a: number, b: number) {}\nconst x = playingHandicapFrom(resolved.exact, pct);\nconst y = sidePlayingHandicap(list, f);";
    expect(firstArgs(sample, "playingHandicapFrom")).toEqual(["resolved.exact"]);
    expect(firstArgs(sample, "sidePlayingHandicap")).toEqual(["list"]);
    // A round is priced with `roundPlayingHandicap` since 2026-10-13 — the same
    // allowance of the same figure, then the strokes for tees of a higher par —
    // and since 2026-10-14 through `playingHandicapInRound`, which hands it the
    // `exact:` figure it is given; so the callers are counted under all four.
    const all = files.flatMap((f) => [
      ...firstArgs(codeOf.get(f)!, "playingHandicapFrom"),
      ...firstArgs(codeOf.get(f)!, "roundPlayingHandicap"),
      ...exactGiven(codeOf.get(f)!, "playingHandicapInRound"),
      ...exactGiven(codeOf.get(f)!, "playingHandicapPartsInRound"),
    ]);
    // The board twice, the league, skins, the team match, the net import, a
    // match from its cards, the printed card, the side builder, the round's
    // list, the worked example, the explanation.
    expect(all.length).toBeGreaterThanOrEqual(12);
    expect(exactGiven("playingHandicapInRound(stage, row, { whole: w, exact: byRound.exact(id) ?? 0, parStrokes: 0 })", "playingHandicapInRound")).toEqual([
      "byRound.exact(id) ?? 0",
    ]);
  });

  /** What each call of `name(` hands over as its `exact:` figure ("" where it names none). */
  function exactGiven(code: string, name: string): string[] {
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const at = code.indexOf(`${name}(`, from);
      if (at < 0) break;
      from = at + name.length + 1;
      if (/[A-Za-z0-9_$.]/.test(code[at - 1] ?? " ")) continue;
      if (code.slice(Math.max(0, at - 9), at) === "function ") continue;
      let depth = 0;
      let i = from;
      for (; i < code.length; i += 1) {
        const c = code[i];
        if (c === "(" || c === "[" || c === "{") depth += 1;
        else if (c === ")" || c === "]" || c === "}") {
          if (depth === 0) break;
          depth -= 1;
        }
      }
      const call = code.slice(from, i).replace(/\s+/g, " ");
      const m = call.match(/\bexact: ([^,}]+)/);
      out.push(m ? m[1].trim() : "");
    }
    return out;
  }

  it("every allowance is taken of a figure that says it is the exact one", () => {
    const exactly = /[Ee]xact/;
    const bad: string[] = [];
    for (const f of files) {
      const code = codeOf.get(f)!;
      for (const name of ["playingHandicapFrom", "roundPlayingHandicap"]) {
        for (const arg of firstArgs(code, name)) {
          // The printed card names its reader `frozenHandicapOf`, and that reader
          // is pinned to the exact form just below.
          if (!exactly.test(arg) && !/^frozenHandicapOf\(/.test(arg) && arg !== "ch") bad.push(`${f}: ${name}(${arg}, …)`);
        }
      }
      for (const name of ["playingHandicapInRound", "playingHandicapPartsInRound"]) {
        // The function's own file hands its caller's `member` on to its sibling.
        if (f === "src/lib/round-allowance.ts") continue;
        for (const given of exactGiven(code, name)) {
          if (!exactly.test(given)) bad.push(`${f}: ${name}(…, { exact: ${given || "(none)"} })`);
        }
      }
      for (const arg of firstArgs(code, "allocatedStrokes")) {
        // `matchStrokesPerHole` spreads a difference between two playing figures at 100%.
        // And `aggregateTeamCard` hands over each member's `courseHandicap`, which
        // the next test pins to the exact figure at both of its callers.
        const insideTheEngine = f === "src/lib/domain/team.ts" && arg === "m.courseHandicap";
        // `matchStrokesDifference` is the same difference, not floored at nought (a plus figure on a medal).
        if (!exactly.test(arg) && !/^matchStrokes(Count|Difference)\(/.test(arg) && arg !== "ch" && !insideTheEngine)
          bad.push(`${f}: allocatedStrokes(${arg}, …)`);
      }
    }
    expect(bad).toEqual([]);
    // The printed card, built in the Print kit's service since 2026-10-23.
    const card = codeOf.get("src/lib/services/print-kit.ts")!;
    expect(card).toMatch(/const frozenExactOf = \(id: string\): number =>\s*roundHandicapExactOf\(/);
    expect(card).toMatch(/allocatedStrokes\(frozenExactOf\(id\), allowance, cardStrokeIndex, parStrokesOf\(id\)\)/);
    expect(card).not.toMatch(/\broundHandicapOf\(/);
  });

  it("a side is priced off its members' unrounded figures, wherever it is priced", () => {
    const teams = codeOf.get("src/lib/services/teams.ts")!;
    expect(teams).toMatch(/\.map\(\(m\) => m\.handicapExact\);/);
    expect(teams).toMatch(/courseHandicap: m\.handicapExact,/);
    expect(teams).not.toMatch(/courseHandicap: m\.handicap,/);
    const entry = codeOf.get("src/app/(app)/entry/page.tsx")!;
    expect(entry).toMatch(/courseHandicap: t\.members\.find\(\(m\) => m\.playerId === c\.playerId\)\?\.handicapExact/);
    expect(entry).not.toMatch(/courseHandicap: c\.handicap,/);
    const bad: string[] = [];
    for (const f of files) {
      for (const arg of firstArgs(codeOf.get(f)!, "sidePlayingHandicap")) {
        if (!/[Ee]xact|^forHandicap$/.test(arg)) bad.push(`${f}: sidePlayingHandicap(${arg}, …)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every reader that prices a round is handed the frozen figure in both forms", () => {
    // A reader that selected `frozen` alone would price a frozen round off the
    // whole number while the board priced it off the exact one: two screens, one
    // stroke apart, for one player in five.
    const rows = codeOf.get("src/lib/services/round-handicap.ts")!;
    const reader = rows.slice(rows.indexOf("export async function roundHandicapRows("));
    expect(reader.slice(0, 600)).toMatch(
      /select: \{ playerId: true, override: true, frozen: true, frozenExact: true, frozenParStrokes: true \}/,
    );
    expect(reader.slice(0, 600)).toMatch(/frozenExact: r\.frozenExact/);
    const board = codeOf.get("src/lib/services/tournament.ts")!;
    expect(board).toMatch(
      /\{ frozen: r\.frozen, frozenExact: r\.frozenExact, frozenParStrokes: r\.frozenParStrokes, override: r\.override \}/,
    );
    // And the freeze writes the two in one statement, both ways it can write.
    expect(rows).toMatch(/frozen: valueFor\(p\),\s*frozenExact: exactFor\(p\),/);
    expect(rows).toMatch(
      /data: \{ frozen: valueFor\(p\), frozenExact: exactFor\(p\), frozenParStrokes: parFor\(p\), frozenAt \}/,
    );
    // Un-freezing clears both.
    const actions = codeOf.get("src/app/actions/tournament.ts")!;
    expect(actions.split("frozen: null, frozenExact: null, frozenParStrokes: null, frozenAt: null").length - 1).toBe(2);
    expect(actions).not.toMatch(/frozen: null, frozenExact: null, frozenAt: null/);
    expect(actions).not.toMatch(/data: \{ frozen: null, frozenAt: null \}/);
  });
});
