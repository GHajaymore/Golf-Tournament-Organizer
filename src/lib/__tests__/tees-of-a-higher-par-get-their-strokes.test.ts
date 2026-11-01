import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import {
  courseHandicapExact,
  courseHandicapMap,
  roundPlayingHandicap,
  playingHandicapFrom,
  NO_PAR_STROKES,
  type IndexHolder,
  type TeeRating,
} from "../domain/handicap";
import { roundParStrokesOf } from "../domain/round-handicap";
import { aggregateTeamCard, allocatedStrokes } from "../domain/team";
import { parStrokesApply } from "../round-allowance";
import { GOLF_FORMATS } from "../formats";

/**
 * A PLAYER ON TEES OF A HIGHER PAR IS GIVEN THE DIFFERENCE.
 *
 * Rules of Handicapping, Rule 6.2b. Where the players in one competition play
 * sets of tees with DIFFERENT PARS, in stroke play or match play counted in
 * gross or net strokes, a player on the tees of the higher par receives
 * additional strokes for the round equal to the difference between the par of
 * the tees they are playing and the tees with the lowest par:
 *
 *     Playing Handicap = (Course Handicap x allowance) + difference in pars
 *
 * and none where the result is counted against par (Stableford, par/bogey),
 * because there each player is already measured against their own.
 *
 * The app gave none until 2026-10-13. Its own seeded club plays a "Men's &
 * Ladies'" medal off tees of par 71 and par 72, and every lady in it was a
 * stroke short — under a browser test that worked the board out "by the Rules"
 * and agreed with it, because the test had read 6.2a and stopped. Found by
 * asking a golf professional what the tests left out.
 *
 * THE AXES, since each one hid it for a different reason:
 *
 *   pars      nearly every fixture has one set of tees, or two of one par
 *   the field half the readers of a round build their handicaps from PART of a
 *             field (one pot, one side, one match), and each would find its own
 *             "lowest par"
 *   format    the Rule gives the strokes in some formats and withholds them in
 *             others, and a round can be SET to points whatever its format
 *   frozen    a round already played keeps what it was played off
 *
 * WHAT THIS DOES NOT COVER: that a board prints the figure this computes
 * (`e2e/boards-by-the-rules.spec.ts` holds the seeded medal to it); a nine-hole
 * round, which is given none (a tee row holds the par of its eighteen, not of
 * each nine); and a side that shares one ball. Both are in
 * `docs/deferred-register.md`.
 */

/** The seeded club's three sets: two of par 71 and the forward set at par 72. */
const BLUE: TeeRating & { courseId: string } = { courseRating: 72.4, slopeRating: 134, par: 71, courseId: "c" };
const WHITE: TeeRating & { courseId: string } = { courseRating: 70.8, slopeRating: 129, par: 71, courseId: "c" };
const RED: TeeRating & { courseId: string } = { courseRating: 72.9, slopeRating: 127, par: 72, courseId: "c" };
/** A set nobody plays, of a LOWER par than any in play. */
const GOLD: TeeRating & { courseId: string } = { courseRating: 66.0, slopeRating: 105, par: 69, courseId: "c" };
const TEES = new Map([
  ["blue", BLUE],
  ["white", WHITE],
  ["red", RED],
  ["gold", GOLD],
]);

const player = (id: string, handicap: number, teeId: string | null, flightTeeId: string | null = null): IndexHolder => ({
  id,
  handicap,
  teeId,
  flightTeeId,
});

/**
 * THE RULE, WORKED IN WHOLE NUMBERS — 6.2a for the allowance, 6.2b on top —
 * sharing neither formula nor floating point with the code. Everything is an
 * exact count of 113,000ths of a stroke; see the test this is modelled on,
 * `allowance-is-taken-of-the-exact-figure.test.ts`.
 */
function byTheRule(indexTenths: number, tee: TeeRating, allowancePct: number, lowestPar: number): number {
  const ratingTenths = Math.round(tee.courseRating * 10);
  const n = (indexTenths * tee.slopeRating + (ratingTenths - tee.par * 10) * 113) * allowancePct;
  const d = 113_000;
  return Math.floor((2 * n + d) / (2 * d)) + (tee.par - lowestPar);
}

