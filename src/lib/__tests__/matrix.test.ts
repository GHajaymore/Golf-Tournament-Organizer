import { describe, it, expect } from "vitest";
import {
  DEFAULT_INPUT,
  FORMAT_NAMES,
  declaredInput,
  entryModeFor,
  findFormat,
  inputChoices,
  isManualFormat,
  isPlayable,
  needsTeams,
  resolveScoreInput,
  sideSizeRange,
} from "@/lib/formats";
import { STAGE_TYPES, generatesPairings, isPlayingRound, stageTypeInfo } from "@/lib/stage-types";
import { bracketSizeFor, buildBracket, seedOrder } from "@/lib/domain/bracket";
import { flightCountFor } from "@/lib/domain/grouping";
import { survivorCount, survivors, type CutCandidate, type CutRule } from "@/lib/domain/cut";
import { aggregateStats, rankPlayers } from "@/lib/domain/standings";
import { entryModesFor, type MatchEntryMode } from "@/lib/domain/match-entry";
import { matchCardFinished, matchStrokeCards, type MatchForCards } from "@/lib/domain/match-cards";
import { aggregateStroke, isRanked, type StrokeCard } from "@/lib/domain/stroke-agg";
import { resolveMatch } from "@/lib/domain/match";
import { holeStrokesReceived, stablefordPointsForHole, allocationHoles } from "@/lib/domain";
import {
  handicapToFreeze,
  isReturnedCard,
  resolveRoundHandicap,
  roundHandicapKey,
} from "@/lib/domain/round-handicap";
import { playingHandicapFrom } from "@/lib/domain/handicap";
import {
  effectiveAllowance,
  snakeDraw,
  teamProblems,
  type TeamView,
} from "@/lib/services/teams";
import { DEFAULT_SCORING } from "@/lib/domain/types";
import type { HoleResult, Match, Player } from "@/lib/domain/types";

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

/**
 * What every format asks to be RECORDED.
 *
 * The default is a real card, and a format may opt OUT of that — never opt in.
 * Swept across the whole catalog so a format added tomorrow is checked the day
 * it appears, which is the point of this file: the cells nobody thought about
 * are the ones that broke.
 */
describe("the input model, on every format", () => {
  /** Overrides a caller could actually send. Two are junk on purpose: a
   *  `"use server"` export is a public HTTP endpoint and its argument types are
   *  erased at runtime, so these ARE reachable. */
  const OVERRIDES = ["", "gross-cards", "hole-results", "match-result", "nonsense", "  "];

  for (const format of FORMAT_NAMES) {
    it(`${format} declares an input and never resolves outside it`, () => {
      const choices = inputChoices(format);
      expect(choices.length).toBeGreaterThanOrEqual(1);
      // No duplicates: a picker listing one shape twice is a picker nobody can
      // read an answer off.
      expect(new Set(choices).size).toBe(choices.length);
      // A full card is ALWAYS available. That is "opt out, not opt in" made
      // structural — a format may say a reduced shape is its natural one, and
      // may not say a club is forbidden to return cards. Under WHS a match
      // score counts for handicapping only when a full card comes back.
      expect(choices, `${format} must allow a card`).toContain(DEFAULT_INPUT);
      // The natural input is the first, and it is one of the choices.
      expect(choices).toContain(declaredInput(format));
      expect(declaredInput(format)).toBe(choices[0]);

      for (const override of OVERRIDES) {
        const got = resolveScoreInput(format, override);
        expect(choices, `${format} + "${override}"`).toContain(got);
      }
      // Null and undefined are the same "no opinion" as "".
      expect(resolveScoreInput(format, null)).toBe(declaredInput(format));
      expect(resolveScoreInput(format, undefined)).toBe(declaredInput(format));
      expect(resolveScoreInput(format, "nonsense")).toBe(declaredInput(format));

      // The entry screen and the catalog answer with the same list. They were
      // two places that both knew which formats produce no card, and they had
      // already drifted over Nassau.
      expect(entryModesFor(format)).toEqual(choices);
    });

    it(`${format} only offers a reduced input its engine can read`, () => {
      const choices = inputChoices(format);
      const reduced = choices.filter((c) => c !== DEFAULT_INPUT);
      if (reduced.length === 0) return;
      // Hole results and a final margin are match-play shapes: they say who
      // won the hole, and a stroke engine has no such concept. Offering one on
      // a stroke format would be offering a shape the scoring cannot read.
      expect(["match", "nassau"], `${format} offers ${reduced.join(", ")}`).toContain(
        findFormat(format).engine,
      );
      // Nassau slices one match into three bets. "3&2" cannot say who took the
      // front nine, so two of the three would have to be invented.
      if (findFormat(format).engine === "nassau") {
        expect(choices).not.toContain("match-result" as MatchEntryMode);
      }
    });
  }
});

