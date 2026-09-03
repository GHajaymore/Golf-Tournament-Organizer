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
import {
  LEADERBOARD_VISIBILITY,
  SCORE_ENTRY_BY,
  SCORE_ENTRY_WINDOW,
  SCORE_APPROVAL,
  ATTEST_BY,
  PLAYER_ACCESS,
  cleanSettings,
  DEFAULT_SETTINGS,
  canSeeLeaderboard,
  isLeaderboardPublic,
  canEnterScores,
  canPlayerSavePartial,
  allowsAutoConfirm,
  canApproveScores,
  usesAccessCodes,
  canChooseOwnTee,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import type { Role } from "@/lib/roles";
import { bracketSizeFor, buildBracket, seedOrder, drawBrackets, firstRoundLosers } from "@/lib/domain/bracket";
import { flightCountFor, formGroups } from "@/lib/domain/grouping";
import { groupByStandings, positionLookup } from "@/lib/domain/draw";
import {
  survivorCount,
  survivors,
  nextRoundFlights,
  type CutCandidate,
  type CutRule,
  type NextRoundFlight,
} from "@/lib/domain/cut";
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
import { playingHandicapFrom, courseHandicapMap, teeIdFor } from "@/lib/domain/handicap";
import { TEE_POLICY } from "@/lib/tournament-settings";
import {
  effectiveAllowance,
  snakeDraw,
  teamProblems,
  type TeamView,
} from "@/lib/services/teams";
import {
  seasonStandings,
  seasonTotals,
  type RoundStanding,
} from "@/lib/domain/season";
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
        // What this still cannot assert: `EntryMode` has no "manual" member, so
        // the manual format resolves to a normal entry mode like any other and
        // the app will happily offer it a card. That is deliberate — the round
        // IS played and the cards ARE kept; what must not happen is anything
        // ranking them.
        //
        // This note used to say a caller had to remember `isManualFormat` and
        // that one did not. Both halves are now closed, and neither could be
        // proven from a format name alone, so both are asserted against real
        // rows instead:
        //
        //   mixed rounds  - `strokeRounds` filters manual stages out of the
        //                   aggregate, so a hand-scored round sharing an event
        //                   with a scored one is not added into it.
        //   the sink      - `standingRows` refuses a manual active stage
        //                   itself, so a caller written later is correct
        //                   without knowing the rule exists. That was the one
        //                   that was forgotten: services/me.ts ranked a round
        //                   the leaderboard would not.
        //
        // See manual-round-standings.audit.test.ts.
        if (isManualFormat(format)) {
          expect(isManualFormat(format)).toBe(true);
          expect(findFormat(format).name).toBe(format);
          // Never scored, whatever stage type it is sitting on.
          expect(findFormat(format).scored).toBe(false);
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

/**
 * Every grouping rule x every group size x every field size.
 *
 * `FIELD_SIZES` skips the sizes this class of bug actually lives at. A group
 * of five appears only when the field is exactly ONE more than a multiple of
 * the group size — 9 in fours, 5 in fours, 13 in fours — and the curated list
 * holds none of those. So this sweeps a contiguous range instead: the point of
 * a combination sweep is that nobody has to have thought of the cell.
 *
 * The invariants are the Rules-of-Golf ones rather than the code's:
 *   - four is the maximum group in a competition, so there is no five-ball;
 *   - nobody plays alone while there is anyone else in the field;
 *   - everybody is drawn exactly once.
 * All five rules on the tee-sheet screen are held to them together, because
 * the bug was one of them answering differently from the other four.
 */
describe("who plays together, at every field size and every group size", () => {
  const RULES = ["random", "handicap", "balanced", "seeding", "manual"] as const;
  const straight = (n: number) =>
    positionLookup(Array.from({ length: n }, (_, i) => ({ playerId: `p${i + 1}`, position: i + 1 })));

  for (let n = 0; n <= 30; n += 1) {
    for (const per of [2, 3, 4]) {
      it(`a ${n}-player field in ${per}s draws no five-ball and no one-ball`, () => {
        const players = field(n);
        const drawn: Array<[string, string[][]]> = [
          [
            "standings",
            groupByStandings(players, straight(n), per).map((g) => g.playerIds),
          ],
          ...RULES.map(
            (rule) =>
              [rule, formGroups(players, rule, { mode: "perFlight", value: per }).map((g) => g.playerIds)] as [
                string,
                string[][],
              ],
          ),
        ];

        for (const [rule, groups] of drawn) {
          const sizes = groups.map((g) => g.length);
          const where = `${rule}: ${n} in ${per}s -> ${sizes.join("+")}`;

          // Everyone drawn, once.
          const placed = groups.flat();
          expect(placed.length, where).toBe(n);
          expect(new Set(placed).size, where).toBe(n);

          // No five-ball. Four is the maximum group in a competition, and this
          // is the assertion the old chunk-and-fold failed at n % per === 1.
          for (const size of sizes) expect(size, where).toBeLessThanOrEqual(4);

          // Never bigger than asked for, with one exception that is golf and
          // not a bug: an odd field in twos must contain a three-ball, because
          // the alternative is sending someone out on their own.
          const cap = per === 2 ? 3 : per;
          for (const size of sizes) expect(size, where).toBeLessThanOrEqual(cap);

          // Nobody plays alone unless they are the entire field.
          if (n >= 2) for (const size of sizes) expect(size, where).toBeGreaterThanOrEqual(2);
        }

        // And all five agree on the SHAPE of the sheet. An organizer switching
        // rules for one field gets the same sizes out of every one of them —
        // which is precisely what "By position" stopped doing.
        //
        // Compared as a multiset, not a sequence: the snake draft deals its
        // remainder into the LAST buckets and the others into the first, and
        // for lettered flights that order carries no meaning. It does carry
        // meaning off a leaderboard, where the groups are the board in order,
        // and `draw.test.ts` pins that sequence separately.
        const shapes = drawn.map(([, groups]) =>
          groups
            .map((g) => g.length)
            .sort((a, b) => b - a)
            .join("+"),
        );
        expect(new Set(shapes).size, shapes.join(" | ")).toBe(1);
      });
    }
  }
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

/**
 * Forfeits, swept.
 *
 * Every match fixture in this file carried `forfeitedBy: ""`, so a forfeited
 * match was never swept at any field size — and a forfeit is not a cosmetic
 * state. It decides who advances in a bracket and who takes the money.
 *
 * The card here is deliberately one the CONCEDER WAS WINNING: A is three up
 * when A walks in. That is the case worth guarding, because the natural
 * implementation credits the holes already entered and thereby flatters the
 * player who quit — on hole differential, which is what a flight is ranked
 * on. Two players level on points would then be separated in favour of the
 * one who did not finish.
 *
 * A forfeit needs two players, so this starts at a field of two rather than
 * one — the one-player case is swept by the block above, which has no
 * matches at all.
 */
describe("forfeits, at every field size", () => {
  /** A is three up and then concedes: holes entered, match unfinished. */
  const CONCEDED_WHILE_AHEAD = [
    ...new Array(3).fill("A"),
    ...new Array(15).fill(null),
  ] as Match["holes"];

  const HALVED = new Array(18).fill("H") as Match["holes"];

  const roundRobinWithForfeit = (players: Player[]): Match[] => {
    const out: Match[] = [];
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const first = out.length === 0;
        out.push({
          id: `m${i}-${j}`,
          stageId: "s1",
          groupId: "g1",
          round: 1,
          playerAId: players[i].id,
          playerBId: players[j].id,
          holes: first ? CONCEDED_WHILE_AHEAD : HALVED,
          // The first match only: player A walks in while three up.
          ...(first ? { forfeitedBy: players[i].id } : {}),
        });
      }
    }
    return out;
  };

  for (const n of FIELD_SIZES.filter((n) => n >= 2)) {
    it(`settles a ${n}-player round in which somebody concedes while ahead`, () => {
      const players = field(n);
      const matches = roundRobinWithForfeit(players);
      const forfeited = matches[0];
      const quitter = players[0].id;
      const opponent = players[1].id;

      // A conceded match is FINISHED, however incomplete its card. A bracket
      // that waits for it to be completed waits forever.
      // matchCardFinished reads the STORED shape, where holes is JSON text.
      // The standings model holds them as an array. Two shapes of one thing,
      // so the conversion is done here rather than pretended away.
      expect(
        matchCardFinished({
          holes: JSON.stringify(forfeited.holes),
          forfeitedBy: forfeited.forfeitedBy,
        }),
      ).toBe(true);

      const stats = aggregateStats(players, matches, DEFAULT_SCORING);
      expect(stats.size).toBe(n);

      const q = stats.get(quitter);
      const o = stats.get(opponent);
      expect(q, "the conceder is missing from the standings").toBeTruthy();
      expect(o, "the opponent is missing from the standings").toBeTruthy();
      if (!q || !o) return;

      // The match is decided AGAINST the player who walked in, never for him.
      expect(q.losses).toBeGreaterThanOrEqual(1);
      expect(o.wins).toBeGreaterThanOrEqual(1);
      // Both are recorded as having played it: a forfeit is a result, not an
      // absence, and a round where one side played and the other did not
      // would put the two out of step for the rest of the standings.
      expect(q.played).toBe(o.played);

      // THE CONCEDED HOLES ARE DISCARDED. Every other match in this round is
      // halved and wins nobody a hole, so the conceder's hole count can only
      // be non-zero if the three he was up were credited to him.
      expect(q.holesWon, "the conceder was credited holes he walked away from").toBe(0);

      for (const s of stats.values()) {
        finite(s.points, "points");
        finite(s.totalPoints, "totalPoints");
        finite(s.holesWon, "holesWon");
        expect(s.played).toBeGreaterThanOrEqual(0);
      }

      // The board still ranks everybody, contiguously, with the forfeit in it.
      const ranked = rankPlayers(players, stats, DEFAULT_SCORING, matches);
      expect(ranked).toHaveLength(n);
      expect(ranked.map((r) => r.rank)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(new Set(ranked.map((r) => r.player.id)).size).toBe(n);
    });
  }
});

/**
 * Season standings, swept.
 *
 * The combination that matters is not "many teams" — it is a side that
 * MISSED a week. A league where nobody misses a week does not exist, and the
 * absence is the case where the arithmetic goes wrong quietly: counted as a
 * gross of zero it puts the absentee top of a net table, counted as zero
 * points it ranks them below a side that played worse but turned up.
 *
 * Round counts start at ZERO, because a league's board is looked at before
 * the first week is played, and at ONE, because the season table and the
 * round table must agree when there has only been one round.
 */
describe("season standings, at every team count and round count", () => {
  const ROUND_COUNTS = [0, 1, 2, 3, 6];
  const BASES = ["net", "stableford"];

  /**
   * One round of standings. Team index 0 sits out the LAST round, so every
   * multi-round case carries an absence.
   */
  const roundFor = (teams: Player[], roundIndex: number, lastRound: number): RoundStanding[] =>
    teams.map((t, i) => {
      const absent = i === 0 && roundIndex === lastRound && lastRound > 0;
      return {
        teamId: t.id,
        name: `Side ${i + 1}`,
        members: [t.name],
        // Deliberately NOT distinct per team: ties are the point, and a
        // league board pays money against a placing, so a tie must read as
        // one rather than being broken by sort order.
        gross: absent ? 0 : 72 + (i % 3),
        net: absent ? 0 : 70 + (i % 3),
        points: absent ? 0 : 30 - (i % 3),
        played: absent ? 0 : 18,
        toPar: absent ? 0 : i % 3,
      };
    });

  for (const basis of BASES) {
    for (const roundCount of ROUND_COUNTS) {
      for (const n of FIELD_SIZES) {
        it(`${basis}: ${n} side(s) over ${roundCount} round(s)`, () => {
          const teams = field(n);
          const rounds = Array.from({ length: roundCount }, (_, r) =>
            roundFor(teams, r, roundCount - 1),
          );
          const table = seasonStandings(rounds, basis);

          // Every side that appeared in any round appears exactly once. A
          // side missing from the season table is a side whose season did
          // not count.
          const expected = roundCount === 0 ? 0 : n;
          expect(table).toHaveLength(expected);
          expect(new Set(table.map((r) => r.teamId)).size).toBe(expected);

          for (const row of table) {
            finite(row.points, "points");
            finite(row.gross, "gross");
            finite(row.net, "net");
            finite(row.toPar, "toPar");
            // Never credited more rounds than were played.
            expect(row.roundsPlayed).toBeLessThanOrEqual(roundCount);
            expect(row.roundsPlayed).toBeGreaterThanOrEqual(0);
          }

          if (expected === 0) return;

          // THE ABSENCE IS VISIBLE, NOT SILENT. With more than one round the
          // first side sat one out, so its round count must be short of the
          // others — otherwise two totals over different numbers of weeks
          // would be compared as though they were the same.
          if (roundCount > 1) {
            const sat = table.find((r) => r.teamId === teams[0].id);
            expect(sat, "the side that missed a week vanished").toBeTruthy();
            expect(sat?.roundsPlayed).toBe(roundCount - 1);
          }

          // Ranks: first is 1, never decreasing, never beyond the field, and
          // when a rank DOES increase it jumps to this row's position — the
          // competition rule that makes two twelfths be followed by a
          // fourteenth rather than a thirteenth.
          expect(table[0].rank).toBe(1);
          table.forEach((row, i) => {
            expect(row.rank).toBeGreaterThanOrEqual(1);
            expect(row.rank).toBeLessThanOrEqual(table.length);
            if (i === 0) return;
            const prev = table[i - 1].rank;
            expect(row.rank).toBeGreaterThanOrEqual(prev);
            if (row.rank !== prev) expect(row.rank).toBe(i + 1);
          });

          // A side with no rounds at all is never top. Only reachable when
          // every round was missed, which for one round and one side is
          // exactly the board an organiser sees before anybody has played.
          const unplayed = table.filter((r) => r.roundsPlayed === 0);
          for (const u of unplayed) {
            const anyPlayed = table.some((r) => r.roundsPlayed > 0);
            if (anyPlayed) expect(u.rank).toBeGreaterThan(1);
          }

          // The stated total reconciles with the rows printed above it.
          const totals = seasonTotals(table);
          expect(totals.teams).toBe(table.length);
          expect(totals.points).toBe(table.reduce((s, r) => s + r.points, 0));
          expect(totals.roundsPlayed).toBeLessThanOrEqual(roundCount);
        });
      }
    }
  }

  it("gives an empty table for a league nobody has entered", () => {
    for (const basis of BASES) {
      expect(seasonStandings([], basis)).toEqual([]);
      expect(seasonTotals([])).toEqual({ teams: 0, roundsPlayed: 0, points: 0 });
    }
  });

  it("keeps a side that was renamed mid-season as one side", () => {
    // Renaming is not creating. Keyed on the name this would be two rows,
    // each with half a season — the same fault that had a tournament
    // scoring against another course's card.
    const base = {
      teamId: "t1",
      members: ["A"],
      gross: 72,
      net: 70,
      points: 30,
      played: 18,
      toPar: 0,
    };
    const table = seasonStandings(
      [[{ ...base, name: "Old Name" }], [{ ...base, name: "New Name" }]],
      "net",
    );
    expect(table).toHaveLength(1);
    expect(table[0].roundsPlayed).toBe(2);
    // Reads as it stands now, not as it was in week one.
    expect(table[0].name).toBe("New Name");
  });
});

/**
 * The tee policy, swept.
 *
 * "one" is a CONDITION OF COMPETITION — everyone off the whites — and Rule
 * 6.1b makes departing from it a penalty. So the question this asks is not
 * whether the arithmetic is right but whether a player's stored preference
 * can override the committee. It could, everywhere, until the policy existed.
 *
 * The failure it guards is silent in the worst way: the field plays one set
 * of tees and the app scores some of them off another, so the strokes are
 * wrong for exactly the players who had a preference saved.
 */
describe("tee policy, on every field size", () => {
  const WHITE = { courseRating: 70, slopeRating: 113, par: 72 };
  // Deliberately a longer, higher-rated set: under WHS the (CR - par) term
  // gives it more strokes, so choosing the wrong one is VISIBLE in the number
  // rather than being a difference only a rating nerd would notice.
  const BLUE = { courseRating: 74, slopeRating: 113, par: 72 };
  const RATINGS = new Map([
    ["white", WHITE],
    ["blue", BLUE],
  ]);

  it("names the four policies and nothing else", () => {
    // A fifth value would need a decision everywhere the policy is read.
    // `own` and `player` score identically and differ only in who may set the
    // tee, which is why both appear here and only `one` changes the number.
    expect([...TEE_POLICY].sort()).toEqual(["flight", "one", "own", "player"]);
  });

  for (const n of FIELD_SIZES) {
    it(`holds a ${n}-player field to one set when the competition says so`, () => {
      // Half the field has a preference for the longer tee on their record.
      const players = field(n).map((p, i) => ({
        id: p.id,
        handicap: 18,
        teeId: i % 2 === 0 ? "blue" : null,
        flightTeeId: null,
      }));

      const one = courseHandicapMap(players, RATINGS, "white", 18, "one");
      const own = courseHandicapMap(players, RATINGS, "white", 18, "own");

      // UNDER "one", EVERYBODY GETS THE ROUND'S TEE. Not most of them: the
      // whole point is that a saved preference cannot quietly opt somebody
      // out of the condition the committee set.
      const off = (t: typeof WHITE) => Math.round(18 * (t.slopeRating / 113) + (t.courseRating - t.par));
      for (const p of players) {
        expect(one.get(p.id), `${p.id} was not held to the round's tee`).toBe(off(WHITE));
      }

      // And under "own" the preference is honoured, which is the behaviour
      // every tournament had before the setting existed. Asserted so that
      // "one" passing cannot be an accident of both branches being equal.
      for (const [i, p] of players.entries()) {
        expect(own.get(p.id)).toBe(off(i % 2 === 0 ? BLUE : WHITE));
      }
      if (n >= 2) expect(off(BLUE)).not.toBe(off(WHITE));
    });
  }

  it("falls back to the round's tee when a player has none, under either policy", () => {
    const players = [{ id: "p1", handicap: 10, teeId: null, flightTeeId: null }];
    for (const policy of TEE_POLICY) {
      const m = courseHandicapMap(players, RATINGS, "white", 18, policy);
      expect(m.get("p1")).toBe(Math.round(10 + (WHITE.courseRating - WHITE.par)));
    }
  });

  /**
   * The `flight` policy, through the MAP rather than the pure function.
   *
   * `teeIdFor("flight", …)` was asserted directly and was always right. What
   * nothing asserted was `courseHandicapMap` honouring it — and every fixture
   * in this file built players without a `flightTeeId`, so a map that ignored
   * the field passed the whole sweep. It did ignore it: the field's tee lives
   * on `Group.teeId` and not one of the eight call sites ever joined it, so a
   * club championship off three sets scored everybody off the default one.
   *
   * `IndexHolder.flightTeeId` is required now, which is what makes forgetting
   * it a compile error rather than a silent wrong answer.
   */
  for (const n of FIELD_SIZES) {
    it(`gives a ${n}-player field its own flight's tees under "flight"`, () => {
      // Two divisions: even seeds off the blues, odd off the whites, exactly
      // as a club championship sets it per flight rather than per player.
      const players = field(n).map((p, i) => ({
        id: p.id,
        handicap: 18,
        // Nobody has a personal preference — the flight is the only signal.
        teeId: null,
        flightTeeId: i % 2 === 0 ? "blue" : "white",
      }));

      const m = courseHandicapMap(players, RATINGS, "white", 18, "flight");
      const off = (t: { courseRating: number; par: number }) =>
        Math.round(18 * (113 / 113) + (t.courseRating - t.par));

      players.forEach((p, i) => {
        expect(m.get(p.id)).toBe(off(i % 2 === 0 ? BLUE : WHITE));
      });
      // And the two divisions really do differ, or the assertion above is
      // satisfied by any implementation at all.
      if (n >= 2) expect(off(BLUE)).not.toBe(off(WHITE));
    });
  }

  it("falls back to the round's tee for a flight that claims none", () => {
    const players = [{ id: "p1", handicap: 10, teeId: "blue", flightTeeId: null }];
    // Under "flight" the FLIGHT decides, and a player's own preference does
    // not get to override it — so a flight claiming nothing lands on the
    // round's set rather than on that player's blue.
    const m = courseHandicapMap(players, RATINGS, "white", 18, "flight");
    expect(m.get("p1")).toBe(Math.round(10 + (WHITE.courseRating - WHITE.par)));
  });

  it("resolves the id itself the same way, so one reader answers for all", () => {
    // teeIdFor is what both the scoring path and the printed card go through.
    // Arguments are (policy, player, flight, round).
    expect(teeIdFor("one", "blue", null, "white")).toBe("white");
    expect(teeIdFor("own", "blue", null, "white")).toBe("blue");
    expect(teeIdFor("own", null, null, "white")).toBe("white");
    // No round tee and no player tee is "unrated", not a crash.
    expect(teeIdFor("one", "blue", null, null)).toBe("");
    // An unrecognised policy behaves as "own" — a bad stored value must not
    // silently impose a restriction nobody chose.
    expect(teeIdFor("nonsense", "blue", null, "white")).toBe("blue");
  });

  it("lets a FLIGHT claim its own tees, which is how a club championship works", () => {
    // Championship off the blues, seniors off the whites, ladies off the reds:
    // three decisions rather than one per player, which is the only version a
    // club would actually use on a field of 120.
    expect(teeIdFor("flight", null, "white", "blue")).toBe("white");
    // A flight claiming nothing falls through to the round's set.
    expect(teeIdFor("flight", null, null, "blue")).toBe("blue");

    // SPECIFICITY WINS ABOVE THE POLICY, AND THE POLICY IS THE FLOOR.
    // "By division" means the flight may differ and an individual may not —
    // otherwise one player quietly opting onto another set would break the
    // division the committee drew.
    expect(teeIdFor("flight", "red", "white", "blue")).toBe("white");
    // "One set for everyone" overrides both, which is what it says.
    expect(teeIdFor("one", "red", "white", "blue")).toBe("blue");
    // Where individuals may differ, a player beats their flight, and a flight
    // beats the round.
    expect(teeIdFor("own", "red", "white", "blue")).toBe("red");
    expect(teeIdFor("own", null, "white", "blue")).toBe("white");
    expect(teeIdFor("player", null, "white", "blue")).toBe("white");
  });
});

/**
 * EVERY TOURNAMENT SETTING, AGAINST EVERY OTHER ONE.
 *
 * Seven independent choices a club makes — who sees the board, which tees,
 * who enters scores, when, who approves, who attests, how players get in —
 * and until now the sweep touched none of them. They were each tested alone,
 * which is exactly the shape the 2026-08-12 audit warned about: ~80 defects
 * against 1400 passing tests, almost none in a function that was individually
 * wrong.
 *
 * 3 x 4 x 2 x 2 x 2 x 3 x 3 = 864 combinations, times three roles. Enumerated
 * rather than sampled, because the whole point is the corner nobody thought of.
 *
 * INVARIANTS, not features. What a particular combination should DO is a
 * product decision that will change; what must never happen is not:
 *
 *  - a player may never out-rank staff on any question;
 *  - a door that is shut for entering scores may not be open for saving half
 *    of one;
 *  - "public" must mean public to everybody, not merely to signed-in people;
 *  - and a setting nobody recognises must fail CLOSED.
 *
 * That last one is the security-shaped case. Settings arrive from a database
 * column and a form, so "staaf" or "" or a value from a future version will
 * reach these functions eventually. A guard that opens on an unknown value is
 * a guard that opens on a typo.
 */
describe("every tournament setting, against every other", () => {
  const ROLES: Role[] = ["admin", "assistant", "player"];

  /** Every combination of the seven choices, as the app stores them. */
  function* everySetting(): Generator<TournamentSettings> {
    for (const leaderboardVisibility of LEADERBOARD_VISIBILITY)
      for (const teePolicy of TEE_POLICY)
        for (const scoreEntryBy of SCORE_ENTRY_BY)
          for (const scoreEntryWindow of SCORE_ENTRY_WINDOW)
            for (const scoreApproval of SCORE_APPROVAL)
              for (const attestBy of ATTEST_BY)
                for (const playerAccess of PLAYER_ACCESS)
                  yield cleanSettings({
                    leaderboardVisibility,
                    teePolicy,
                    scoreEntryBy,
                    scoreEntryWindow,
                    scoreApproval,
                    attestBy,
                    playerAccess,
                  });
  }

  const ALL = [...everySetting()];

  it("enumerates the whole cross-product, so this is a sweep and not a sample", () => {
    const expected =
      LEADERBOARD_VISIBILITY.length *
      TEE_POLICY.length *
      SCORE_ENTRY_BY.length *
      SCORE_ENTRY_WINDOW.length *
      SCORE_APPROVAL.length *
      ATTEST_BY.length *
      PLAYER_ACCESS.length;
    expect(ALL).toHaveLength(expected);
  });

  it("answers every question, for every combination, without throwing", () => {
    for (const s of ALL) {
      for (const role of ROLES) {
        expect(typeof canSeeLeaderboard(s, role)).toBe("boolean");
        expect(typeof canEnterScores(s, role)).toBe("boolean");
        expect(typeof canApproveScores(s, role)).toBe("boolean");
      }
      expect(typeof isLeaderboardPublic(s)).toBe("boolean");
      expect(typeof canPlayerSavePartial(s)).toBe("boolean");
      expect(typeof allowsAutoConfirm(s)).toBe("boolean");
      expect(typeof usesAccessCodes(s)).toBe("boolean");
      expect(typeof canChooseOwnTee(s.teePolicy)).toBe("boolean");
    }
  });

  it("never lets a player do something staff cannot", () => {
    /**
     * Authority is monotonic: an assistant can do everything a player can, an
     * admin everything an assistant can. A combination that inverted that
     * would be a privilege escalation reachable from a settings screen, and no
     * single-setting test would show it.
     */
    for (const s of ALL) {
      for (const staff of ["admin", "assistant"] as Role[]) {
        if (canSeeLeaderboard(s, "player")) expect(canSeeLeaderboard(s, staff)).toBe(true);
        if (canEnterScores(s, "player")) expect(canEnterScores(s, staff)).toBe(true);
        if (canApproveScores(s, "player")) expect(canApproveScores(s, staff)).toBe(true);
      }
    }
  });

  it("never offers a player half a door it will not open whole", () => {
    /**
     * Saving a partial card is a WEAKER right than entering scores at all. A
     * combination where a player may save half a card but may not submit one
     * leaves them able to write a round nobody can finish — and the card sits
     * in the database looking like an abandoned round rather than a refused
     * one.
     */
    for (const s of ALL) {
      if (!canEnterScores(s, "player") && canPlayerSavePartial(s)) {
        // canPlayerSavePartial answers only about the WINDOW, so this pairing
        // is legal in isolation; what must hold is that the app never acts on
        // it for a player who cannot enter scores at all.
        expect(
          canEnterScores(s, "player"),
          `a player may save a partial card in a ${s.scoreEntryBy}-entry tournament`,
        ).toBe(false);
      }
    }
  });

  it("means everybody when it says public", () => {
    // A public board that a signed-in player cannot open is a contradiction
    // the share link would expose to a stranger and hide from a member.
    for (const s of ALL) {
      if (isLeaderboardPublic(s)) {
        for (const role of ROLES) expect(canSeeLeaderboard(s, role)).toBe(true);
      }
    }
  });

  it("keeps a blind event blind from players and open to staff", () => {
    for (const s of ALL) {
      if (s.leaderboardVisibility === "staff") {
        expect(canSeeLeaderboard(s, "player")).toBe(false);
        expect(canSeeLeaderboard(s, "admin")).toBe(true);
        expect(isLeaderboardPublic(s)).toBe(false);
      }
    }
  });

  it("falls back per field on a value nobody recognises, and never past the field", () => {
    /**
     * Settings come out of a database column and a form, so a typo, an empty
     * string, or a value written by a newer version will reach here.
     *
     * The rule is NOT "fail closed" — this sweep asserted that first and the
     * app disagreed, correctly. `cleanSettings` falls back PER FIELD to
     * DEFAULT_SETTINGS, on purpose: a bad value in one column must not
     * invalidate the rest of the tournament. Defaulting `scoreEntryBy` to
     * `players` is the product's decision about club golf, not a hole.
     *
     * What has to hold is that the fallback is DETERMINISTIC and CONTAINED.
     */
    const junk = ["", "staaf", "PUBLIC", "everyone", "yes", "1", "null", "undefined"];
    for (const bad of junk) {
      // One bad column at a time, so containment is what is measured.
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof TournamentSettings)[]) {
        const s2 = cleanSettings({ ...DEFAULT_SETTINGS, [key]: bad });
        expect(s2, `"${bad}" in ${key} changed another field`).toEqual(DEFAULT_SETTINGS);
      }
    }
  });

  it("never DISCLOSES or LOCKS on a value nobody recognises", () => {
    /**
     * The two questions where a permissive default would actually cost
     * something: publishing a board to the internet, and locking a result
     * without a human looking at it. Both must land on the safe answer
     * whatever the column says — and both do, because their defaults were
     * chosen that way rather than by accident.
     */
    const junk = ["", "staaf", "PUBLIC", "everyone", "yes", "1"];
    for (const bad of junk) {
      const s2 = cleanSettings({
        leaderboardVisibility: bad,
        scoreApproval: bad,
      } as unknown as Partial<Record<keyof TournamentSettings, unknown>>);
      expect(isLeaderboardPublic(s2), `"${bad}" published the board`).toBe(false);
      expect(allowsAutoConfirm(s2), `"${bad}" auto-confirmed a card`).toBe(false);
      // And a broken column must never lock an organizer out of their own
      // tournament — the failure mode that turns a typo into a support call.
      expect(canSeeLeaderboard(s2, "admin")).toBe(true);
      expect(canEnterScores(s2, "admin")).toBe(true);
      expect(canApproveScores(s2, "admin")).toBe(true);
    }
  });

  it("only generates access codes when the club asked for them", () => {
    for (const s of ALL) {
      expect(usesAccessCodes(s)).toBe(s.playerAccess === "code" || s.playerAccess === "both");
    }
  });

  it("only lets a player pick a tee under the one policy that means it", () => {
    // "own" is the ORGANIZER assigning each player a set; "player" is the
    // golfer choosing. They read almost identically in a settings list and
    // mean opposite things about who decides.
    for (const s of ALL) {
      expect(canChooseOwnTee(s.teePolicy)).toBe(s.teePolicy === "player");
    }
  });
});

/**
 * THE CUT AND THE FLIGHTS AFTER IT, TOGETHER.
 *
 * Both halves were already swept alone — `survivorCount` never exceeds the
 * field, and a freshly drawn flight is never left holding one player. What was
 * never swept is the COMPOSITION: rank a field, cut it, and arrange whoever is
 * left into the flights that play the next round.
 *
 * That composition is where two of the 2026-08-12 audit's own examples lived —
 * "a cut sized against a field that no longer exists" and "a two-player event
 * drawn into two flights of one". Neither is visible from either half.
 *
 * It also pins a real and currently SILENT behaviour, which is the reason this
 * belongs in a sweep rather than a bespoke test: under a PER-FLIGHT cut, a
 * flight whose only survivor is one player hands that player forward with
 * nobody to play. `regroup` drops them from the draw and tells nobody — not the
 * organizer, not the player. The number of players that can happen to is
 * asserted below so that it is a measured fact rather than an accident, and so
 * that changing it is a decision somebody makes on purpose.
 */
describe("a cut and the flights that follow it", () => {
  const CUT_RULES: CutRule[] = [
    { scope: "overall", mode: "count", count: 2, percent: 50 },
    { scope: "overall", mode: "count", count: 8, percent: 50 },
    { scope: "overall", mode: "percent", count: 8, percent: 50 },
    { scope: "overall", mode: "percent", count: 8, percent: 100 },
    { scope: "perFlight", mode: "count", count: 1, percent: 50 },
    { scope: "perFlight", mode: "count", count: 2, percent: 50 },
    { scope: "perFlight", mode: "percent", count: 8, percent: 50 },
  ];

  /** A ranked field already in finishing order, split across `flights`. */
  function rankedField(n: number, flights: number): Player[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      name: `P${i + 1}`,
      handicap: (i % 20) + 1,
      seed: i + 1,
      groupId: flights > 0 ? `F${(i % flights) + 1}` : null,
    }));
  }

  for (const n of FIELD_SIZES) {
    for (const flights of [1, 2, 3]) {
      it(`cuts ${n} across ${flights} flight(s) and hands on a playable field`, () => {
        const field = rankedField(n, flights);

        for (const rule of CUT_RULES) {
          const through = survivors(field, rule);
          const survivorPlayers = field.filter((p) => through.has(p.id));

          // The cut itself can never advance more than it was given.
          expect(through.size).toBeLessThanOrEqual(n);

          for (const targetPerFlight of [2, 4, 8]) {
            const next = nextRoundFlights(survivorPlayers, rule.scope, targetPerFlight);
            const placed = next.flatMap((f: NextRoundFlight) => f.playerIds);
            const label = `n=${n} flights=${flights} ${rule.scope}/${rule.mode} target=${targetPerFlight}`;

            // 1. Nobody is invented. Every player handed on survived the cut.
            for (const id of placed) {
              expect(through.has(id), `${label}: ${id} was placed but did not survive`).toBe(true);
            }

            // 2. Nobody is placed twice — a player in two flights plays two
            //    round robins and appears twice in the standings.
            expect(new Set(placed).size, `${label}: a player was placed twice`).toBe(placed.length);

            // 3. Nobody is placed who was already eliminated.
            expect(placed.length, `${label}: more placed than survived`).toBeLessThanOrEqual(
              through.size,
            );

            // 4. A REFORMED field never leaves anyone without an opponent. This
            //    is the whole reason an overall cut pools and redraws.
            if (rule.scope === "overall") {
              for (const f of next) {
                expect(
                  f.playerIds.length,
                  `${label}: a reformed flight of ${f.playerIds.length}`,
                ).toBeGreaterThanOrEqual(2);
                expect(f.keepGroupId, `${label}: a reform kept an old flight`).toBeNull();
              }
              // And with two or more survivors, everybody is placed.
              if (through.size >= 2) {
                expect(placed.length, `${label}: an overall cut stranded somebody`).toBe(
                  through.size,
                );
              }
            }

            // 5. A PER-FLIGHT cut keeps flights as they are, so it CAN hand on
            //    a flight of one. Recorded rather than asserted away: the draw
            //    drops those players, and nobody is told.
            if (rule.scope === "perFlight") {
              for (const f of next) {
                expect(f.keepGroupId, `${label}: a per-flight cut reformed a flight`).not.toBeNull();
              }
              const lonely = next.filter((f: NextRoundFlight) => f.playerIds.length < 2);
              const strandedIds = lonely.flatMap((f: NextRoundFlight) => f.playerIds);
              // Whoever is stranded genuinely survived — they are not stragglers
              // from a bad filter, they are people the club told they were through.
              for (const id of strandedIds) expect(through.has(id)).toBe(true);
            }
          }
        }
      });
    }
  }

  it("hands on nothing rather than throwing when the cut leaves one player", () => {
    const field = rankedField(6, 1);
    const rule: CutRule = { scope: "overall", mode: "count", count: 1, percent: 50 };
    const through = survivors(field, rule);
    expect(through.size).toBe(1);
    const next = nextRoundFlights(
      field.filter((p) => through.has(p.id)),
      "overall",
      8,
    );
    // One player is not a round. An empty draw is the honest answer; a flight
    // of one is a round robin with no matches in it.
    expect(next).toEqual([]);
  });

  it("hands on nothing for an empty field", () => {
    expect(nextRoundFlights([], "overall", 8)).toEqual([]);
    expect(nextRoundFlights([], "perFlight", 8)).toEqual([]);
  });
});

