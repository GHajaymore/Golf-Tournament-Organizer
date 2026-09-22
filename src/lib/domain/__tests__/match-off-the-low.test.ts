import { describe, it, expect } from "vitest";
import { aggregateTeamCard, matchHolesOffTheLow, type MatchBall } from "../team";
import { holeStrokesReceived } from "../stroke";

/**
 * FOUR-BALL MATCH PLAY IS PLAYED OFF THE LOWEST HANDICAP IN THE MATCH.
 *
 * Rules of Golf / WHS: in four-ball match play each player takes 90% of their
 * Course Handicap, the lowest of the four then plays from scratch, and the
 * other three receive the DIFFERENCE, allocated by stroke index. Recomputed
 * for each match — so in a league, each week, off whoever is lowest in that
 * particular four.
 *
 * The app used to compare the two sides' net better balls with every player on
 * their full allowance. That is the net-MEDAL method. These tests pin the
 * difference rather than the spelling, and every one of them computes the old
 * method in the same run so the divergence is demonstrated here rather than
 * remembered from a comment.
 */

const PARS = Array.from({ length: 18 }, () => 4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/** A card with a single score, on the hole at this stroke index. */
function only(si: number, gross: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: 18 }, () => null);
  out[si - 1] = gross;
  return out;
}

/**
 * The method this replaced, written out here rather than imported.
 *
 * `teamMatchHoles` built a `TeamCard` per side with every player on their full
 * allowance and compared the two net better balls. It is deleted from the
 * domain — nothing called it once both match paths moved — so the control
 * lives here, which also means it cannot be quietly changed out from under the
 * comparison it exists to make.
 */
function oldMethod(a: MatchBall[], b: MatchBall[]) {
  const card = (side: MatchBall[]) =>
    aggregateTeamCard(
      side.map((ball, i) => ({
        playerId: `p${i}`,
        strokes: ball.strokes,
        courseHandicap: ball.playingHandicap,
      })),
      PARS,
      SI,
      100,
      1,
    );
  const [ca, cb] = [card(a), card(b)];
  return ca.holes.map((hole, h) => {
    const x = hole.net;
    const y = cb.holes[h]?.net ?? null;
    if (x == null || y == null) return null;
    return x < y ? "A" : y < x ? "B" : "H";
  });
}

describe("four-ball match play, strokes off the low handicap", () => {
  /**
   * The case is chosen so the two methods reach DIFFERENT hole winners, not
   * merely different stroke vectors — a difference the match never sees would
   * not be worth changing anything for.
   */
  const sideA: MatchBall[] = [
    { strokes: only(1, 5), playingHandicap: 4 },
    { strokes: only(1, 6), playingHandicap: 20 },
  ];
  const sideB: MatchBall[] = [
    { strokes: only(1, 5), playingHandicap: 9 },
    { strokes: only(1, 6), playingHandicap: 14 },
  ];

  it("gives the hole to the side the Rules give it to, where the old method halved it", () => {
    const now = matchHolesOffTheLow(sideA, sideB, SI, 18, 1);
    const before = oldMethod(sideA, sideB);

    /*
     * Worked by hand on the stroke-index-1 hole, low handicap 4:
     *
     *            plays off   strokes there   gross   net
     *   A1            4  -  4 = 0        0       5     5
     *   A2           20  -  4 = 16       1       6     5   → side A: 5
     *   B1            9  -  4 = 5        1       5     4
     *   B2           14  -  4 = 10       1       6     5   → side B: 4
     *
     * B wins it. Under full allowances A2 is off 20, which is a stroke and a
     * half a hole — two on stroke index 1 — so A's better ball is 4 as well
     * and the hole is halved. The extra stroke A2 receives there is exactly
     * the one the low player's own allocation should have cancelled.
     */
    expect(now[0]).toBe("B");
    expect(before[0]).toBe("H");
  });

  it("gives the lowest handicap in the match no strokes at all", () => {
    // A1 is the low man. Against a B side that returns the same gross
    // everywhere, any stroke he received would show up as a hole won.
    const scratchOnly: MatchBall[] = [{ strokes: only(1, 5), playingHandicap: 4 }];
    const same: MatchBall[] = [{ strokes: only(1, 5), playingHandicap: 4 }];
    expect(matchHolesOffTheLow(scratchOnly, same, SI, 18, 1)[0]).toBe("H");
  });

  it("allocates the difference by stroke index, hardest hole first", () => {
    // Five strokes of difference must land on stroke index 1 to 5 and nowhere
    // else — the property, not a spelling. Asserted through the public
    // function: the receiving side wins exactly those five holes when both
    // return the same gross everywhere.
    const low: MatchBall[] = [{ strokes: PARS.map(() => 5), playingHandicap: 6 }];
    const high: MatchBall[] = [{ strokes: PARS.map(() => 5), playingHandicap: 11 }];
    const holes = matchHolesOffTheLow(low, high, SI, 18, 1);
    const wonByHigh = holes.flatMap((h, i) => (h === "B" ? [SI[i]] : []));
    expect(wonByHigh).toEqual([1, 2, 3, 4, 5]);
    expect(holes.filter((h) => h === "H")).toHaveLength(13);
  });

  it("carries a second stroke where the difference exceeds the holes", () => {
    // 22 off 2 is twenty strokes over eighteen holes: one everywhere, two on
    // stroke index 1 and 2. A control on the wrap, which is where an
    // allocator that merely compares index against handicap goes wrong.
    const diff = 20;
    const perHole = SI.map((si) => holeStrokesReceived(diff, si, 18));
    expect(perHole.filter((n) => n === 2)).toHaveLength(2);
    expect(perHole.filter((n) => n === 1)).toHaveLength(16);

    const low: MatchBall[] = [{ strokes: PARS.map(() => 6), playingHandicap: 2 }];
    const high: MatchBall[] = [{ strokes: PARS.map(() => 7), playingHandicap: 22 }];
    const holes = matchHolesOffTheLow(low, high, SI, 18, 1);
    // Gross 7 against 6 with one stroke is a half; with two it is a win.
    expect(holes.flatMap((h, i) => (h === "B" ? [SI[i]] : []))).toEqual([1, 2]);
  });

  it("leaves a hole undecided until both sides have returned a score", () => {
    const a: MatchBall[] = [{ strokes: only(1, 4), playingHandicap: 10 }];
    const b: MatchBall[] = [{ strokes: [], playingHandicap: 10 }];
    expect(matchHolesOffTheLow(a, b, SI, 18, 1)[0]).toBeNull();
  });

  it("counts the best two where the league counts the best two", () => {
    // countBest is the side's counting scores, the same meaning
    // aggregateTeamCard gives it. With two counting, the partner's score
    // stops being irrelevant — which is the whole difference.
    const a: MatchBall[] = [
      { strokes: only(1, 4), playingHandicap: 5 },
      { strokes: only(1, 9), playingHandicap: 5 },
    ];
    const b: MatchBall[] = [
      { strokes: only(1, 5), playingHandicap: 5 },
      { strokes: only(1, 5), playingHandicap: 5 },
    ];
    // Best one: A's 4 beats B's 5.
    expect(matchHolesOffTheLow(a, b, SI, 18, 1)[0]).toBe("A");
    // Best two: A's 13 loses to B's 10.
    expect(matchHolesOffTheLow(a, b, SI, 18, 2)[0]).toBe("B");
  });
});
