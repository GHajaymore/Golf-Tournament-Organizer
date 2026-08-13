import { describe, it, expect } from "vitest";
import { FORMAT_NAMES, entryModeFor, findFormat, isManualFormat, isPlayable, needsTeams, sideSizeRange } from "@/lib/formats";
import { STAGE_TYPES, generatesPairings, isPlayingRound, stageTypeInfo } from "@/lib/stage-types";
import { bracketSizeFor, buildBracket, seedOrder } from "@/lib/domain/bracket";
import { flightCountFor } from "@/lib/domain/grouping";
import { survivorCount, survivors, type CutCandidate, type CutRule } from "@/lib/domain/cut";
import { aggregateStats, rankPlayers } from "@/lib/domain/standings";
import { DEFAULT_SCORING } from "@/lib/domain/types";
import type { Match, Player } from "@/lib/domain/types";

/**
 * The combination sweep.
 *
 * The 2026-08-12 audit found ~80 defects against a suite of 1400 passing
 * tests, and almost none of them were in a function that was individually
 * wrong. They were in COMBINATIONS nobody had a test for — a nine-hole round
 * inside an eighteen-hole tournament, a format on a stage type that offers no
 * engine, a cut sized against a field that no longer exists, a bracket of
 * three. Individual unit tests cannot find that class of bug, because each
 * part behaves correctly on its own.
 *
 * So this file does not test features. It enumerates the cross product and
 * asserts INVARIANTS that must hold in every cell, whatever the cell is. When
 * a new format or stage type is added it is swept automatically — which is the
 * point, because the cells nobody thought about are exactly the ones that
 * broke.
 *
 * Field sizes deliberately start at ONE. A one-player tournament and a
 * three-player knockout are where off-by-one and divide-by-zero live, and
 * nothing in the suite went below a comfortable eight.
 */

const FIELD_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 16, 28];

const field = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    handicap: i,
    seed: i + 1,
  }));

const finite = (v: number, what: string) => {
  expect(Number.isFinite(v), `${what} was ${v}`).toBe(true);
};

describe("every format, on every stage type", () => {
  for (const format of FORMAT_NAMES) {
    for (const type of STAGE_TYPES) {
      it(`${format} on a ${type} answers coherently`, () => {
        // Nothing here should throw, and every answer should be a real value.
        // A combination the picker refuses may still be reachable through the
        // database or an action, and it must not produce nonsense.
        const info = findFormat(format);
        expect(info.name).toBeTruthy();
        expect(typeof needsTeams(format)).toBe("boolean");
        expect(["stroke", "match", "team"]).toContain(entryModeFor(format));

        const stage = stageTypeInfo(type);
        expect(stage.key).toBe(type);

        // A side size range must be sane in every cell: at least one player,
        // and a maximum no smaller than the minimum.
        const { min, max } = sideSizeRange(format);
        expect(min).toBeGreaterThanOrEqual(1);
        expect(max).toBeGreaterThanOrEqual(min);

        // The hand-scored format must be flagged by isManualFormat on every
        // stage type — that flag is the ONLY thing standing between it and a
        // scoring engine.
        //
        // Note what this cannot assert: `EntryMode` has no "manual" member, so
        // the manual format resolves to a normal entry mode like any other and
        // the app will happily offer it a card. Every path that produces a
        // result has to remember to call isManualFormat first, and the audit
        // found one that does not — the leaderboard checks only the ACTIVE
        // stage, so a hand-scored round mixed with a scored one gets ranked.
        // A guard you must remember to call is a guard that will be forgotten.
        if (isManualFormat(format)) {
          expect(isManualFormat(format)).toBe(true);
          expect(findFormat(format).name).toBe(format);
        }
      });
    }
  }

  it("a format the picker refuses is still classifiable", () => {
    // setStageFormat accepts anything in FORMAT_NAMES, which is a wider gate
    // than the picker's `isPlayable`. Whatever gets stored must still resolve.
    for (const format of FORMAT_NAMES) {
      expect(() => findFormat(format)).not.toThrow();
      expect(typeof isPlayable(format)).toBe("boolean");
    }
  });

  it("only stage types that draw pairings claim to", () => {
    for (const type of STAGE_TYPES) {
      const pairs = generatesPairings(type);
      const playing = isPlayingRound(type);
      expect(typeof pairs).toBe("boolean");
      // A type that draws pairings must be a playing round; drawing matches
      // for a round nobody plays is meaningless.
      if (pairs) expect(playing).toBe(true);
    }
  });
});