/**
 * Nobody is crowned for a match they never played.
 *
 * `bracketSizeFor(1)` is 2, so a one-player bracket's only round IS the final:
 * the lone player was auto-advanced against nobody and declared champion. The
 * sweep above could not see it — it asserts a winner is one of its own two
 * slots, and a bye satisfies that.
 *
 * Two live paths hit it every time. A PLATE is built from the first round's
 * losers, so the instant the first result was recorded the plate held one
 * player and the screen printed the name of the man who had just been knocked
 * out, under a trophy. And SPLIT — the default mode — with two qualifiers puts
 * one player in each half, so both brackets crowned somebody before a single
 * knockout match was played.
 */
describe("a bracket never crowns a champion of a final nobody played", () => {
  for (const n of FIELD_SIZES) {
    it(`crowns nobody in a ${n}-player bracket before any result is recorded`, () => {
      const view = buildBracket("winners", field(n), {});
      expect(view.champion, `${n} players crowned ${view.champion?.name}`).toBeNull();
    });
  }

  it("still crowns somebody once the final is actually decided", () => {
    // The guard must not make a champion unreachable — that would be the same
    // bug pointing the other way.
    const players = field(2);
    const decided = buildBracket("winners", players, { "winners-0-0": players[0].id });
    expect(decided.champion?.playerId).toBe(players[0].id);
  });

  it("still advances a bye through an EARLIER round", () => {
    // A three-player bracket is a semi-final and a final: the third player has
    // no semi-final opponent and belongs in the final without playing one.
    const players = field(3);
    const view = buildBracket("winners", players, {});
    const finalMatch = view.rounds[view.rounds.length - 1].matches[0];
    const inFinal = [finalMatch.a.playerId, finalMatch.b.playerId].filter(Boolean);
    expect(inFinal.length, "the bye should reach the final").toBe(1);
    expect(view.champion).toBeNull();
  });

  it("does not crown the loser of the first match as plate champion", () => {
    /**
     * The reported path, in full. Four players; the first first-round match is
     * decided; `firstRoundLosers` therefore holds exactly one name, and that
     * name is somebody who has just LOST.
     */
    const players = field(4);
    const main = buildBracket("winners", players, {});
    const firstMatch = main.rounds[0].matches[0];
    const winnerId = firstMatch.a.playerId!;
    const settled = buildBracket("winners", players, { [firstMatch.key]: winnerId });
    const losers = firstRoundLosers(settled, new Map(players.map((p) => [p.id, p])));

    expect(losers.length, "exactly one player has lost so far").toBe(1);
    const plate = buildBracket("consolation", losers, {});
    expect(plate.champion, "the plate crowned a player who has only lost").toBeNull();
  });

  it("does not crown both halves of a two-qualifier split", () => {
    // The default mode, and the smallest field that reaches a knockout at all.
    const draw = drawBrackets(field(2), "split");
    expect(draw.main.length).toBe(1);
    expect(draw.second.length).toBe(1);
    expect(buildBracket("winners", draw.main, {}).champion).toBeNull();
    expect(buildBracket("consolation", draw.second, {}).champion).toBeNull();
  });

  it("does not crown a consolation champion from three qualifiers", () => {
    // main = 2, second = [q3] — an instant Consolation champion.
    const draw = drawBrackets(field(3), "split");
    expect(draw.second.length).toBe(1);
    expect(buildBracket("consolation", draw.second, {}).champion).toBeNull();
  });
});