describe("the Rule's arithmetic", () => {
  it("adds the difference in pars AFTER the allowance, and takes no allowance of it", () => {
    // 10.0 at 75% is 7.5, which is 8; two strokes for the pars makes 10.
    expect(roundPlayingHandicap(10, 75, 2)).toBe(10);
    // CONTROL: folding the two strokes into the handicap first gives 9.
    expect(playingHandicapFrom(10 + 2, 75)).toBe(9);
    expect(roundPlayingHandicap(10, 75, NO_PAR_STROKES)).toBe(8);
  });

  it("every index from plus 5.0 to 54.0, on the three sets, at six allowances, is the Rule's figure", () => {
    const sets: [string, TeeRating][] = [
      ["blue", BLUE],
      ["white", WHITE],
      ["red", RED],
    ];
    let checked = 0;
    let given = 0;
    for (const pct of [100, 95, 90, 85, 75, 50]) {
      for (let tenths = -50; tenths <= 540; tenths += 1) {
        const field = sets.map(([id]) => player(id, tenths / 10, id));
        const map = courseHandicapMap(field, TEES, "white", 18, "own");
        for (const [id, tee] of sets) {
          const got = roundPlayingHandicap(map.exact(id)!, pct, map.parStrokes(id));
          expect(got, `${tenths / 10} off ${id} at ${pct}%`).toBe(byTheRule(tenths, tee, pct, 71));
          checked += 1;
          if (map.parStrokes(id) > 0) given += 1;
        }
      }
    }
    expect(checked).toBe(6 * 591 * 3);
    // CONTROL: a third of them really were given a stroke — the red tees, every time.
    expect(given).toBe(6 * 591);
  });
});

describe("the lowest par is the FIELD's", () => {
  const field = [player("ann", 18.2, "red"), player("bea", 9.4, "red"), player("col", 12.0, null), player("dev", 3.1, "blue")];

  it("gives the players on the par-72 tees one stroke and the rest none", () => {
    const map = courseHandicapMap(field, TEES, "white", 18, "own");
    expect(["ann", "bea", "col", "dev"].map((id) => map.parStrokes(id))).toEqual([1, 1, 0, 0]);
  });

  it("gives nobody a stroke when the whole field is on one par, whichever par that is", () => {
    const ladies = courseHandicapMap([field[0], field[1]], TEES, "red", 18, "own");
    expect(ladies.parStrokes("ann")).toBe(0);
    expect(ladies.parStrokes("bea")).toBe(0);
    const men = courseHandicapMap([field[2], field[3]], TEES, "white", 18, "own");
    expect(men.parStrokes("col")).toBe(0);
    expect(men.parStrokes("dev")).toBe(0);
  });

  it("a set of tees nobody is playing lowers nobody's handicap", () => {
    // Gold is par 69 and is on the course. Nobody is on it.
    const map = courseHandicapMap(field, TEES, "white", 18, "own");
    expect(map.parStrokes("ann")).toBe(1);
    expect(map.parStrokes("col")).toBe(0);
    // CONTROL: put one player on it and everybody else is owed the difference.
    const withGold = courseHandicapMap([...field, player("eli", 20, "gold")], TEES, "white", 18, "own");
    expect(["ann", "col", "dev", "eli"].map((id) => withGold.parStrokes(id))).toEqual([3, 2, 2, 0]);
  });

  it("a map built for PART of the field still measures from the field's lowest par", () => {
    // A skins pot the two ladies are in, a side of two, the two players of a match.
    const pot = courseHandicapMap([field[0], field[1]], TEES, "white", 18, "own", field);
    expect(pot.parStrokes("ann")).toBe(1);
    expect(pot.parStrokes("bea")).toBe(1);
    // CONTROL: told nothing about the field, the same map finds no difference —
    // which is a stroke the board gives and the pot would not have.
    const alone = courseHandicapMap([field[0], field[1]], TEES, "white", 18, "own");
    expect(alone.parStrokes("ann")).toBe(0);
  });

  it("follows the tees a player is HELD to, not the ones on their record", () => {
    // One set for everyone: ann's own red set does not count, so there is no difference.
    const one = courseHandicapMap(field, TEES, "white", 18, "one");
    expect(field.map((p) => one.parStrokes(p.id))).toEqual([0, 0, 0, 0]);
    // By flight: the ladies' flight is on red, and a player's own set is stepped past.
    const flighted = [player("ann", 18.2, "blue", "red"), player("col", 12.0, "red", null)];
    const byFlight = courseHandicapMap(flighted, TEES, "white", 18, "flight");
    expect(byFlight.parStrokes("ann")).toBe(1);
    expect(byFlight.parStrokes("col")).toBe(0);
  });

  it("gives none over nine holes, where the par of each nine is not known", () => {
    const nine = courseHandicapMap(field, TEES, "white", 9, "own");
    expect(field.map((p) => nine.parStrokes(p.id))).toEqual([0, 0, 0, 0]);
  });

  it("is nought for a player the map has not heard of, and on a course with no tees", () => {
    const map = courseHandicapMap(field, TEES, "white", 18, "own");
    expect(map.parStrokes("nobody")).toBe(0);
    const unrated = courseHandicapMap(field, new Map(), null, 18, "own");
    expect(field.map((p) => unrated.parStrokes(p.id))).toEqual([0, 0, 0, 0]);
  });
});

