import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveMatch, matchIsOver, matchStandingText, marginRefusal, marginToHoles, storedMatchIsOver, deriveNetHoles } from "../match";
import { countbackCompare, countbackSegments } from "../stroke-countback";
import { survivorCount, strokeCutOutcome, type CutRule } from "../cut";
import { buildBracket, bracketSizeFor, seedOrder, type BracketView } from "../bracket";
import type { Player } from "../types";
import { playMatch, chooser, strokesByHandingOut, type Hole } from "./properties-reference";

/**
 * PROPERTIES OF A ROUND AND OF ROUNDS: a match, a countback, a cut, a draw —
 * each a Rule checked against a second route to it (`properties-reference.ts`),
 * foundation pass, 2026-10-23, at the testing panel's request. Fixed seeds; a
 * failure fast-check shrank is pinned below as an ordinary test.
 */
const RUNS = { seed: 20261023, numRuns: 2000 } as const;

const hole = fc.constantFrom<Hole>("A", "B", "H");
/** A card as it is kept: holes 1..k with a result, the rest not yet played. */
const cardOf = (n: number) =>
  fc.tuple(fc.array(hole, { minLength: n, maxLength: n }), fc.integer({ min: 0, max: n })).map(([r, k]) => r.map((h, i) => (i < k ? h : null)));
const anyCard = fc.constantFrom(9, 18).chain(cardOf);

describe("a match (Rule 3.2)", () => {
  it("is decided where a referee walking the card decides it — winner, margin and lead", () => {
    fc.assert(
      fc.property(anyCard, (holes) => {
        const ref = playMatch(holes);
        const app = resolveMatch(holes);
        expect(app.complete).toBe(ref.over);
        expect(matchIsOver(holes)).toBe(ref.over && holes.some((h) => h !== null));
        if (ref.over) {
          expect(app.winner).toBe(ref.winner);
          expect(app.resultText).toBe(ref.text);
        } else {
          expect(app.lead).toBe(ref.lead);
        }
      }),
      RUNS,
    );
  });

  it("dormie is up by exactly the holes left, and it is not over", () => {
    fc.assert(
      fc.property(anyCard, (holes) => {
        const app = resolveMatch(holes);
        const text = matchStandingText(app, "Ann", "Bea");
        const dormie = !app.complete && app.played > 0 && Math.abs(app.lead) === app.remaining && app.lead !== 0;
        expect(text.includes("dormie")).toBe(dormie);
        if (dormie) expect(matchIsOver(holes)).toBe(false);
      }),
      RUNS,
    );
  });

  it("every result a match can finish with is one the app accepts — and stores as THAT result", () => {
    fc.assert(
      fc.property(fc.constantFrom(9, 18).chain((n) => fc.array(hole, { minLength: n, maxLength: n })), (full) => {
        const ref = playMatch(full);
        if (!ref.over || ref.winner === "H") return;
        const n = full.length;
        expect(marginRefusal(ref.winner!, ref.text, n)).toBeNull();
        const stored = resolveMatch(marginToHoles(ref.winner!, ref.text, n));
        expect([stored.winner, stored.resultText]).toEqual([ref.winner, ref.text]);
      }),
      RUNS,
    );
  });

  it("every margin the app ACCEPTS is a result a match can finish with, stored as typed", () => {
    // The other direction, and the one that failed: a margin no match can end
    // on was accepted and stored as a different result (pinned below).
    fc.assert(
      fc.property(
        fc.constantFrom(9, 18),
        fc.constantFrom<"A" | "B">("A", "B"),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: -1, max: 20 }),
        (n, winner, lead, toPlay) => {
          const margin = toPlay < 0 ? `${lead} UP` : `${lead}&${toPlay}`;
          if (marginRefusal(winner, margin, n) !== null) return;
          const stored = resolveMatch(marginToHoles(winner, margin, n));
          expect([stored.winner, stored.resultText]).toEqual([winner, margin]);
        },
      ),
      RUNS,
    );
  });

  it("PINNED: '6&3', '3 UP' and '10&9' are no result a match of eighteen can finish with", () => {
    // 6&3: the match was over at 5&4. 3 UP: two up with one to play is over (2&1).
    // 10&9: ten holes won needs ten played, which leaves eight.
    expect(marginRefusal("A", "6&3", 18)).not.toBeNull();
    expect(marginRefusal("A", "3 UP", 18)).not.toBeNull();
    expect(marginRefusal("B", "10&9", 18)).not.toBeNull();
    expect(marginRefusal("A", "6&4", 9)).not.toBeNull();
    // and the ones that can, still can
    for (const ok of ["1 UP", "2 UP", "2&1", "3&1", "3&2", "5&3", "5&4", "10&8"]) expect(marginRefusal("A", ok, 18), ok).toBeNull();
    expect(marginRefusal("A", "5&4", 9)).toBeNull();
  });

  it("net match play: the higher handicap receives the full difference, by stroke index, and a hole is decided only once both have a score", () => {
    // The first mutation run (2026-10-23) found the direction of those strokes
    // unchecked: a net score made gross PLUS the strokes survived.
    fc.assert(
      fc.property(
        fc.shuffledSubarray(Array.from({ length: 18 }, (_, i) => i + 1), { minLength: 18, maxLength: 18 }),
        fc.integer({ min: 0, max: 36 }),
        fc.integer({ min: 0, max: 36 }),
        fc.array(fc.option(fc.integer({ min: 2, max: 9 }), { nil: null, freq: 6 }), { minLength: 18, maxLength: 18 }),
        fc.array(fc.option(fc.integer({ min: 2, max: 9 }), { nil: null, freq: 6 }), { minLength: 18, maxLength: 18 }),
        (si, hA, hB, a, b) => {
          const diff = hA - hB;
          const shots = strokesByHandingOut(Math.abs(diff), si);
          const holes = deriveNetHoles(a, b, hA, hB, si, 18);
          for (let i = 0; i < 18; i += 1) {
            if (a[i] == null || b[i] == null) {
              expect(holes[i]).toBeNull();
              continue;
            }
            const netA = a[i]! - (diff > 0 ? shots[i] : 0);
            const netB = b[i]! - (diff < 0 ? shots[i] : 0);
            expect(holes[i]).toBe(netA < netB ? "A" : netB < netA ? "B" : "H");
          }
        },
      ),
      RUNS,
    );
  });

  it("a walkover is decided with no hole played; an untouched card is not", () => {
    expect(storedMatchIsOver({ holes: "[]", forfeitedBy: "p1" })).toBe(true);
    expect(storedMatchIsOver({ holes: JSON.stringify(Array(18).fill(null)), forfeitedBy: null })).toBe(false);
    expect(storedMatchIsOver({ holes: "[]", forfeitedBy: null })).toBe(false);
    // Won on the 19th is not a margin the card can hold: the app asks for one.
    expect(marginRefusal("A", "19th", 18)).not.toBeNull();
  });
});