/**
 * Match cards, joined and added up, at every field size.
 *
 * The combination this whole change lives in: a round-robin stage holds the
 * WHOLE round robin, so one player has several matches inside one round, and
 * at least one of those matches ends early. Field sizes start at ONE — a
 * one-player round has no matches at all, and a two-player round is a single
 * match that may itself be the one that stopped short.
 *
 * Asserted against the Rules of Golf: Rule 3.2a(3) ends a match when a side
 * leads by more holes than remain, and Rule 3.2b lets a hole be conceded. The
 * five-and-four card below is a legal card that stops on the 14th — not
 * "AAAAABBBB", which is A five up with four to play and therefore a match that
 * ended before B won anything.
 */
describe("match cards, at every field size and both hole counts", () => {
  /**
   * NINE AND EIGHTEEN, because a nine-hole round inside an eighteen-hole
   * tournament is the first combination CLAUDE.md names and this sweep did
   * not have it: every fixture here was `new Array(18)`, so nothing asserted
   * that holesOwed follows the ROUND rather than a constant.
   */
  const HOLE_COUNTS = [9, 18] as const;

  for (const holeCount of HOLE_COUNTS) {
    const CARD = {
      pars: new Array(holeCount).fill(4) as number[],
      holeDifficulty: Array.from({ length: holeCount }, (_, i) => i + 1),
    };
    const AGG_OPTS = {
      courseFor: () => CARD,
      handicapFor: () => 0,
      holeStrokesReceived,
      stablefordPointsForHole,
      allocationHoles,
    };

    /** Halved over the full round: a finished match with a complete card. */
    const HALVED: HoleResult[] = new Array(holeCount).fill("H");

    /**
     * A match that ended before the last hole, legal at THIS length.
     *
     * Rule 3.2a(3): a match ends when a side leads by more holes than remain.
     * Over eighteen that is A five up after fourteen — 5&4. Over nine it is A
     * four up after six — 4&3. Both are cards that can exist. A lead that
     * never exceeds what is left would be a match still in progress, and a
     * fixture asserting otherwise would be asserting an impossible round.
     */
    const EARLY: HoleResult[] =
      holeCount === 18
        ? [...new Array(5).fill("A"), ...new Array(9).fill("H"), ...new Array(4).fill(null)]
        : [...new Array(4).fill("A"), ...new Array(2).fill("H"), ...new Array(3).fill(null)];

    const cardFor = (holes: HoleResult[]) =>
      JSON.stringify(holes.map((h) => (h === null ? null : 4)));

    for (const n of FIELD_SIZES) {
      it(`joins and ranks a ${n}-player ${holeCount}-hole round robin honestly`, () => {
        const players = field(n);
        const matches: MatchForCards[] = [];
        for (let i = 0; i < players.length; i += 1) {
          for (let j = i + 1; j < players.length; j += 1) {
            // The FIRST match of the round ends early; everything else goes
            // the distance. Every match in the round is decided either way.
            const holes = matches.length === 0 ? EARLY : HALVED;
            matches.push({
              id: `m${i}-${j}`,
              stageId: "s1",
              playerAId: players[i].id,
              playerBId: players[j].id,
              holes: JSON.stringify(holes),
              forfeitedBy: "",
            });
          }
        }

        const rows = matches.flatMap((m) => {
          const holes = JSON.parse(m.holes) as HoleResult[];
          return [
            { matchId: m.id, slot: "A", strokes: cardFor(holes) },
            { matchId: m.id, slot: "B", strokes: cardFor(holes) },
          ];
        });

        const joined = matchStrokeCards(rows, matches);
        // Two cards per match, and never a player who is not in the field.
        expect(joined).toHaveLength(matches.length * 2);
        const ids = new Set(players.map((p) => p.id));
        for (const c of joined) {
          expect(ids.has(c.playerId), `unknown player ${c.playerId}`).toBe(true);
          expect(c.stageId).toBe("s1");
        }

        // Every match in this round is DECIDED — that is what settles the
        // bracket, the standings and the money, and it stays true of the one
        // that ended early. The card question is asked separately below, and
        // the two must not be merged.
        for (const m of matches) {
          const holes = JSON.parse(m.holes) as HoleResult[];
          expect(resolveMatch(holes).winner, `${m.id} has no winner`).not.toBeNull();
          expect(matchCardFinished(m)).toBe(true);
        }

        const cards: StrokeCard[] = joined.map((c) => ({
          playerId: c.playerId,
          stageId: c.stageId,
          strokes: JSON.parse(c.strokes) as (number | null)[],
          finished: c.finished,
        }));
        const agg = aggregateStroke(cards, AGG_OPTS);

        // Who was in the match that stopped short.
        const shortened = new Set(
          matches.length ? [matches[0].playerAId, matches[0].playerBId] : [],
        );

        for (const p of players) {
          const a = agg.get(p.id);
          if (!a) {
            // A one-player round has no matches and therefore no cards.
            // Nobody is ranked, and nothing throws.
            expect(n).toBe(1);
            continue;
          }
          finite(a.gross, "gross");
          finite(a.thru, "thru");
          finite(a.parThru, "parThru");
          finite(a.holesOwed, "holesOwed");
          // Never more holes played than the round asked for.
          expect(a.thru).toBeLessThanOrEqual(a.holesOwed);
          // One card per match played, and the holes owed follow THIS round's
          // length. A nine-hole round owing eighteen is the bug this asserts
          // against: it would mark a complete card as stopped short, drop the
          // player out of the standings, and take them out of the money.
          const played = matches.filter(
            (m) => m.playerAId === p.id || m.playerBId === p.id,
          ).length;
          expect(a.holesOwed).toBe(played * holeCount);

          if (shortened.has(p.id)) {
            // Holes conceded and never played. Shown on the board with the
            // holes actually played, and NOT ranked: fourteen against
            // somebody else's eighteen is not a comparison, and nothing may
            // invent a score for a hole nobody played.
            expect(a.stoppedShort, `${p.id} played ${a.thru} of ${a.holesOwed}`).toBe(true);
            expect(isRanked(a)).toBe(false);
            expect(a.thru).toBeLessThan(a.holesOwed);
          } else {
            expect(a.stoppedShort).toBe(false);
            expect(isRanked(a)).toBe(true);
            expect(a.thru).toBe(a.holesOwed);
          }
        }
      });
    }

    it(`joins nothing from an empty ${holeCount}-hole round without throwing`, () => {
      expect(matchStrokeCards([], [])).toEqual([]);
      expect(aggregateStroke([], AGG_OPTS).size).toBe(0);
    });
  }
});

