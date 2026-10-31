import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildBracket, bracketFinishOrder, knockoutProgress, type BracketView } from "@/lib/domain/bracket";
import type { Player } from "@/lib/domain/types";

/**
 * THE DRAW AND EVERYTHING THAT READS IT SAY ONE THING (foundation pass, layer 9,
 * 2026-10-23).
 *
 * A knockout is told three ways: the draw on the bracket screen (who is in
 * which tie, who won it, the champion), its finishing order — read by the
 * tournament report, the honours board and the season table
 * (`bracketFinishOrder`) — and the count of ties decided (`knockoutProgress`,
 * the dashboard's "5 of 7"). Each is read off the same view and nothing
 * compared them, so a player could be the champion on the draw and second on
 * the honours board without one test going red.
 *
 * So, for a field of any size played in any order, after EVERY result:
 *
 *   - until the final is played there is no finishing order at all — an
 *     unfinished knockout has no places to report;
 *   - once it is, 1st is the draw's champion, 2nd the other finalist, and
 *     everybody else is placed where the DRAW says they went out — beaten in
 *     the round with r rounds after it is 2^r + 1, and shares it with everybody
 *     beaten in that round (the beaten semi-finalists are both 3rd);
 *   - every player is placed once; the progress count is the results recorded.
 *
 * Checked against a second reading of the draw written here — which round each
 * player last appears in — not against the app's own arithmetic.
 */
const field = (n: number): Player[] => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Seed ${i + 1}`, handicap: i, seed: i + 1 }));

/** Which round each player went out in, read off the ties: the last tie they lost. Undefined for the champion. */
function wentOutIn(view: BracketView): Map<string, number> {
  const out = new Map<string, number>();
  for (const round of view.rounds) {
    for (const m of round.matches) {
      if (!m.winnerId) continue;
      for (const slot of [m.a, m.b]) if (slot.playerId && slot.playerId !== m.winnerId) out.set(slot.playerId, round.roundIndex);
    }
  }
  return out;
}

function pick(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

describe("a knockout is read one way", () => {
  it("the draw, its finishing order and its progress agree after every result, whatever the order", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 64 }), fc.integer({ min: 1, max: 1_000_000 }), (n, seed) => {
        const players = field(n);
        const choose = pick(seed);
        const recorded: Record<string, string> = {};
        let view = buildBracket("winners", players, recorded);
        for (let results = 1; results <= n; results += 1) {
          const open = view.rounds.flatMap((r) => r.matches).filter((m) => !m.winnerId && m.a.playerId && m.b.playerId);
          if (open.length === 0) break;
          const tie = open[choose(open.length)];
          recorded[tie.key] = choose(2) === 0 ? tie.a.playerId! : tie.b.playerId!;
          view = buildBracket("winners", players, recorded);

          expect(knockoutProgress(view).decided, `n=${n}: progress against results recorded`).toBe(results);
          const order = bracketFinishOrder(view);
          if (!view.champion) {
            expect(order, `n=${n}: a finishing order before the final was played`).toEqual([]);
            continue;
          }
          const final = view.rounds[view.rounds.length - 1].matches[0];
          const runnerUp = final.a.playerId === view.champion.playerId ? final.b.playerId : final.a.playerId;
          expect(order.filter((p) => p.rank === 1).map((p) => p.playerId)).toEqual([view.champion.playerId]);
          expect(order.filter((p) => p.rank === 2).map((p) => p.playerId)).toEqual([runnerUp]);
          expect(new Set(order.map((p) => p.playerId)).size, `n=${n}: placed once each`).toBe(n);
          const out = wentOutIn(view);
          const rounds = view.rounds.length;
          for (const p of order) {
            if (p.playerId === view.champion.playerId) continue;
            expect(p.rank, `n=${n}: ${p.playerId}`).toBe(2 ** (rounds - 1 - out.get(p.playerId)!) + 1);
          }
        }
        expect(view.champion, `n=${n}: never finished`).not.toBeNull();
      }),
      { seed: 20261023, numRuns: 300 },
    );
  });

  it("CONTROL: a reader that placed by seed instead of by the draw disagrees", () => {
    const players = field(8);
    // The 8 seed beats everybody.
    const recorded: Record<string, string> = {};
    let view = buildBracket("winners", players, recorded);
    for (let guard = 0; guard < 8 && !view.champion; guard += 1) {
      for (const m of view.rounds.flatMap((r) => r.matches)) {
        if (!m.winnerId && m.a.playerId && m.b.playerId) {
          const low = Number(m.a.playerId.slice(1)) > Number(m.b.playerId.slice(1)) ? m.a.playerId : m.b.playerId;
          recorded[m.key] = low;
        }
      }
      view = buildBracket("winners", players, recorded);
    }
    expect(view.champion?.playerId).toBe("p8");
    const bySeed = players.map((p) => p.id);
    expect(bracketFinishOrder(view)[0].playerId).not.toBe(bySeed[0]);
  });
});
