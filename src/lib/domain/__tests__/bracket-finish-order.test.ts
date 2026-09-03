import { describe, it, expect } from "vitest";
import { buildBracket, bracketFinishOrder } from "../bracket";
import type { Player } from "../types";

/**
 * A knockout is decided by its draw, and nothing was reading it.
 *
 * `computeStandings` has no points to work with in a knockout, so every player
 * sits on zero and sorts by the only thing left — seed, which is handicap
 * order. Both readers of "how did this finish" took that literally: the honours
 * board proposed the lowest handicap in the field as champion of a competition
 * they may have lost in the first round, and the season table scored everybody
 * behind them in handicap order.
 *
 * Every fixture here makes the LOWEST seed win, so a result that agrees with
 * seed order cannot pass by accident.
 */

const players = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Seed ${i + 1}`,
    handicap: i + 1,
    seed: i + 1,
    groupId: null,
  }));

/** Play the whole bracket through, with the B side of every match winning. */
function playOut(field: Player[]): ReturnType<typeof buildBracket> {
  const winners: Record<string, string> = {};
  let view = buildBracket("winners", field, winners);
  for (let r = 0; r < view.rounds.length; r += 1) {
    for (const m of view.rounds[r].matches) {
      // A bye has nobody on one side; it advances without a recorded result.
      if (m.a.playerId && m.b.playerId) winners[m.key] = m.b.playerId;
    }
    view = buildBracket("winners", field, winners);
  }
  return view;
}

describe("the finishing order of a knockout", () => {
  it("crowns the winner of the final, not the top seed", () => {
    const view = playOut(players(4));
    const order = bracketFinishOrder(view);

    expect(view.champion?.playerId).toBeTruthy();
    expect(order[0].playerId).toBe(view.champion!.playerId);
    expect(order[0].rank).toBe(1);
    // The whole fault in one assertion: seed 1 is not champion here.
    expect(order[0].playerId).not.toBe("p1");
  });

  it("places the beaten finalist second and the beaten semi-finalists joint third", () => {
    const view = playOut(players(4));
    const order = bracketFinishOrder(view);

    expect(order.map((o) => o.rank)).toEqual([1, 2, 3, 3]);
    // Two players share third. That is not a tie to be broken here — it is why
    // clubs play off for third at all (see third-place.ts).
    expect(order.filter((o) => o.rank === 3)).toHaveLength(2);
    expect(new Set(order.map((o) => o.playerId)).size).toBe(4);
  });

  it("places beaten quarter-finalists fifth in a bracket of eight", () => {
    const order = bracketFinishOrder(playOut(players(8)));
    expect(order.map((o) => o.rank)).toEqual([1, 2, 3, 3, 5, 5, 5, 5]);
  });

  it("says nothing at all about an unfinished bracket", () => {
    /**
     * The caller falls back to the standings when this is empty. Returning a
     * partial order with somebody at rank 1 would crown whoever happened to be
     * ahead mid-tournament — which is the fault this exists to fix, arriving
     * from the other direction.
     */
    const field = players(4);
    expect(bracketFinishOrder(buildBracket("winners", field, {}))).toEqual([]);

    // One semi-final played is still not a finished knockout.
    const partial = buildBracket("winners", field, {});
    const one = { [partial.rounds[0].matches[0].key]: partial.rounds[0].matches[0].b.playerId! };
    expect(bracketFinishOrder(buildBracket("winners", field, one))).toEqual([]);
  });

  it("does not record a bye as a defeat", () => {
    // Five players in a bracket of eight: three slots are empty, and nobody
    // was beaten in them.
    const order = bracketFinishOrder(playOut(players(5)));
    expect(order.every((o) => o.playerId.startsWith("p"))).toBe(true);
    expect(order).toHaveLength(5);
    expect(new Set(order.map((o) => o.playerId)).size).toBe(5);
  });

  it("places a player listed twice in the draw only once", () => {
    /**
     * A stored draw is read back verbatim — `parseBracketDraw` will not
     * deduplicate one, because dropping an entry would shift every player
     * after it into a different slot. So a field CAN arrive with the same
     * player in two places, and they can then be beaten twice. They finish
     * where they went out first, not twice in the same list.
     */
    const field = players(4);
    const doubled = [field[0], field[1], field[0], field[3]];
    const order = bracketFinishOrder(playOut(doubled));

    const ids = order.map((o) => o.playerId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "p1")).toHaveLength(1);
  });

  it("places every player exactly once", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 16]) {
      const order = bracketFinishOrder(playOut(players(n)));
      expect(order, `field of ${n}`).toHaveLength(n);
      expect(new Set(order.map((o) => o.playerId)).size, `field of ${n}`).toBe(n);
      // Ranks are non-decreasing, and first place is unshared.
      const ranks = order.map((o) => o.rank);
      expect(ranks, `field of ${n}`).toEqual([...ranks].sort((a, b) => a - b));
      expect(ranks.filter((r) => r === 1), `field of ${n}`).toHaveLength(1);
    }
  });
});