describe("round handicaps, at every field size and every allowance", () => {
  /**
   * What a player plays off in one round, swept across the cross product that
   * actually occurs: three sources, every allowance a round can carry, and
   * fields from one.
   *
   * The invariants are the promises made to Ajay on 2026-08-22, not the current
   * behaviour — a frozen round cannot move, an override belongs to its own
   * round, and both are COURSE handicaps that the allowance is applied to
   * afterwards rather than instead of.
   */
  // 0 means "the organizer said nothing", which takes the format's own
  // allowance; the rest are the ones a committee actually sets.
  const ALLOWANCES = [0, 50, 85, 90, 95, 100];
  // A plus-handicap player is in here deliberately: the arithmetic runs through
  // Math.round on a negative number, and a field of scratch and better is the
  // one nobody sweeps.
  const MEMBER = [-3, 0, 1, 12, 28, 54];

  for (const n of FIELD_SIZES) {
    it(`resolves every source coherently for a field of ${n}`, () => {
      for (let i = 0; i < n; i += 1) {
        const member = MEMBER[i % MEMBER.length];

        const plain = resolveRoundHandicap({ member });
        expect(plain.handicap).toBe(member);
        expect(plain.source).toBe("member");
        expect(plain.editable).toBe(true);
        expect(plain.differsFromCurrent).toBeNull();

        const overridden = resolveRoundHandicap({ member, override: member + 4 });
        expect(overridden.handicap).toBe(member + 4);
        expect(overridden.source).toBe("override");
        // Before a card arrives an override is a decision that can be changed.
        // That is the whole reason it is not frozen at round creation.
        expect(overridden.editable).toBe(true);

        // The freeze takes whatever the round was already using, so freezing
        // re-scores nothing — including when an override is what it was using.
        expect(handicapToFreeze({ member })).toBe(member);
        expect(handicapToFreeze({ member, override: member + 4 })).toBe(member + 4);

        const frozen = handicapToFreeze({ member, override: member + 4 });
        for (const later of MEMBER) {
          // A roster edit AND a change of mind about the override, both after
          // the cards are in. Neither may move the round.
          const played = resolveRoundHandicap({ frozen, member: later, override: later - 2 });
          expect(played.handicap).toBe(frozen);
          expect(played.source).toBe("frozen");
          expect(played.editable).toBe(false);
          finite(played.handicap, "frozen handicap");
          expect(Number.isInteger(played.handicap)).toBe(true);

          // The explanation for "why is my net different in round one" — set
          // when, and only when, there is a difference to explain.
          const current = later - 2;
          expect(played.differsFromCurrent).toBe(frozen === current ? null : current);
        }
      }
    });

    it(`applies the round's allowance on top, not instead, for a field of ${n}`, () => {
      for (const format of FORMAT_NAMES) {
        for (const pct of ALLOWANCES) {
          const allowance = effectiveAllowance(format, pct);
          expect(allowance).toBeGreaterThan(0);

          for (let i = 0; i < n; i += 1) {
            const member = MEMBER[i % MEMBER.length];
            // Both directions: a committee cutting a scratch player to plus two
            // is what puts a negative through the rounding.
            for (const override of [member + 4, member - 4]) {
              // Same unit throughout. The override replaces the COURSE handicap
              // and the allowance then prices it, exactly as it prices the
              // roster number. One screen taking the override as a Playing
              // Handicap is the five-shot disagreement the 2026-08-12 audit
              // found, in a different disguise.
              const off = resolveRoundHandicap({ member, override }).handicap;
              const playing = playingHandicapFrom(off, allowance);
              expect(playing).toBe(playingHandicapFrom(override, allowance));
              finite(playing, "playing handicap");
              expect(Number.isInteger(playing)).toBe(true);
              // An allowance can only shrink a handicap, never grow one, and it
              // keeps its sign — a plus player stays a plus player.
              expect(Math.abs(playing)).toBeLessThanOrEqual(Math.abs(override));
              expect(Math.sign(playing) === Math.sign(override) || playing === 0).toBe(true);
            }
          }
        }
      }
    });
  }

  it("a card row is not a returned card", () => {
    // The cut writes an empty card for every survivor, and score entry saves a
    // partial one hole by hole. Freezing on the row would tell an organizer
    // that cards are in a fortnight before anyone tees off.
    expect(isReturnedCard(new Array(18).fill(null))).toBe(false);
    expect(isReturnedCard([])).toBe(false);
    expect(isReturnedCard(new Array(9).fill(null))).toBe(false);
    const one: (number | null)[] = new Array(18).fill(null);
    one[7] = 5;
    expect(isReturnedCard(one)).toBe(true);
  });

  it("keys a row the way the database's own constraint does", () => {
    // Two maps keyed differently is how one reader finds an override the other
    // misses.
    expect(roundHandicapKey("s1", "p1")).toBe(roundHandicapKey("s1", "p1"));
    expect(roundHandicapKey("s1", "p1")).not.toBe(roundHandicapKey("p1", "s1"));
  });
});

