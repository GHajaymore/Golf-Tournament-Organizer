import { describe, it, expect } from "vitest";
import { GOLF_FORMATS, findFormat, sideSizeRange, needsTeams } from "@/lib/formats";
import { snakeDraw, teamProblems, sidePlayingHandicap } from "@/lib/services/teams";

/**
 * THE APP'S OWN DRAW NEVER PRODUCES A SIDE THE APP CALLS BROKEN.
 *
 * `drawSides` hands the field to `snakeDraw`; the Teams screen then runs
 * `teamProblems` over the result and lists what is wrong with it. Those are
 * the same app answering one question twice, so any disagreement between them
 * is a state an organizer cannot get out of: the app drew it, and the app says
 * it is wrong.
 *
 * It disagreed, on every scramble field that was not a multiple of four —
 * measured 2026-09-14:
 *
 *     5 players   -> [3, 2]        both sides reported "has N of 4 players"
 *     6 players   -> [3, 3]        both reported
 *     14 players  -> [3, 3, 4, 4]  two reported
 *
 * Fourteen is an ordinary charity day. The organizer pressed "draw sides", got
 * four sides, and was told two of them were faulty with no remedy but to
 * recruit two more players.
 *
 * THE CAUSE was `sideSize` doing two jobs. `sideSizeRange` returned
 * `min: sideSize`, so a scramble's minimum was its DEFAULT of four, and every
 * side of three was under the floor. The format's own `weightsBySideSize`
 * carried allowances for sides of 2, 3 and 4 the whole time, so the scoring
 * engine was ready for exactly the sides the validator rejected.
 *
 * Swept across every team format and every field size rather than fixed at
 * fourteen, because the next format added will have a default and a floor too.
 */

/**
 * Field sizes, starting at ONE.
 *
 * CLAUDE.md's rule for this suite, and it earns its place here: 1, 3, 5 and 7
 * are where the remainder lands, and a sweep that starts at a comfortable
 * eight sees none of them. Fourteen is in the list because that is the field
 * the defect was found on.
 */
const FIELD_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 14, 16, 21, 28];

const TEAM_FORMATS = GOLF_FORMATS.filter((f) => f.playable && needsTeams(f.name)).map((f) => f.name);

/**
 * Whether the field can be divided at all under this format's rules.
 *
 * SOME FIELDS GENUINELY CANNOT BE, and the app must keep saying so. Four-ball
 * and foursomes are exactly two a side, so nine players cannot be drawn into
 * legal sides however clever the draw is — somebody has no partner, and
 * "Team 5 has 1 of 2 players" is the app telling the organizer a true thing
 * they need to act on.
 *
 * So the sweep below asserts the draw is right WHERE A RIGHT ANSWER EXISTS.
 * Without this it would be demanding the impossible, and the only way to make
 * it pass would be to stop reporting a real fault.
 */
function canBeDrawn(n: number, min: number, max: number): boolean {
  for (let k = 1; k <= n; k += 1) if (k * min <= n && n <= k * max) return true;
  return false;
}

function drawFor(format: string, n: number) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, handicap: 4 + i }));
  // The size the real action aims for — `drawSides` passes the format's
  // `sideSize`. Reading it the same way here is what makes this a measurement
  // of the app rather than of the harness: an earlier version of this sweep
  // passed the RANGE MINIMUM, drew pairs, and reported a clean sheet for a
  // draw the app would never make.
  const sides = snakeDraw(players, findFormat(format).sideSize, sideSizeRange(format));
  const teams = sides.map((s, i) => ({
    id: `t${i}`,
    name: `Team ${i + 1}`,
    members: s.map((p) => ({ playerId: p.id, handicap: p.handicap })),
  }));
  return { sides, teams };
}