describe("which rounds give them", () => {
  it("every format the app offers has an answer, and it is the Rule's", () => {
    const yes = ["Match Play", "Stroke Play", "Skins", "Nassau", "Four-Ball", "Best Ball", "Shamble"];
    const answers = Object.fromEntries(GOLF_FORMATS.map((f) => [f.name, parStrokesApply(f.name, "net")]));
    for (const name of yes) expect(answers[name], name).toBe(true);
    // Counted against par.
    expect(answers["Stableford"]).toBe(false);
    expect(answers["Modified Stableford"]).toBe(false);
    // One ball for the side, and a round the app does not price.
    for (const f of GOLF_FORMATS) {
      if (f.ball === "single" || f.manual) expect(answers[f.name], f.name).toBe(false);
    }
    // Nothing answered by accident: every format is in exactly one of the lists above.
    const accounted = GOLF_FORMATS.filter(
      (f) => yes.includes(f.name) || f.engine === "stableford" || f.engine === "modified-stableford" || f.ball === "single" || f.manual,
    );
    expect(accounted.length).toBe(GOLF_FORMATS.length);
    expect(yes.every((n) => GOLF_FORMATS.some((f) => f.name === n))).toBe(true);
  });

  it("a round SET to points gives none, whatever its format", () => {
    expect(parStrokesApply("Four-Ball", "stableford")).toBe(false);
    expect(parStrokesApply("Stroke Play", "stableford")).toBe(false);
    expect(parStrokesApply("Stroke Play", " Stableford ")).toBe(false);
    expect(parStrokesApply("Stroke Play", "modified-stableford")).toBe(false);
    // Every other basis a round can be stored with keeps them.
    for (const basis of ["gross", "net", "both", "", null, undefined]) {
      expect(parStrokesApply("Stroke Play", basis), String(basis)).toBe(true);
    }
  });
});

describe("a round that has been played keeps what it was played off", () => {
  it("reads the frozen figure once the round has frozen, and the field's until then", () => {
    expect(roundParStrokesOf(null, 1)).toBe(1);
    expect(roundParStrokesOf(undefined, 2)).toBe(2);
    expect(roundParStrokesOf({ override: 9 }, 1)).toBe(1);
    expect(roundParStrokesOf({ frozen: 14, frozenParStrokes: 1 }, 0)).toBe(1);
    // The player has since been moved to tees of the lower par: the round is not re-scored.
    expect(roundParStrokesOf({ frozen: 14, frozenParStrokes: 0 }, 1)).toBe(0);
  });

  it("a round frozen before the strokes existed keeps the nets it was given", () => {
    expect(roundParStrokesOf({ frozen: 14, frozenParStrokes: null }, 1)).toBe(0);
    expect(roundParStrokesOf({ frozen: 14 }, 1)).toBe(0);
    // Scratch is frozen too: nought is a handicap, not an absence of one.
    expect(roundParStrokesOf({ frozen: 0 }, 1)).toBe(0);
  });
});