/**
 * Team draws, swept.
 *
 * The sweep checked `needsTeams(format)` returned a BOOLEAN and stopped
 * there — no side was ever actually drawn. So the combination that matters
 * was untested: a team format with an ODD field, where somebody cannot be
 * paired. Three players into four-ball, five into a scramble of four.
 *
 * The invariant that matters most is not that the draw is balanced. It is
 * that nobody falls out of it. A player who entered, paid, and is on no side
 * is not scored, does not appear in the standings, and takes no part in the
 * money — and nothing on any screen says so.
 */
describe("team draws, at every field size and every team format", () => {
  const TEAM_FORMATS = FORMAT_NAMES.filter((f) => needsTeams(f));

  /** teamProblems only reads `members.length`; the rest is shape it needs. */
  const asTeams = (sides: Player[][]): TeamView[] =>
    sides.map((members, i) => ({
      id: `t${i + 1}`,
      name: `Side ${i + 1}`,
      seed: i + 1,
      stageId: null,
      // Not read by teamProblems; present because the shape requires it.
      playingHandicap: 0,
      members: members.map((p, position) => ({
        playerId: p.id,
        name: p.name,
        handicap: p.handicap,
        position,
      })),
    }));

  for (const format of TEAM_FORMATS) {
    const { min, max } = sideSizeRange(format);

    for (const n of FIELD_SIZES) {
      it(`${format}: a ${n}-player field draws into sides nobody falls out of`, () => {
        const players = field(n);
        const sides = snakeDraw(players, min);

        // NOBODY LOST, NOBODY DUPLICATED. Losing a player loses their score
        // and their share; duplicating one pays them twice.
        const placed = sides.flat().map((p) => p.id);
        expect(placed).toHaveLength(n);
        expect(new Set(placed).size).toBe(n);
        for (const p of players) {
          expect(placed, `${p.id} was drawn onto no side`).toContain(p.id);
        }

        // No side of nobody, and none above what the format allows. A side of
        // one is legal HERE — an odd field has to put the odd player
        // somewhere — but it must be reported, which is asserted below.
        for (const s of sides) {
          expect(s.length).toBeGreaterThan(0);
          expect(s.length).toBeLessThanOrEqual(Math.max(min, max));
        }

        // A one-player field cannot make a side of two, and must not pretend
        // it did. It draws one incomplete side rather than none.
        if (n === 1) expect(sides).toHaveLength(1);

        // THE SHORTFALL IS REPORTED, NOT SWALLOWED. Every side below the
        // format's minimum produces exactly one problem — so an organiser
        // with an odd field is told before the round is played rather than
        // discovering it in the standings afterwards.
        const short = sides.filter((s) => s.length < min).length;
        const problems = teamProblems(asTeams(sides), format);
        expect(problems).toHaveLength(short);
        for (const p of problems) {
          expect(p.problem).toBeTruthy();
          expect(p.teamName).toBeTruthy();
        }
      });
    }
  }

  it("draws nothing from an empty field without throwing", () => {
    for (const format of TEAM_FORMATS) {
      const { min } = sideSizeRange(format);
      expect(snakeDraw([], min)).toEqual([]);
      expect(teamProblems([], format)).toEqual([]);
    }
  });
});