describe("a countback (Committee Procedures 5A(3)): last 9, 6, 3, 1 — last 6, 3, 1 on a nine", () => {
  const score = fc.integer({ min: 1, max: 9 });
  it("the first segment that differs decides it, the lower total ahead; level on every segment is level", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(9, 18).chain((n) => fc.tuple(fc.constant(n), fc.array(score, { minLength: n, maxLength: n }), fc.array(score, { minLength: n, maxLength: n }))),
        fc.boolean(),
        ([n, a, b], higherWins) => {
          const steps = n === 18 ? [9, 6, 3, 1] : [6, 3, 1];
          expect(countbackSegments(n)).toEqual(steps);
          const tail = (c: number[], k: number) => c.slice(n - k).reduce((x, y) => x + y, 0);
          let expected = 0;
          for (const k of steps) {
            const d = tail(a, k) - tail(b, k);
            if (d !== 0) {
              expected = higherWins ? -Math.sign(d) : Math.sign(d);
              break;
            }
          }
          const total = (c: number[]) => c.reduce((x, y) => x + y, 0);
          const got = countbackCompare({ playerId: "a", total: total(a), holes: a }, { playerId: "b", total: total(b), holes: b }, n, higherWins);
          expect(Math.sign(got)).toBe(expected);
          const back = countbackCompare({ playerId: "b", total: total(b), holes: b }, { playerId: "a", total: total(a), holes: a }, n, higherWins);
          expect(Math.sign(back)).toBe(-expected);
        },
      ),
      RUNS,
    );
  });

  it("a card with a hole missing cannot win or lose a countback", () => {
    fc.assert(
      fc.property(fc.array(score, { minLength: 18, maxLength: 18 }), fc.array(score, { minLength: 18, maxLength: 18 }), fc.integer({ min: 9, max: 17 }), (a, b, gap) => {
        const holes = a.map((s, i) => (i === gap ? null : s));
        expect(countbackCompare({ playerId: "a", total: 0, holes }, { playerId: "b", total: 0, holes: b }, 18)).toBe(0);
      }),
      RUNS,
    );
  });
});