describe("the strokes reach the card", () => {
  const si = [7, 15, 1, 11, 3, 17, 9, 13, 5, 8, 16, 2, 12, 4, 18, 10, 14, 6];
  const pars = new Array(18).fill(4);

  it("falls on the next hole by stroke index, after the allowance", () => {
    // 10.0 at 90% is 9: strokes on indexes 1 to 9. One more for the pars: index 10.
    const without = allocatedStrokes(10, 90, si);
    const withOne = allocatedStrokes(10, 90, si, 1);
    expect(without.reduce((a, b) => a + b, 0)).toBe(9);
    expect(withOne.reduce((a, b) => a + b, 0)).toBe(10);
    const gained = withOne.map((n, h) => n - without[h]);
    expect(gained.filter((n) => n !== 0)).toEqual([1]);
    expect(si[gained.indexOf(1)]).toBe(10);
  });

  it("a four-ball partner on the higher par nets one less on that hole", () => {
    const fives = new Array(18).fill(5);
    const card = (parStrokes?: number) =>
      aggregateTeamCard([{ playerId: "a", strokes: fives, courseHandicap: 10, parStrokes }], pars, si, 90);
    expect(card().netTotal).toBe(90 - 9);
    expect(card(0).netTotal).toBe(90 - 9);
    expect(card(1).netTotal).toBe(90 - 10);
    // And it is the hole of stroke index 10 that moved, not the total alone.
    const hole = si.indexOf(10);
    expect(card(1).holes[hole].net).toBe((card().holes[hole].net ?? 0) - 1);
  });
});

/**
 * NOBODY PRICES A ROUND WITH THE BARE ALLOWANCE.
 *
 * `playingHandicapFrom` is the arithmetic of an allowance and nothing else. A
 * round's playing handicap is `roundPlayingHandicap`, whose third argument is
 * required — so every place that works one out says whether the strokes for
 * the pars are in it. Before that there were thirteen places, and thirteen
 * chances to leave them out with nothing on any screen wrong.
 */