describe("a drawn side is a side the app accepts", () => {
  it("has team formats to sweep — the sweep's own control", () => {
    // Eight on 2026-09-14. A zero here would make every assertion below
    // vacuously true.
    expect(TEAM_FORMATS.length, "no playable team formats found — the sweep is broken").toBeGreaterThan(4);
  });

  it("exempts only the fields that genuinely cannot be drawn", () => {
    /**
     * THE CONTROL ON THE EXEMPTION, which is the part of this sweep most
     * able to hide a defect. `canBeDrawn` decides which cells are asserted at
     * all, so a version of it that returned false too often would leave the
     * whole file green and testing nothing — and it would look exactly like
     * this file passing.
     *
     * So it is checked against cases worked out by hand rather than by
     * calling it:
     *
     *   Four-Ball, 9   exactly 2 a side; 9 is odd, so no k gives 2k = 9.
     *   Best Ball, 3   2 to 4 a side; one side of three fits.
     *   Scramble, 14   2 to 4 a side; 4+4+3+3 fits.
     *   Foursomes, 8   exactly 2; four pairs.
     */
    expect(canBeDrawn(9, 2, 2), "four-ball with nine cannot be paired").toBe(false);
    expect(canBeDrawn(3, 2, 4), "best ball with three is one side of three").toBe(true);
    expect(canBeDrawn(14, 2, 4), "a scramble of fourteen divides fine").toBe(true);
    expect(canBeDrawn(8, 2, 2), "eight is four pairs").toBe(true);
  });

  // Skipping the cells with no legal shape at all — see `canBeDrawn` above.
  for (const format of TEAM_FORMATS) {
    const { min, max } = sideSizeRange(format);
    for (const n of FIELD_SIZES.filter((n) => n >= min && canBeDrawn(n, min, max))) {
      it(`${format}, ${n} players: the draw produces nothing it then rejects`, () => {
        const { sides, teams } = drawFor(format, n);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const problems = teamProblems(teams as any, format);
        expect(
          problems.map((p) => `${p.teamName} ${p.problem}`),
          `the app drew ${JSON.stringify(sides.map((s) => s.length))} and then called it faulty`,
        ).toEqual([]);
      });
    }
  }

  /**
   * THE OTHER DIRECTION, which is the one that makes the above meaningful.
   *
   * "No problems reported" is also true of a `teamProblems` that has stopped
   * reporting anything. A field too small to fill one legal side really is a
   * problem, and it must still be one.
   */
  it("still objects to a side too small to play the format", () => {
    for (const format of TEAM_FORMATS) {
      const { min } = sideSizeRange(format);
      const { teams } = drawFor(format, min - 1 || 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const problems = teamProblems(teams as any, format);
      expect(
        problems.length,
        `${format} accepted a side of ${min - 1 || 1} when it needs ${min}`,
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * AND THE DRAW STILL AIMS FOR THE SIZE THE FORMAT IS PLAYED AT.
 *
 * Widening the RANGE must not widen the DRAW. The obvious way to make the
 * assertions above pass would have been to lower the scramble's `sideSize` to
 * two — which would satisfy every one of them and draw a sixteen-player
 * charity scramble into eight pairs.
 */
describe("the draw still makes the sides the format is played in", () => {
  const cases: Array<[string, number, number[]]> = [
    // A full charity-day field: four fours, not eight pairs.
    ["Scramble", 16, [4, 4, 4, 4]],
    ["Texas Scramble", 16, [4, 4, 4, 4]],
    // And the remainder lands as legal short sides rather than as faults.
    ["Scramble", 14, [3, 3, 4, 4]],
    // Pairs formats are unchanged and must stay so.
    ["Four-Ball", 16, [2, 2, 2, 2, 2, 2, 2, 2]],
    ["Foursomes", 8, [2, 2, 2, 2]],
    ["Best Ball", 8, [2, 2, 2, 2]],
  ];

  it.each(cases)("%s with %i players draws %j", (format, n, expected) => {
    const { sides } = drawFor(format, n);
    expect(sides.map((s) => s.length).sort((a, b) => a - b)).toEqual(
      [...expected].sort((a, b) => a - b),
    );
  });
});

/**
 * AND EVERY LEGAL SIDE SIZE CAN ACTUALLY BE HANDICAPPED.
 *
 * The third reader of the same number. A size the range permits and the draw
 * produces but the allowance cannot price is the same class of contradiction
 * one layer down — it would reach the first tee before anybody noticed.
 */
describe("every side size the format allows has an allowance", () => {
  for (const format of TEAM_FORMATS) {
    const { min, max } = sideSizeRange(format);
    for (let size = min; size <= max; size += 1) {
      it(`${format} can handicap a side of ${size}`, () => {
        // A spread wide enough that a wrong split shows as a different number
        // rather than coinciding — see the Chapman note in
        // handicap-allowances.test.ts for why an even pair proves nothing.
        const hcps = [4, 12, 20, 28].slice(0, size);
        const played = sidePlayingHandicap(hcps, format);
        expect(Number.isFinite(played), "not a number").toBe(true);
        expect(played, "a side cannot play off fewer than zero shots").toBeGreaterThanOrEqual(0);
      });
    }
  }
});