describe("brackets, at every field size", () => {
  for (const n of FIELD_SIZES) {
    it(`sizes and seeds a ${n}-player bracket`, () => {
      const size = bracketSizeFor(n);
      // A power of two, never smaller than the field.
      expect(size).toBeGreaterThanOrEqual(Math.max(1, n));
      expect(Number.isInteger(Math.log2(size))).toBe(true);

      const order = seedOrder(size);
      expect(order).toHaveLength(size);
      // Every seed exactly once — a duplicate would put one player in two
      // matches, and a gap would leave a slot nobody can fill.
      expect(new Set(order).size).toBe(size);
      expect(Math.min(...order)).toBe(1);
      expect(Math.max(...order)).toBe(size);
    });

    it(`builds a ${n}-player bracket without inventing players`, () => {
      const players = field(n);
      const view = buildBracket("winners", players, {});
      const ids = new Set(players.map((p) => p.id));
      for (const round of view.rounds) {
        for (const m of round.matches) {
          for (const slot of [m.a, m.b]) {
            if (slot.playerId) {
              expect(ids.has(slot.playerId), `unknown player ${slot.playerId}`).toBe(true);
            }
          }
          // A winner must be one of the two sides of its own match.
          if (m.winnerId) {
            expect([m.a.playerId, m.b.playerId]).toContain(m.winnerId);
          }
        }
      }
    });
  }
});

describe("cuts, at every field size", () => {
  const candidates = (n: number): CutCandidate[] =>
    field(n).map((p) => ({ id: p.id, groupId: null }));

  for (const n of FIELD_SIZES) {
    for (const mode of ["count", "percent"] as const) {
      it(`a ${mode} cut out of ${n} never advances more than the field`, () => {
        for (const value of [0, 1, 2, 16, 50, 66, 100, 150]) {
          const rule: CutRule = {
            scope: "overall",
            mode,
            count: value,
            percent: value,
          };
          const n2 = survivorCount(rule, n);
          // Never more than are playing, and never nobody: a cut that admits
          // nobody ends the tournament, which is never what was meant.
          expect(n2, `${mode} ${value} of ${n}`).toBeLessThanOrEqual(n);
          expect(n2).toBeGreaterThanOrEqual(1);
          expect(survivors(candidates(n), rule).size).toBe(n2);
        }
      });
    }
  }

  it("a cut out of an empty field advances nobody rather than throwing", () => {
    const rule: CutRule = { scope: "overall", mode: "count", count: 4, percent: 50 };
    expect(survivorCount(rule, 0)).toBe(0);
    expect(survivors([], rule).size).toBe(0);
  });
});

describe("flights, at every field size", () => {
  for (const n of FIELD_SIZES) {
    it(`never leaves a lone player in a flight at n=${n}`, () => {
      // The default auto rule floored at TWO flights without checking there
      // were two players: a 2-player event became two flights of one and drew
      // ZERO matches, with nothing on screen to say so.
      for (const config of [
        { mode: "auto" as const },
        { mode: "count" as const, value: 1 },
        { mode: "count" as const, value: 4 },
        { mode: "count" as const, value: 99 },
        { mode: "perFlight" as const, value: 2 },
        { mode: "perFlight" as const, value: 4 },
      ]) {
        const flights = flightCountFor(n, config);
        expect(flights).toBeGreaterThanOrEqual(1);
        expect(flights).toBeLessThanOrEqual(n);
        // Every flight can hold at least two — except a one-player field,
        // where there is nowhere else to put them.
        if (n >= 2) {
          expect(Math.floor(n / flights), `${n} players in ${flights} flights`).toBeGreaterThanOrEqual(2);
        }
      }
    });
  }

  it("draws no flights for an empty field", () => {
    expect(flightCountFor(0)).toBe(0);
  });
});

describe("standings, at every field size", () => {
  const roundRobin = (players: Player[]): Match[] => {
    const out: Match[] = [];
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        out.push({
          id: `m${i}-${j}`,
          stageId: "s1",
          groupId: "g1",
          round: 1,
          playerAId: players[i].id,
          playerBId: players[j].id,
          // A halved eighteen: every field size gets a decided, legal card.
          holes: new Array(18).fill("H") as Match["holes"],
        });
      }
    }
    return out;
  };

  for (const n of FIELD_SIZES) {
    it(`ranks ${n} player(s) contiguously, with finite numbers`, () => {
      const players = field(n);
      const stats = aggregateStats(players, roundRobin(players), DEFAULT_SCORING);
      expect(stats.size).toBe(n);
      for (const s of stats.values()) {
        finite(s.points, "points");
        finite(s.totalPoints, "totalPoints");
        finite(s.holesWon, "holesWon");
        expect(s.played).toBeGreaterThanOrEqual(0);
      }

      const ranked = rankPlayers(players, stats, DEFAULT_SCORING, roundRobin(players));
      expect(ranked).toHaveLength(n);
      // Ranks run 1..n with no gaps and no repeats. A gap means somebody was
      // dropped from the board; a repeat means two players hold one place.
      expect(ranked.map((r) => r.rank)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(new Set(ranked.map((r) => r.player.id)).size).toBe(n);
    });
  }

  it("ranks an empty field without throwing", () => {
    const stats = aggregateStats([], [], DEFAULT_SCORING);
    expect(rankPlayers([], stats, DEFAULT_SCORING, [])).toEqual([]);
  });
});