describe("every place a round is priced says whether the pars are in it", () => {
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
  const callsOf = (name: string) =>
    files.filter((f) => {
      const code = codeOf.get(f)!;
      let at = code.indexOf(`${name}(`);
      while (at >= 0) {
        const before = code[at - 1] ?? " ";
        const isDefinition = code.slice(Math.max(0, at - 9), at) === "function ";
        if (!/[A-Za-z0-9_$.]/.test(before) && !isDefinition) return true;
        at = code.indexOf(`${name}(`, at + 1);
      }
      return false;
    });

  /**
   * The only callers of the bare arithmetic: the rule's own file (which builds
   * `roundPlayingHandicap` from it and explains a handicap in words), and the
   * front door's worked example, which is one player on one set of tees.
   */
  const BARE_ALLOWED = ["src/lib/domain/handicap.ts", "src/lib/landing/example.ts"];

  it("CONTROL: the sweep reads the app and finds the places a round is priced", () => {
    expect(files.length).toBeGreaterThan(400);
    // Since 2026-10-14 a round is priced through `playingHandicapInRound` (or its
    // parts), which calls `roundPlayingHandicap` in `round-allowance.ts`.
    const priced = [
      ...callsOf("roundPlayingHandicap"),
      ...callsOf("playingHandicapInRound"),
      ...callsOf("playingHandicapPartsInRound"),
    ];
    // The two boards' resolvers, the round's own list, skins, the league, team
    // sides, the stored team match and the net import, the printed card, the
    // per-hole spread inside a team card, and the one function they share.
    for (const f of [
      "src/lib/round-allowance.ts",
      "src/lib/services/tournament.ts",
      "src/lib/services/round-handicap.ts",
      "src/lib/services/skins-pot.ts",
      "src/lib/services/league.ts",
      "src/lib/services/teams.ts",
      "src/app/actions/tournament.ts",
      // The printed card moved from the Tee sheet to the Print kit (2026-10-23).
      "src/lib/services/print-kit.ts",
      "src/lib/domain/team.ts",
    ]) {
      expect(priced, f).toContain(f);
    }
    // And it can tell a call from the definition and from a longer name.
    expect(callsOf("playingHandicapFrom")).toContain("src/lib/landing/example.ts");
    expect(callsOf("PlayingHandicap")).toEqual([]);
  });

  it("no file prices a round with the bare allowance", () => {
    const offenders = callsOf("playingHandicapFrom").filter((f) => !BARE_ALLOWED.includes(f));
    expect(offenders, "a round is priced with roundPlayingHandicap(exact, pct, parStrokes)").toEqual([]);
  });

  it("nobody hands it a bare nought: it is the round's figure or NO_PAR_STROKES by name", () => {
    const bad: string[] = [];
    for (const f of callsOf("roundPlayingHandicap")) {
      const code = codeOf.get(f)!;
      let at = code.indexOf("roundPlayingHandicap(");
      while (at >= 0) {
        if (code.slice(Math.max(0, at - 9), at) !== "function ") {
          // The whole call, to its matching bracket.
          let depth = 0;
          let i = at + "roundPlayingHandicap(".length;
          const start = i;
          for (; i < code.length; i += 1) {
            if ("([{".includes(code[i])) depth += 1;
            else if (")]}".includes(code[i])) {
              if (depth === 0) break;
              depth -= 1;
            }
          }
          const call = code.slice(start, i);
          if (!/[Pp]arStrokes|NO_PAR_STROKES/.test(call)) bad.push(`${f}: roundPlayingHandicap(${call.replace(/\s+/g, " ").slice(0, 80)})`);
        }
        at = code.indexOf("roundPlayingHandicap(", at + 1);
      }
    }
    expect(bad).toEqual([]);
  });

  it("each of those figures is the frozen one where the round has frozen", () => {
    // `CourseHandicaps.parStrokes` is the field's answer TODAY. Read on its own
    // it would re-score a played round the day somebody is moved to other tees.
    const bad: string[] = [];
    for (const f of files) {
      if (f === "src/lib/domain/handicap.ts") continue;
      const code = codeOf.get(f)!;
      let at = code.indexOf(".parStrokes(");
      while (at >= 0) {
        const lead = code.slice(Math.max(0, at - 160), at);
        // Inside `roundParStrokesOf(row, map.parStrokes(id))`, or handed as
        // `parStrokes:` to `playingHandicapInRound`, which passes it through
        // `roundParStrokesOf` with the round's row (pinned below), or the freeze itself.
        const viaRow =
          /roundParStrokesOf\([^;]*$/.test(lead) ||
          /playingHandicap(Parts)?InRound\([^;]*parStrokes: [^;,]*$/.test(code.slice(Math.max(0, at - 400), at));
        const theFreeze = f === "src/lib/services/round-handicap.ts" && /const parFor = [^;]*$/.test(lead);
        if (!viaRow && !theFreeze) bad.push(`${f}: …${lead.slice(-50).replace(/\s+/g, " ")}.parStrokes(`);
        at = code.indexOf(".parStrokes(", at + 1);
      }
    }
    expect(bad).toEqual([]);
    // CONTROL: there are readers to check, and the freeze is one of them.
    const readers = files.filter((f) => codeOf.get(f)!.includes(".parStrokes("));
    expect(readers.length).toBeGreaterThanOrEqual(7);
    expect(codeOf.get("src/lib/services/round-handicap.ts")).toMatch(/frozenParStrokes: parFor\(p\)/);
    // And the one function the others hand `parStrokes:` to reads it through the round's row.
    expect(codeOf.get("src/lib/round-allowance.ts")).toMatch(/roundParStrokesOf\(row, member\.parStrokes\)/);
  });

  it("a team card is handed each member's strokes for the pars at both of its callers", () => {
    const callers = callsOf("aggregateTeamCard").filter((f) => f !== "src/lib/domain/team.ts");
    expect(callers.sort()).toEqual(["src/app/(app)/entry/page.tsx", "src/lib/services/teams.ts"]);
    for (const f of callers) expect(codeOf.get(f), f).toMatch(/parStrokes: /);
  });
});

/** The seeded club's own tees, so that what the browser test expects is worked here first. */
describe("the seeded club's medal", () => {
  it("a lady off 18.2 on the red tees plays off one more than the allowance alone gives", () => {
    const exact = courseHandicapExact(18.2, RED);
    const alone = playingHandicapFrom(exact, 95);
    expect(alone).toBe(byTheRule(182, RED, 95, 72));
    expect(roundPlayingHandicap(exact, 95, 1)).toBe(byTheRule(182, RED, 95, 71));
    expect(byTheRule(182, RED, 95, 71)).toBe(alone + 1);
  });
});