describe("a cut (top N, or a percentage, and ties)", () => {
  const rule = (n: number, pct: number, percent: boolean): CutRule => ({ scope: "overall", mode: percent ? "percent" : "count", count: n, percent: pct });

  it("a percentage of the field rounds UP to a whole player, and never cuts to nobody or past the field", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 400 }), (field, pct, count) => {
        const byPercent = survivorCount(rule(count, pct, true), field);
        const byCount = survivorCount(rule(count, pct, false), field);
        if (field === 0) {
          expect([byPercent, byCount]).toEqual([0, 0]);
          return;
        }
        const ceil = Math.floor((field * pct + 99) / 100);
        expect(byPercent).toBe(Math.max(1, Math.min(ceil, field)));
        expect(byCount).toBe(Math.max(1, Math.min(count, field)));
      }),
      RUNS,
    );
  });

  it("'and ties': everybody level with the last place through goes through, nobody below it does, and nobody unplaced", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 60, max: 90 }), { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 1, max: 70 }),
        (scores, unplaced, n) => {
          // The board's own places: standard competition ranking (1, 2, 2, 4).
          const sorted = [...scores].sort((x, y) => x - y);
          const rows = sorted.map((s, i) => ({ id: `p${i}`, rank: sorted.indexOf(s) + 1, s, score: s }));
          const all = [...rows, ...Array.from({ length: unplaced }, (_, k) => ({ id: `u${k}`, rank: 0, s: 999, score: 999 }))];
          // The one answer to who goes through a stroke cut (the cut-tie work, 2026-10-23), asked
          // with the committee's "and ties" and no decisions: nobody is owed a play-off or a draw.
          const through = strokeCutOutcome(all, rule(n, 0, false), "ties", []).through;
          const take = Math.max(1, Math.min(n, rows.length));
          const lineScore = sorted[take - 1];
          for (const r of rows) expect(through.has(r.id), `${r.id} on ${r.s}, line ${lineScore}`).toBe(r.s <= lineScore);
          for (let k = 0; k < unplaced; k += 1) expect(through.has(`u${k}`)).toBe(false);
          expect(through.size).toBeGreaterThanOrEqual(take);
        },
      ),
      RUNS,
    );
  });
});

describe("a knockout draw (Rule 3.2; Committee Procedures 5A(7))", () => {
  const field = (n: number): Player[] => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Seed ${i + 1}`, handicap: i, seed: i + 1 }));

  /** How many real players stand under each place of a tie. */
  function under(view: BracketView, r: number, i: number): number {
    if (r === 0) {
      const m = view.rounds[0].matches[i];
      return (m.a.playerId ? 1 : 0) + (m.b.playerId ? 1 : 0);
    }
    return under(view, r - 1, i * 2) + under(view, r - 1, i * 2 + 1);
  }

  it("a field of 1 to 256, its ties played in ANY order: n − 1 results, no champion early, and no place reads Bye that somebody can still reach", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 256 }), fc.integer({ min: 1, max: 1_000_000 }), (n, seed) => {
        const players = field(n);
        const pick = chooser(seed);
        const recorded: Record<string, string> = {};
        let view = buildBracket("winners", players, recorded);
        let results = 0;
        for (let guard = 0; guard < n + 2; guard += 1) {
          for (const round of view.rounds) {
            for (const m of round.matches) {
              const reachA = m.roundIndex === 0 ? (m.a.playerId ? 1 : 0) : under(view, m.roundIndex - 1, m.matchIndex * 2);
              const reachB = m.roundIndex === 0 ? (m.b.playerId ? 1 : 0) : under(view, m.roundIndex - 1, m.matchIndex * 2 + 1);
              if (m.a.name === "Bye") expect(reachA, `n=${n}: a reachable place reads Bye`).toBe(0);
              if (m.b.name === "Bye") expect(reachB, `n=${n}: a reachable place reads Bye`).toBe(0);
            }
          }
          const open = view.rounds.flatMap((r) => r.matches).filter((m) => !m.winnerId && m.a.playerId && m.b.playerId);
          if (open.length === 0) break;
          const tie = open[pick(open.length)];
          recorded[tie.key] = pick(2) === 0 ? tie.a.playerId! : tie.b.playerId!;
          results += 1;
          view = buildBracket("winners", players, recorded);
          if (results < n - 1) expect(view.champion, `n=${n}: a champion after ${results} of ${n - 1}`).toBeNull();
        }
        expect(results).toBe(Math.max(0, n - 1));
        if (n >= 2) expect(view.champion).not.toBeNull();
      }),
      { seed: 20261023, numRuns: 60 },
    );
  });

  it("the seeding: every seed once, the top two in opposite halves, and in round one seed k meets seed (size + 1 − k)", () => {
    for (const size of [2, 4, 8, 16, 32, 64, 128, 256]) {
      const order = seedOrder(size);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
      for (let k = 0; k < size; k += 2) expect(order[k] + order[k + 1], `size ${size}`).toBe(size + 1);
      const half = size / 2;
      expect(order.indexOf(1) < half).not.toBe(order.indexOf(2) < half);
    }
    for (let n = 1; n <= 256; n += 1) expect(bracketSizeFor(n)).toBe(n <= 1 ? bracketSizeFor(1) : 2 ** Math.ceil(Math.log2(n)));
  });
});
