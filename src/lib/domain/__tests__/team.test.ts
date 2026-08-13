import { describe, it, expect } from "vitest";
import {
  aggregateTeamCard,
  allocatedStrokes,
  sideHandicap,
  singleBallTeamCard,
  teamMatchHoles,
  SCRAMBLE_WEIGHTS_4,
  type TeamMemberCard,
} from "../team";
import { resolveMatch } from "../match";

/** A flat par-4 nine with stroke index 1..9, so allocation is easy to reason about. */
const PARS_9 = [4, 4, 4, 4, 4, 4, 4, 4, 4];
const SI_9 = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const member = (playerId: string, strokes: (number | null)[], courseHandicap: number): TeamMemberCard => ({
  playerId,
  strokes,
  courseHandicap,
});

describe("allocatedStrokes", () => {
  it("applies the allowance before spreading, not after", () => {
    // A 20 nine-hole course handicap at 90% is 18 — two strokes on every one
    // of these nine holes, the full allowance. The old expectation here was
    // [1×9]: the wrap was hardcoded to eighteen, so half the strokes a
    // nine-hole side was due simply vanished. Applying 90% per hole instead
    // would round nine times and drift, which is the other half of the test.
    expect(allocatedStrokes(20, 90, SI_9)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it("gives strokes to the hardest holes first", () => {
    // 4 shots land on stroke index 1-4.
    expect(allocatedStrokes(4, 100, SI_9)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0]);
  });

  it("gives none at scratch", () => {
    expect(allocatedStrokes(0, 100, SI_9)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("aggregate team card (four-ball / best ball)", () => {
  it("takes the better net score on each hole", () => {
    const a = member("a", [5, 4, 6, 4, 4, 4, 4, 4, 4], 0);
    const b = member("b", [4, 6, 5, 4, 4, 4, 4, 4, 4], 0);
    const card = aggregateTeamCard([a, b], PARS_9, SI_9, 100);
    // Hole 1: b's 4 beats a's 5. Hole 2: a's 4 beats b's 6. Hole 3: b's 5.
    expect(card.holes[0].gross).toBe(4);
    expect(card.holes[0].playerId).toBe("b");
    expect(card.holes[1].gross).toBe(4);
    expect(card.holes[1].playerId).toBe("a");
    expect(card.holes[2].gross).toBe(5);
    expect(card.grossTotal).toBe(4 + 4 + 5 + 4 * 6);
  });

  it("lets a handicap stroke change which partner counts", () => {
    // Gross, the scratch player's 4 wins the hole. With a shot on stroke index
    // 1, the higher handicapper's 5 becomes a net 4 and ties — and the gross
    // tiebreak then credits the genuinely better score rather than roster order.
    // A nine-hole course handicap of 9 is one stroke per hole over this nine.
    // (The fixture used to say 18 and still expect one stroke — that was the
    // eighteen-hole wrap leaking into a nine-hole card.)
    const scratch = member("scratch", [4, null, null, null, null, null, null, null, null], 0);
    const bogey = member("bogey", [5, null, null, null, null, null, null, null, null], 9);
    const card = aggregateTeamCard([scratch, bogey], PARS_9, SI_9, 100);
    expect(card.holes[0].net).toBe(4);
    expect(card.holes[0].playerId).toBe("scratch");
  });

  it("does not depend on the order partners are passed in", () => {
    // A team's score must not change because the roster was sorted differently.
    const a = member("a", [5, 4, 6, 4, 4, 4, 4, 4, 4], 3);
    const b = member("b", [4, 6, 5, 4, 4, 4, 4, 4, 4], 12);
    const forward = aggregateTeamCard([a, b], PARS_9, SI_9, 90);
    const reversed = aggregateTeamCard([b, a], PARS_9, SI_9, 90);
    expect(forward.netTotal).toBe(reversed.netTotal);
    expect(forward.grossTotal).toBe(reversed.grossTotal);
  });

  it("scores a hole where only one partner holed out", () => {
    // Partners pick up all the time in four-ball; the hole still counts.
    const a = member("a", [4, null, null, null, null, null, null, null, null], 0);
    const b = member("b", [null, null, null, null, null, null, null, null, null], 0);
    const card = aggregateTeamCard([a, b], PARS_9, SI_9, 100);
    expect(card.holes[0].gross).toBe(4);
    expect(card.played).toBe(1);
  });

  it("leaves a hole nobody completed unscored", () => {
    const a = member("a", [null, null, null, null, null, null, null, null, null], 0);
    const b = member("b", [null, null, null, null, null, null, null, null, null], 0);
    const card = aggregateTeamCard([a, b], PARS_9, SI_9, 100);
    expect(card.holes[0].net).toBeNull();
    expect(card.played).toBe(0);
    expect(card.grossTotal).toBe(0);
  });

  it("counts the best two of four when asked", () => {
    const team = [
      member("a", [4, null, null, null, null, null, null, null, null], 0),
      member("b", [5, null, null, null, null, null, null, null, null], 0),
      member("c", [6, null, null, null, null, null, null, null, null], 0),
      member("d", [7, null, null, null, null, null, null, null, null], 0),
    ];
    const card = aggregateTeamCard(team, PARS_9, SI_9, 100, 2);
    expect(card.holes[0].gross).toBe(9); // 4 + 5
    expect(card.toPar).toBe(9 - 8); // two players' worth of par
  });

  it("awards Stableford points off the counting score", () => {
    // Net birdie on a par 4 is 3 points under standard Stableford.
    const a = member("a", [3, null, null, null, null, null, null, null, null], 0);
    const card = aggregateTeamCard([a], PARS_9, SI_9, 100);
    expect(card.holes[0].points).toBe(3);
    expect(card.pointsTotal).toBe(3);
  });
});

describe("sideHandicap", () => {
  it("halves the combined handicaps for foursomes", () => {
    // 10 and 20 combine to 30; at the 50% foursomes allowance that is 15 for
    // the one ball the pair actually plays.
    expect(sideHandicap([10, 20], 50)).toBe(15);
  });

  it("is order independent", () => {
    expect(sideHandicap([20, 10], 50)).toBe(sideHandicap([10, 20], 50));
  });

  it("applies scramble weights best player first", () => {
    // 25/20/15/10 against handicaps 4, 8, 16, 24 sorted best-first:
    // 1 + 1.6 + 2.4 + 2.4 = 7.4 -> 7
    expect(sideHandicap([24, 4, 16, 8], 0, SCRAMBLE_WEIGHTS_4)).toBe(7);
  });

  it("ignores players beyond the weight table", () => {
    // A fifth player in a four-weight scramble contributes nothing rather than
    // silently inheriting the last weight.
    const four = sideHandicap([4, 8, 16, 24], 0, SCRAMBLE_WEIGHTS_4);
    const five = sideHandicap([4, 8, 16, 24, 30], 0, SCRAMBLE_WEIGHTS_4);
    expect(five).toBe(four);
  });

  it("returns zero for an empty side rather than NaN", () => {
    expect(sideHandicap([], 50)).toBe(0);
  });
});

describe("single-ball team card (foursomes / scramble)", () => {
  it("scores one ball against the side handicap", () => {
    const card = singleBallTeamCard([4, 4, 4, 4, 4, 4, 4, 4, 4], PARS_9, 0, SI_9);
    expect(card.grossTotal).toBe(36);
    expect(card.netTotal).toBe(36);
    expect(card.toPar).toBe(0);
  });

  it("applies the side's strokes on the hardest holes", () => {
    // 3 shots land on stroke index 1-3.
    const card = singleBallTeamCard([4, 4, 4, 4, 4, 4, 4, 4, 4], PARS_9, 3, SI_9);
    expect(card.netTotal).toBe(33);
    expect(card.holes[0].net).toBe(3);
    expect(card.holes[3].net).toBe(4);
  });

  it("handles a partial round", () => {
    const card = singleBallTeamCard([4, 5, null, null, null, null, null, null, null], PARS_9, 0, SI_9);
    expect(card.played).toBe(2);
    expect(card.grossTotal).toBe(9);
    expect(card.toPar).toBe(1);
  });
});

describe("team match play", () => {
  it("produces hole results the singles engine can resolve", () => {
    // The point of returning A/B/H is that four-ball match play reuses
    // resolveMatch rather than growing a second implementation.
    const sideA = aggregateTeamCard(
      [member("a1", [3, 4, 4, 4, 4, 4, 4, 4, 4], 0)],
      PARS_9,
      SI_9,
      100,
    );
    const sideB = aggregateTeamCard(
      [member("b1", [4, 5, 4, 4, 4, 4, 4, 4, 4], 0)],
      PARS_9,
      SI_9,
      100,
    );
    const holes = teamMatchHoles(sideA, sideB);
    expect(holes[0]).toBe("A");
    expect(holes[1]).toBe("A");
    expect(holes[2]).toBe("H");

    const res = resolveMatch(holes);
    expect(res.holesWonA).toBe(2);
    expect(res.holesWonB).toBe(0);
    expect(res.winner).toBe("A");
    // CHANGED from "2 UP", which was wrong golf. A wins the first two and the
    // rest are halved, so at the 8th A is two up with one to play — the match
    // is over there and the margin is 2&1. resolveMatch now finds the hole the
    // match was decided on (Rule 3.2a(3)) instead of reading only the final
    // state, which is what used to report a closed-out match as "N UP".
    expect(res.resultText).toBe("2&1");
    expect(res.remaining).toBe(1);
  });

  it("leaves a hole unplayed when either side has no score", () => {
    const sideA = aggregateTeamCard([member("a1", [4], 0)], [4], [1], 100);
    const sideB = aggregateTeamCard([member("b1", [null], 0)], [4], [1], 100);
    expect(teamMatchHoles(sideA, sideB)[0]).toBeNull();
  });
});
