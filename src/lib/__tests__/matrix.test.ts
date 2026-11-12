import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamStandingsTable } from "@/components/TeamLeaderboard";
import { tournamentTerms } from "@/lib/rules";
import { recommendedAllowance, parStrokesApply, playingHandicapInRound } from "@/lib/round-allowance";
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
  isStrokeScored,
  needsTeams,
  resolveScoreInput,
  sideSizeRange,
  GOLF_FORMATS,
} from "@/lib/formats";
import { sideHandicap, aggregateTeamCard, matchHolesOffTheLow } from "@/lib/domain/team";
import { leagueSideBalls } from "@/lib/services/league";
import { STAGE_TYPES, generatesPairings, isPlayingRound, stageTypeInfo, roundIsStroke, isHeadToHead, boardKindForRound } from "@/lib/stage-types";
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
  readTeePolicy,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import type { Role } from "@/lib/roles";
import { bracketSizeFor, buildBracket, seedOrder, drawBrackets, firstRoundLosers, bracketFinishOrderAll, flightKind } from "@/lib/domain/bracket";
import { planFlights, proposeShapes } from "@/lib/domain/bracket-flights";
import { flightCountFor, formGroups } from "@/lib/domain/grouping";
import { groupByStandings, positionLookup } from "@/lib/domain/draw";
import {
  survivorCount,
  survivors,
  nextRoundFlights,
  strokeCutOutcome,
  roundRobinCutOutcome,
  CUT_TIE_RULES,
  type CutLineRow,
  type CutCandidate,
  type CutRule,
  type NextRoundFlight,
} from "@/lib/domain/cut";
import { aggregateStats, rankPlayers, computeStandings } from "@/lib/domain/standings";
import { onBoard } from "@/lib/domain/board-hold";
import { cutFeederOf, cutAfterRound } from "@/lib/domain/cut-ready";
import { countbackCardsFor } from "@/lib/services/course-resolution";
import { entryModesFor, type MatchEntryMode } from "@/lib/domain/match-entry";
import { matchCardFinished, matchStrokeCards, type MatchForCards } from "@/lib/domain/match-cards";
import { aggregateStroke, isRanked, type StrokeCard } from "@/lib/domain/stroke-agg";
import { resolveMatch } from "@/lib/domain/match";
import { holeStrokesReceived, stablefordPointsForHole, allocationHoles } from "@/lib/domain";
import { countbackBetween, countbackCardOn } from "@/lib/domain/stroke-countback";
import {
  handicapToFreeze,
  isReturnedCard,
  resolveRoundHandicap,
  roundHandicapKey,
} from "@/lib/domain/round-handicap";
import { playingHandicapFrom, courseHandicapMap, teeIdFor, courseHandicapExact, courseHandicap } from "@/lib/domain/handicap";
import { TEE_POLICY } from "@/lib/tournament-settings";
import {
  effectiveAllowance,
  snakeDraw,
  teamProblems,
  type TeamView,
} from "@/lib/services/teams";
import { orderClubs, type ClubRecord, type HeadToHead } from "@/lib/domain/league-order";
import { placesByValue } from "@/lib/domain/flight-places";
import { DEFAULT_SCORING } from "@/lib/domain/types";
import type { HoleResult, Match, Player } from "@/lib/domain/types";
import type { BracketView } from "@/lib/domain/bracket";
import { tournamentStatus, drawFacts, addRoundLockOf, locksFor, lockFactsOf, type Family, type TournamentFacts } from "@/lib/domain/tournament-status";
import { FAMILY_FIXTURES as STATUS_FAMILIES, launched as launchedFacts } from "@/lib/domain/__tests__/tournament-facts-fixtures";
import { fieldChangeAllowed, fieldFactsOf, fieldStepOf, partOf, type FieldChange, type FieldStep, type FieldVerdict } from "@/lib/domain/field-change";
import { teeSheetChangeAllowed, teeSheetStepOf, toldCount, type TeeSheetChangeAsk, type TeeSheetStep } from "@/lib/domain/tee-sheet-change";
import type { TeeSheet } from "@/lib/domain/tee-sheet";
import { acrossRounds, handicapMoves, roundChangeAllowed, roundStepOf, teesFrozenWords, type RoundChangeAsk, type RoundChangeRound, type RoundStep, type RoundVerdict } from "@/lib/domain/round-change";
import { formatFitsRound } from "@/lib/domain/round-choices";

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

  /**
   * HOW A ROUND IS SCORED IS A FACT ABOUT THE ROUND, NOT THE TOURNAMENT.
   *
   * The cell this file was missing, and the defect it would have caught. Every
   * board asked `event.format` — ONE value for a whole tournament — while each
   * round carries its own, so a match-play bracket inside an event whose
   * format said stroke tried to print strokes for a result that is "3&2".
   * That is the second half of an ordinary club championship, and it was found
   * by walking the player app rather than by any sweep.
   *
   * This file already enumerates format x stage type, which is the right axis
   * for "does anything throw". What it had no notion of is the EVENT around
   * them — so the assertion is that `roundIsStroke` answers from the ROUND,
   * which is the property whose absence was the bug.
   *
   * WHAT THIS BLOCK ITSELF GOT WRONG, recorded because the correction is the
   * more useful half. It used to assert that the answer depends on the type
   * and NOTHING ELSE, and it "proved" that by looping over every format and
   * calling `roundIsStroke(type)` — the same call, with no format in it, once
   * per format name. Every iteration was the first one. It could not have
   * failed, and the rule it claimed to pin was itself false: a Round Robin set
   * to Stroke Play is head-to-head by type and a MEDAL in fact, and judging it
   * on the type alone blanked every score on its board in production.
   */
  it("answers how a round is scored from the round alone", () => {
    for (const type of STAGE_TYPES) {
      const bare = roundIsStroke(type);
      expect(typeof bare, type).toBe("boolean");
      // With no format to go on, the type is the whole answer — a round where
      // somebody plays somebody has a match result; one where they do not has
      // strokes.
      expect(bare, type).toBe(!isHeadToHead(type));

      for (const format of FORMAT_NAMES) {
        const answer = roundIsStroke(type, format);
        expect(typeof answer, `${format} on a ${type}`).toBe("boolean");
        // A round that is not head-to-head is strokes whatever is set on it.
        // This is the half the TYPE has to decide: a Four-Ball is match play
        // in a bracket and stroke play in a medal, and no format string can
        // tell you which.
        if (!isHeadToHead(type)) {
          expect(answer, `${format} on a ${type}`).toBe(true);
        } else {
          // And this is the half the FORMAT has to decide, which is the one
          // that shipped wrong. Head-to-head by type, scored off cards in
          // fact.
          expect(answer, `${format} on a ${type}`).toBe(isStrokeScored(format));
        }
      }

      /**
       * AND THE FORMAT ACTUALLY MOVES IT, for the types where it should.
       *
       * The loop above computes its expectation with the same helper the
       * implementation calls, so on its own it would pass a `roundIsStroke`
       * that ignored the format entirely — which is precisely the code that
       * shipped. This line is what it cannot survive: on a head-to-head type,
       * the catalogue must contain a format that answers each way.
       */
      if (isHeadToHead(type)) {
        const answers = new Set(FORMAT_NAMES.map((f) => roundIsStroke(type, f)));
        expect(answers, `the format changes nothing on a ${type}`).toEqual(new Set([true, false]));
      }
    }
  });

  it("calls a head-to-head round set to a medal format a medal", () => {
    /**
     * THE SHAPE THAT SHIPPED BLANK, named rather than left to the sweep above,
     * because it is a real tournament and not a corner: `stage-types.ts` calls
     * a Round Robin set to Stroke Play "the only way to run one" before
     * `Stroke Play Round` existed. Those rows are still in the database.
     *
     * Judged on its type it is match play, the board printed a
     * win-loss-halved record for it, and a player who had just shot 72 saw an
     * empty cell.
     */
    expect(roundIsStroke("Round Robin", "Stroke Play")).toBe(true);
    expect(roundIsStroke("Round Robin", "Stableford")).toBe(true);
    // And the ordinary case is untouched, which is what keeps the line above
    // from being a regression wearing a bug report.
    expect(roundIsStroke("Round Robin", "Match Play")).toBe(false);
    expect(roundIsStroke("Bracket Stage", "Match Play")).toBe(false);
  });

  it("gives a definite answer for a type it has never heard of", () => {
    /**
     * A stage row written by an older build, or by a hand-edited database. It
     * must not crash a board, and the safe default is the milder wrong: a
     * score for a round with no opponent, rather than an invented
     * win-loss-halved record.
     */
    expect(roundIsStroke("Retired Stage Type")).toBe(true);
    expect(roundIsStroke("")).toBe(true);
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

      /**
       * AND THEY ARE PAIRED THE WAY A SEEDED DRAW PAIRS THEM.
       *
       * Everything above is satisfied by `[1, 2, 3, 4, …]`, which is every
       * seed exactly once and is also the worst possible draw: the top two
       * meet in the first round. So the checks passed while saying nothing
       * about the one thing `seedOrder` exists to do.
       *
       * The defining property is that the first round pairs the best
       * remaining with the worst remaining — 1 v 8, 4 v 5, 3 v 6, 2 v 7 —
       * so every pair sums to `size + 1`. That is what keeps the top two
       * apart until the final, and it holds for the hardcoded eight and for
       * every size the reflection generates.
       */
      if (size >= 2) {
        for (let i = 0; i < order.length; i += 2) {
          expect(
            order[i] + order[i + 1],
            `seeds ${order[i]} v ${order[i + 1]} in a bracket of ${size}`,
          ).toBe(size + 1);
        }
      }
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

          /**
           * AND IT IS THE RIGHT PLAYERS, not merely the right number of them.
           *
           * `survivors` takes `slice(0, n)` of a list whose parameter is
           * called `rankedInOrder` — best first. Asserting only `.size` meant
           * a cut that advanced the BOTTOM n instead passed at every field
           * size and every rule, because the count is identical either way.
           * The one thing a cut decides is who carries on.
           */
          const through = survivors(candidates(n), rule);
          expect(through.size).toBe(n2);
          const expected = candidates(n).slice(0, n2).map((p) => p.id);
          expect([...through].sort(), `${mode} ${value} of ${n} advanced the wrong players`)
            .toEqual([...expected].sort());
        }
      });
    }
  }

  it("a cut out of an empty field advances nobody rather than throwing", () => {
    const rule: CutRule = { scope: "overall", mode: "count", count: 4, percent: 50 };
    expect(survivorCount(rule, 0)).toBe(0);
    expect(survivors([], rule).size).toBe(0);
    for (const tie of CUT_TIE_RULES) {
      const out = strokeCutOutcome([], rule, tie, []);
      expect(out.through.size + out.undecided.length, `${tie}: an empty field`).toBe(0);
    }
  });
});

/**
 * A TIE ON THE STROKE CUT LINE, at every field size (2026-10-23).
 *
 * Every field from one, a block of 2, 3 or the WHOLE field level on one score
 * placed at every position (inside the places, across the line, below it),
 * cuts of 0, 1, the whole field and more than the field, both readings of the
 * board's countback (it split the block, or it could not), and all three tie
 * rules. Invariants, not features:
 *
 *   - nobody is both through and waiting on the committee;
 *   - everybody strictly ahead of the line is through, and nobody strictly
 *     behind it is;
 *   - a play-off or a draw leaves exactly the places: through + owed = N;
 *     "ties" never owes anything and takes everybody level on the line;
 *   - once every owed tie is recorded, nothing is owed and exactly N go.
 */
describe("a tie on the stroke cut line, at every field size", () => {
  for (const n of FIELD_SIZES) {
    it(`a field of ${n}, every tie, every cut, every rule`, () => {
      const blocks = [...new Set([2, 3, n])].filter((t) => t >= 2 && t <= n);
      for (const t of blocks) {
        for (let start = 0; start + t <= n; start += 1) {
          for (const split of [false, true]) {
            // Scores rise down the field; the block shares one. Ranks are the
            // board's: shared where its countback could not split the block.
            const rows: CutLineRow[] = Array.from({ length: n }, (_, i) => {
              const inBlock = i >= start && i < start + t;
              const score = inBlock ? start : i;
              const rank = inBlock && !split ? start + 1 : i + 1;
              return { id: `p${i + 1}`, groupId: null, rank, score };
            });
            for (const count of [0, 1, n, n + 5]) {
              const rule: CutRule = { scope: "overall", mode: "count", count, percent: 50 };
              const k = survivorCount(rule, n);
              const lineScore = rows[k - 1].score;
              for (const tie of CUT_TIE_RULES) {
                const label = `n=${n} block ${t}@${start}${split ? " split" : " shared"} cut ${count} ${tie}`;
                const out = strokeCutOutcome(rows, rule, tie, []);
                const owed = out.undecided.flatMap((u) => u.playerIds);
                expect(owed.filter((id) => out.through.has(id)), `${label}: through AND owed`).toEqual([]);
                for (const r of rows) {
                  if (r.score < lineScore) expect(out.through.has(r.id), `${label}: ${r.id} is ahead of the line`).toBe(true);
                  if (r.score > lineScore) expect(out.through.has(r.id) || owed.includes(r.id), `${label}: ${r.id} is behind the line`).toBe(false);
                }
                const places = out.undecided.reduce((a, u) => a + u.places, 0);
                if (tie === "ties") {
                  expect(out.undecided, label).toEqual([]);
                  for (const r of rows) if (r.score === lineScore) expect(out.through.has(r.id), `${label}: ${r.id} is level`).toBe(true);
                } else {
                  expect(out.through.size + places, `${label}: through + owed`).toBe(k);
                  for (const u of out.undecided) expect(u.places, label).toBeLessThan(u.playerIds.length);
                }
                // Settle every owed tie with its first players: nothing is owed, N go.
                const decided = strokeCutOutcome(
                  rows,
                  rule,
                  tie,
                  out.undecided.map((u) => ({ tied: u.playerIds, through: u.playerIds.slice(0, u.places) })),
                );
                expect(decided.undecided, `${label}: settled`).toEqual([]);
                if (tie !== "ties") expect(decided.through.size, `${label}: settled, N go`).toBe(k);
              }
            }
          }
        }
      }
    });
  }
});

/**
 * A TIE EXACTLY AT A ROUND ROBIN'S CUT LINE, IN FLIGHTS (J31, 2026-11-06).
 *
 * A real table from real matches, ranked by `rankPlayers`: in each flight a
 * strict ladder — everybody beats everybody listed below them, 1 up — except
 * that the two players either side of the line HALVE their meeting. That
 * leaves them level on points and on every tie-break the round has (they
 * halved head-to-head; their holes won and lost are the same), so the line
 * falls exactly through a tie the table cannot split. How it is settled is
 * the committee's published method — Committee Procedures 5A(6) — never the
 * order the list happens to be in, which past the tie-breaks is entry order:
 *
 *   - everyone above the pair is through, everyone below it is not, under
 *     every rule, in every flight;
 *   - "ties": both go through and nothing is owed;
 *   - a play-off or a countback: neither goes through, one tie of exactly the
 *     pair is owed for one place — by play-off, or by lot (the tie-breaks ran
 *     out) — in that flight;
 *   - recorded, the draw's winner goes through, even the one listed lower, and
 *     the flight sends exactly N.
 *
 * Flights of one to three; a cut of N bigger than a flight takes all of it.
 */
describe("a tie exactly at a round robin's cut line, in flights, at every field size", () => {
  const oneUp: HoleResult[] = ["A", ...new Array<HoleResult>(17).fill("H")];
  const allSquare: HoleResult[] = new Array<HoleResult>(18).fill("H");
  for (const n of FIELD_SIZES) {
    it(`a field of ${n}, in one to three flights, every cut, every rule`, () => {
      for (const flights of [1, 2, 3].filter((f) => f <= n)) {
        for (const count of [1, 2, 3]) {
          const players = field(n).map((p, i) => ({ ...p, groupId: `f${i % flights}` }));
          const byFlight = new Map<string, string[]>();
          for (const p of players) byFlight.set(p.groupId, [...(byFlight.get(p.groupId) ?? []), p.id]);
          const matches: Match[] = [];
          for (const [g, ids] of byFlight) {
            for (let i = 0; i < ids.length; i += 1) {
              for (let j = i + 1; j < ids.length; j += 1) {
                const atLine = i === count - 1 && j === count;
                matches.push({ id: `${ids[i]}-${ids[j]}`, stageId: "r1", groupId: g, round: 1, playerAId: ids[i], playerBId: ids[j], holes: atLine ? allSquare : oneUp });
              }
            }
          }
          const table = rankPlayers(players, aggregateStats(players, matches, DEFAULT_SCORING), DEFAULT_SCORING, matches);
          for (const scope of flights === 1 ? (["perFlight", "overall"] as const) : (["perFlight"] as const)) {
            for (const tie of CUT_TIE_RULES) {
              const label = `n=${n} ${flights} flight(s) top ${count} ${scope} ${tie}`;
              const next = { cutScope: scope, cutMode: "count", cutCount: count, cutPercent: 50, cutTies: tie, cutTieDecisions: "[]" };
              const out = roundRobinCutOutcome(table, next);
              const owed = out.undecided.flatMap((u) => u.playerIds);
              expect(owed.filter((id) => out.through.has(id)), `${label}: through AND owed`).toEqual([]);
              expect(out.through.size + owed.length, `${label}: inside the field`).toBeLessThanOrEqual(n);
              for (const [g, ids] of byFlight) {
                const flightLabel = `${label}, flight ${g} of ${ids.length}`;
                if (count >= ids.length) {
                  for (const id of ids) expect(out.through.has(id), `${flightLabel}: ${id} — the cut takes the flight`).toBe(true);
                  continue;
                }
                const pair = [ids[count - 1], ids[count]];
                for (const id of ids.slice(0, count - 1)) expect(out.through.has(id), `${flightLabel}: ${id} is above the line`).toBe(true);
                for (const id of ids.slice(count + 1)) {
                  expect(out.through.has(id) || owed.includes(id), `${flightLabel}: ${id} is below the line`).toBe(false);
                }
                const theirs = out.undecided.filter((u) => u.playerIds.some((id) => pair.includes(id)));
                if (tie === "ties") {
                  for (const id of pair) expect(out.through.has(id), `${flightLabel}: ${id} is level, and ties go through`).toBe(true);
                  expect(theirs, flightLabel).toEqual([]);
                } else {
                  for (const id of pair) expect(out.through.has(id), `${flightLabel}: ${id} is in a tie nobody has settled`).toBe(false);
                  expect(theirs, flightLabel).toEqual([
                    { groupId: scope === "overall" ? null : g, playerIds: pair, places: 1, by: tie === "playoff" ? "playoff" : "draw" },
                  ]);
                }
              }
              // Every owed tie recorded for its LOWER-listed player: nothing owed,
              // and each flight sends exactly N — the draw's winner among them.
              const decisions = out.undecided.map((u) => ({ tied: u.playerIds, through: [u.playerIds[u.playerIds.length - 1]] }));
              const settled = roundRobinCutOutcome(table, { ...next, cutTieDecisions: JSON.stringify(decisions) });
              expect(settled.undecided, `${label}: settled`).toEqual([]);
              if (tie === "ties") continue;
              for (const [g, ids] of byFlight) {
                const went = ids.filter((id) => settled.through.has(id));
                expect(went.length, `${label}, flight ${g}: settled, N go`).toBe(Math.min(count, ids.length));
                if (count < ids.length) expect(went, `${label}, flight ${g}: the draw's winner`).toContain(ids[count]);
              }
            }
          }
        }
      }
    });
  }
});

/**
 * WHAT A CUT IS TAKEN OUT OF, IN EVERY SHAPE OF TOURNAMENT (J31 review, 2026-11-07).
 *
 * Written by hand from what the two engines do, not from `cutFeederOf`:
 * `applyStrokeCut` cuts a stroke round on the stroke round just before it
 * (the cards), and `generateCutRound` cuts anything else on the table of the
 * last round robin before it BY POSITION — a medal between them does not move
 * it. The tie card, the record of a play-off and the board ask this one
 * function; it once asked the round beside the cut, and for round robin →
 * medal → cut round named no feeder while the draw refused for a tie.
 */
describe("the round a cut is taken out of, for every shape of tournament", () => {
  const RR = { type: "Round Robin", format: "Match Play" };
  const RR_MEDAL = { type: "Round Robin", format: "Stroke Play" };
  const MEDAL = { type: "Stroke Play Round", format: "Stroke Play" };
  const SCRAMBLE = { type: "Stroke Play Round", format: "Scramble" };
  type Shape = { type: string; format: string };
  // [the rounds, in order — the last is the cut round], the round it is taken out of (index), on what.
  const cells: [string, Shape[], number | null, "card" | "table" | null][] = [
    ["round robin → round robin", [RR, RR], 0, "table"],
    ["round robin → medal", [RR, MEDAL], 0, "table"],
    ["round robin → medal → round robin", [RR, MEDAL, RR], 0, "table"],
    ["round robin → scramble → medal", [RR, SCRAMBLE, MEDAL], 0, "table"],
    ["round robin → round robin → medal → round robin", [RR, RR, MEDAL, RR], 1, "table"],
    ["round robin → medal → medal (the cards)", [RR, MEDAL, MEDAL], 1, "card"],
    ["medal → medal", [MEDAL, MEDAL], 0, "card"],
    ["round robin at stroke play → medal (the cards)", [RR_MEDAL, MEDAL], 0, "card"],
    // A card cut needs BOTH rounds individual stroke play (`applyStrokeCut`); the round after is head to head, so this is
    // `generateCutRound`'s cut, which is always taken on the last round robin's table — whatever that round robin was scored as.
    ["round robin at stroke play → round robin", [RR_MEDAL, RR], 0, "table"],
    ["medal → round robin: no table before it", [MEDAL, RR], null, null],
    ["scramble → medal: neither engine cuts it", [SCRAMBLE, MEDAL], null, null],
    ["one round: nothing before it", [RR], null, null],
  ];
  for (const [name, shapes, from, kind] of cells) {
    it(name, () => {
      const rounds = shapes.map((s, i) => ({ id: `r${i + 1}`, ...s }));
      const line = cutFeederOf(rounds, rounds[rounds.length - 1].id);
      expect(line ? [line.feeder.id, line.kind] : null).toEqual(from === null ? null : [`r${from + 1}`, kind]);
      // And the rules sheet prints that cut on exactly ONE round's sheet — the
      // round that decides it, the same one — and on none where nothing does.
      const withCut = rounds.map((r, i) => ({
        ...r, cutEnabled: i === rounds.length - 1, cutScope: "overall", cutMode: "count", cutCount: 2, cutPercent: 50, cutTies: "playoff",
      }));
      const printedOn = withCut.filter((r) => cutAfterRound(withCut, r.id) !== null).map((r) => r.id);
      expect(printedOn, `${name}: the sheets that print the cut`).toEqual(from === null ? [] : [`r${from + 1}`]);
    });
  }
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
      /**
       * EVERY MATCH IN THIS FIXTURE IS HALVED, so nobody has beaten anybody
       * and the whole field is level. The right answer is that they all share
       * first place.
       *
       * This asserted `1..n` — a distinct place for every player — and said so
       * in its own comment: "it cannot happen here because `DEFAULT_SCORING`'s
       * chain ends in `lower-handicap` and this field's handicaps are
       * distinct". That was true, and it was the DEFECT rather than the rule.
       * A handicap is not a result; it decides the order of a list and cannot
       * decide who won. With eight players and every match halved, this cell
       * was pinning a board that reads 1 through 8 in handicap order.
       *
       * Exactly the shape CLAUDE.md records for this file: "the whole
       * leaderboard inverted, loser first — every match in the fixture was
       * halved, so nobody ever won anything".
       */
      const ranks = ranked.map((r) => r.rank);
      expect(ranks, "every match was halved, so nobody is ahead of anybody").toEqual(
        Array.from({ length: n }, () => 1),
      );
      expect(new Set(ranked.map((r) => r.player.id)).size).toBe(n);

      /**
       * And the general rule, which holds whatever the chain does: competition
       * ranking. Places never go backwards, the first is 1, and a place is
       * either shared with the row above or is that row's 1-based position —
       * which is what makes two players on 2nd leave the next on 4th rather
       * than inventing a 3rd nobody earned.
       */
      ranks.forEach((rank, i) => {
        expect(rank, `rank ${i} is not a place`).toBeGreaterThanOrEqual(1);
        if (i === 0) expect(rank, "the board starts at 1").toBe(1);
        else expect([ranks[i - 1], i + 1], `rank ${i} skipped or went backwards`).toContain(rank);
      });
    });
  }

  /**
   * A round robin somebody actually WINS.
   *
   * The sweep above halves every match, so every player scores the same and
   * the order comes entirely from the handicap tiebreak. That makes the
   * contiguity assertion sound and leaves the sweep unable to tell a correct
   * ranking from an inverted one — nobody ever wins anything, so there is no
   * result for the order to disagree with. It is the same hole the season
   * block had: the fixture cannot express the fault.
   *
   * Here the lower index always wins, so player 1 wins every match, player 2
   * wins all but one, and so on down. Points are then strictly descending by
   * index with no ties at all, and the ranking has exactly one right answer.
   */
  const decisive = (players: Player[]): Match[] => {
    const out: Match[] = [];
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        out.push({
          id: `d${i}-${j}`,
          stageId: "s1",
          groupId: "g1",
          round: 1,
          playerAId: players[i].id,
          playerBId: players[j].id,
          holes: new Array(18).fill("A") as Match["holes"],
        });
      }
    }
    return out;
  };

  for (const n of FIELD_SIZES.filter((s) => s >= 2)) {
    it(`puts the ${n} player(s) who won more above those who won less`, () => {
      const players = field(n);
      const matches = decisive(players);
      const stats = aggregateStats(players, matches, DEFAULT_SCORING);
      const ranked = rankPlayers(players, stats, DEFAULT_SCORING, matches);

      // Wins strictly decrease with index, so the board is the field in order.
      expect(ranked.map((r) => r.player.id)).toEqual(players.map((p) => p.id));
      expect(ranked.map((r) => r.rank)).toEqual(Array.from({ length: n }, (_, i) => i + 1));

      // And say it as the golf, not just as an array: nobody below has more
      // points than anybody above them.
      for (let i = 1; i < ranked.length; i += 1) {
        const above = ranked[i - 1].stats.totalPoints;
        const below = ranked[i].stats.totalPoints;
        expect(above, `${ranked[i - 1].player.id} above ${ranked[i].player.id}`).toBeGreaterThan(below);
      }
    });
  }

  it("ranks an empty field without throwing", () => {
    const stats = aggregateStats([], [], DEFAULT_SCORING);
    expect(rankPlayers([], stats, DEFAULT_SCORING, [])).toEqual([]);
  });

  /**
   * A HEAD-TO-HEAD CYCLE, at every field size it fits in (2026-11-07).
   *
   * The decisive round robin above, with ONE result turned round: the player
   * at window+2 beats the player at window. Worked by hand: in the decisive
   * table the three hold W, W-1 and W-2 wins; turning the one meeting round
   * gives each of them W-1 — level on points — and their meetings now go in a
   * circle (w b w+1, w+1 b w+2, w+2 b w). Every match is 10&8 (ten holes
   * won), and each of the three won and lost the same NUMBER of matches, so
   * hole difference and holes lost are level too. Nothing they did separates
   * them: Committee Procedures 5A(6) leaves the committee's chain to decide,
   * and the chain runs out — they SHARE place w+1. Everyone else keeps their
   * own position. Run in two entry orders, so a ranking that falls back on
   * the seed shows as two different boards.
   *
   * Under the pairwise rule this cell read w+1, w+2, w+3: each neighbouring
   * pair had a winner.
   */
  const flip = (matches: Match[], winner: string, loser: string): Match[] =>
    matches.map((m) =>
      m.playerAId === loser && m.playerBId === winner
        ? { ...m, holes: new Array(18).fill("B") as Match["holes"] }
        : m.playerAId === winner && m.playerBId === loser
          ? { ...m, holes: new Array(18).fill("A") as Match["holes"] }
          : m,
    );
  const reseeded = (players: Player[]) => players.map((p, i) => ({ ...p, seed: players.length - i }));
  const rankOf = (players: Player[], matches: Match[]) =>
    Object.fromEntries(
      rankPlayers(players, aggregateStats(players, matches, DEFAULT_SCORING), DEFAULT_SCORING, matches).map((r) => [
        r.player.id,
        r.rank,
      ]),
    );

  for (const n of FIELD_SIZES.filter((s) => s >= 3)) {
    it(`a three-way head-to-head cycle in a field of ${n} shares the place`, () => {
      const players = field(n);
      const w = Math.floor((n - 3) / 2);
      const [x, y, z] = [players[w].id, players[w + 1].id, players[w + 2].id];
      const matches = flip(decisive(players), z, x);
      const expected = Object.fromEntries(
        players.map((p, i) => [p.id, i >= w && i <= w + 2 ? w + 1 : i + 1]),
      );
      expect(rankOf(players, matches), `${x} b ${y}, ${y} b ${z}, ${z} b ${x}`).toEqual(expected);
      expect(rankOf(reseeded(players), matches), "entered the other way round").toEqual(expected);
    });
  }

  /**
   * A FOUR-PLAYER PARTIAL CYCLE: one of four level players beat the other
   * three, who go round in a circle among themselves. A window of six inside
   * the decisive table (everyone above beats all six, everyone below loses to
   * all six, so the window's own results decide it). Within the window, every
   * win 10&8:
   *   A  b B, C, D; lost E, F                   3 wins
   *   B  b C, E, F; lost A, D                   3 wins ┐
   *   C  b D, E, F; lost A, B                   3 wins ├ B b C, C b D, D b B
   *   D  b B, E, F; lost A, C                   3 wins ┘
   *   E  b A, F                                 2 wins
   *   F  b A                                    1 win
   * A, B, C, D level. Their mini-league: A +3, B, C, D -1 each — A first.
   * Asked again of B, C, D alone: 0, 0, 0, a cycle; each won 3 and lost 2
   * matches, so hole difference and holes lost are level: they share the next
   * place. Then E, then F.
   */
  for (const n of FIELD_SIZES.filter((s) => s >= 6)) {
    it(`a four-player partial cycle in a field of ${n}: one on top, three sharing the next place`, () => {
      const players = field(n);
      const w = Math.floor((n - 6) / 2);
      const [A, B, C, D, E, F] = players.slice(w, w + 6).map((p) => p.id);
      // Decisive already has A b B, C, D, E, F; B b C, D, E, F; C b D, E, F; D b E, F; E b F.
      let matches = decisive(players);
      for (const [winner, loser] of [[E, A], [F, A], [D, B]] as const) matches = flip(matches, winner, loser);
      const expected = Object.fromEntries(
        players.map((p, i) => {
          const at = i - w;
          if (at === 0) return [p.id, w + 1];
          if (at >= 1 && at <= 3) return [p.id, w + 2];
          return [p.id, i + 1];
        }),
      );
      expect(rankOf(players, matches), `${A} on top; ${B}, ${C}, ${D} in a circle`).toEqual(expected);
      expect(rankOf(reseeded(players), matches), "entered the other way round").toEqual(expected);
    });
  }
});

/**
 * A HALVED MATCH IS DECIDED ON THE CARD IT WAS PLAYED ON — at every field size,
 * on nine holes and eighteen, with the venue named at every level (J26,
 * 2026-11-06).
 *
 * Committee Procedures 5A(6): a tied match is decided as the Terms say, and a
 * "toughest holes" countback names holes by the stroke index of the course
 * PLAYED (Rules of Handicapping, Appendix E allocates an index per course).
 *
 * Eighteen holes: the tournament's own card holds the 1st hardest, the away
 * card is the same layout indexed the other way (the 18th hardest). NINE holes
 * are the BACK nine, on cards laid out as clubs lay them out — odd indexes out,
 * even home — so the nine is a real axis: the home back nine's hardest is the
 * 10th (its index 2), the away back nine's the 18th (also index 2). Read off the
 * FRONT nine's indexes instead, both cards would make the first hole of the nine
 * the hardest (index 1) and the away match would go to A — the narrowing to the
 * nine played is what tells them apart.
 *
 * Every match in the round robin is halved the same way: side A won the first
 * holes, side B the last ones — so on the HOME card every countback goes to A
 * and on the AWAY card every one goes to B. A board that read one card for every
 * match ranks the field exactly upside down from one that reads the right one,
 * and the wins are asserted as numbers, not as an order alone.
 */
describe("a halved match's countback, at every field size, hole count and venue level", () => {
  const ODDS = [1, 3, 5, 7, 9, 11, 13, 15, 17];
  const HOME_CARD = (holes: number) => (holes === 18 ? Array.from({ length: 18 }, (_, i) => i + 1) : [...ODDS, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  const AWAY_CARD = (holes: number) => (holes === 18 ? Array.from({ length: 18 }, (_, i) => 18 - i) : [...ODDS, 18, 16, 14, 12, 10, 8, 6, 4, 2]);
  const awayCourse = (holes: number) => ({
    id: "zz-away",
    name: "zz-away",
    city: "",
    pars: JSON.stringify(new Array(18).fill(4)),
    yards: "",
    strokeIndex: JSON.stringify(AWAY_CARD(holes)),
  });
  // A wins the first two holes, B the last two, the rest halved: all square.
  const halved = (holes: number): HoleResult[] =>
    Array.from({ length: holes }, (_, i) => (i < 2 ? "A" : i >= holes - 2 ? "B" : "H"));

  for (const holes of [9, 18]) {
    for (const level of ["match", "round", "event"] as const) {
      for (const n of FIELD_SIZES) {
        it(`${n} player(s), ${holes} holes, venue on the ${level}: every halve goes to the side that won the played card's hardest holes`, () => {
          const players = field(n);
          const rows: Array<{ id: string; stageId: string; courseId: string | null }> = [];
          const matches: Match[] = [];
          for (let i = 0; i < n; i += 1) {
            for (let j = i + 1; j < n; j += 1) {
              const id = `c${i}-${j}`;
              rows.push({ id, stageId: "wk", courseId: level === "match" ? "zz-away" : null });
              matches.push({ id, stageId: "wk", groupId: "g1", round: 1, playerAId: players[i].id, playerBId: players[j].id, holes: halved(holes) });
            }
          }
          const cards = countbackCardsFor(
            { course: "zz-home", city: "", customPars: JSON.stringify(new Array(18).fill(4)), customYards: "", customStrokeIndex: JSON.stringify(HOME_CARD(holes)) },
            [{ id: "wk", courseId: level === "round" ? "zz-away" : null, holes, nine: holes === 9 ? "back" : "full" }],
            rows,
            (id) => (id === "zz-away" ? awayCourse(holes) : null),
          );
          const ranked = computeStandings(players, matches, { ...DEFAULT_SCORING, tiebreakers: [] }, {}, cards, ["toughest-1"]);
          const away = level !== "event";
          // Player at index k is side A against everybody after them and side B
          // against everybody before them. Away, B takes every countback.
          for (let k = 0; k < n; k += 1) {
            const s = ranked.find((r) => r.player.id === players[k].id)!.stats;
            const wins = away ? k : n - 1 - k;
            expect({ wins: s.wins, losses: s.losses, ties: s.ties }, `${players[k].id}`).toEqual({ wins, losses: n - 1 - wins, ties: 0 });
            expect(s.totalPoints).toBe(wins * DEFAULT_SCORING.winPts);
          }
          // The board itself: away, the LAST entrant leads; at home, the first.
          if (n >= 2) expect(ranked[0].player.id).toBe(away ? players[n - 1].id : players[0].id);
        });
      }
    }
  }
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
          const allowance = effectiveAllowance(format, pct, "Stroke Play Round");
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

  /** teamProblems reads the members who are PLAYING — the count and each
   *  one's `withdrawn` flag; the rest is shape it needs. */
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
        handicapExact: p.handicap,
        parStrokes: 0,
        playing: null,
        position,
        // Everybody drawn here is playing. `teamProblems` now reads this as
        // well as the count — a side whose partner withdrew on the morning is
        // one short — and this sweep is about the DRAW, not the day.
        withdrawn: false,
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

      // The board still ranks everybody, with the forfeit in it, and nobody
      // is dropped.
      const ranked = rankPlayers(players, stats, DEFAULT_SCORING, matches);
      expect(ranked).toHaveLength(n);
      expect(new Set(ranked.map((r) => r.player.id)).size).toBe(n);

      /**
       * COMPETITION RANKING, not one place each.
       *
       * This asserted `1..n`, which only held because the chain ended in
       * `lower-handicap` and this field's handicaps are distinct — so a
       * handicap, which is not a result, was quietly separating players the
       * forfeit had left level. A four-player round here settles as
       * `[1, 2, 2, 4]`: two players share second, and the next is fourth
       * rather than a third nobody earned.
       */
      const ranks = ranked.map((r) => r.rank);
      ranks.forEach((rank, i) => {
        if (i === 0) expect(rank, "the board starts at 1").toBe(1);
        else expect([ranks[i - 1], i + 1], `rank ${i} skipped or went backwards`).toContain(rank);
      });
    });
  }
});

/**
 * A result held in dispute, at every field size (2026-11-08, found by J49).
 *
 * The server holds a disputed match off the table by blanking its holes to
 * `"[]"` (`onBoard`), and `resolveMatch([])` is complete and halved — so the
 * table gave both players a match played and a halve while the Committee had
 * not ruled. Rule 3.2a(3): a match is decided when one side leads by more holes
 * than remain; with none played, nothing is decided.
 *
 * The invariant, in every cell: a held result moves NOTHING — the table with
 * it is the table without it — and once the hold is lifted it counts exactly
 * once, for both players. Every other match in the round is a played-out
 * halve, so a phantom halve is indistinguishable by shape and only the
 * counting can tell them apart.
 */
describe("a result held in dispute, at every field size", () => {
  const PLAYED_HALVE = [...new Array(9).fill("A"), ...new Array(9).fill("B")] as Match["holes"];
  /** What the disputed card says: A won 3&2. */
  const DISPUTED_CARD = [...new Array(3).fill("A"), ...new Array(13).fill("H"), null, null] as Match["holes"];
  const SCORING = { ...DEFAULT_SCORING, playPts: 1 };

  const asStored = (scoreStatus: string, holes: Match["holes"]): Match["holes"] =>
    JSON.parse(onBoard({ scoreStatus, holes: JSON.stringify(holes), forfeitedBy: "" }).holes) as Match["holes"];

  const roundRobin = (players: Player[], firstStatus: string): Match[] => {
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
          holes: first ? asStored(firstStatus, DISPUTED_CARD) : PLAYED_HALVE,
          forfeitedBy: "",
        });
      }
    }
    return out;
  };

  for (const n of FIELD_SIZES) {
    it(`a ${n}-player round robin with one result held: the table is the table without it`, () => {
      const players = field(n);
      const withHeld = roundRobin(players, "disputed");
      const withoutHeld = withHeld.slice(1);

      const held = aggregateStats(players, withHeld, SCORING);
      const absent = aggregateStats(players, withoutHeld, SCORING);
      expect(held.size).toBe(n);
      for (const p of players) {
        expect(held.get(p.id), `${p.id}'s line moved for a held result`).toEqual(absent.get(p.id));
      }

      // Counted from what SHOULD be there: every played-out match is one
      // halve for each of its two players, and the held one is none.
      const decided = withoutHeld.length;
      const sum = (f: (s: { played: number; ties: number }) => number) => [...held.values()].reduce((t, s) => t + f(s), 0);
      expect(sum((s) => s.played)).toBe(2 * decided);
      expect(sum((s) => s.ties)).toBe(2 * decided);

      const rankedHeld = rankPlayers(players, held, SCORING, withHeld);
      const rankedAbsent = rankPlayers(players, absent, SCORING, withoutHeld);
      expect(rankedHeld.map((r) => [r.player.id, r.rank])).toEqual(rankedAbsent.map((r) => [r.player.id, r.rank]));

      // Lifted: the Committee rules, the card comes back, and A's 3&2 counts
      // once for each of the two players and nobody else.
      if (n >= 2) {
        const settled = aggregateStats(players, roundRobin(players, "confirmed"), SCORING);
        const [a, b] = [withHeld[0].playerAId, withHeld[0].playerBId];
        for (const p of players) {
          const before = held.get(p.id)!;
          const after = settled.get(p.id)!;
          const inIt = p.id === a || p.id === b;
          expect(after.played - before.played, `${p.id} played`).toBe(inIt ? 1 : 0);
        }
        expect(settled.get(a)!.wins - held.get(a)!.wins).toBe(1);
        expect(settled.get(b)!.losses - held.get(b)!.losses).toBe(1);
      }
    });
  }
});

/**
 * The interclub league table, swept.
 *
 * This block used to sweep `domain/season.ts`, a team-season engine that no
 * screen ever called and that was retired on 2026-09-27. The table that
 * DOES rank sides across weeks is the interclub league: clubs are flights,
 * `leagueTable` totals their meeting points, `orderClubs` orders them, and
 * `LeagueTable` prints the places `placesByValue` gives. So the invariants
 * worth keeping from that sweep are pointed here.
 *
 * The combination that matters is still a club that MISSED a week. Points
 * count upward, so a raw total already costs an absentee the week it missed.
 * The fault to catch is somebody "fixing" that into an average, which would
 * hand the league to whoever played their best week and then stopped. So the
 * fixture's absentee has the BEST points per meeting and a LOWER total than
 * the club that turned up every week. Only an order on the total puts the
 * two the right way round.
 *
 * Week counts start at ZERO because a league's table is looked at before the
 * first meeting. Every club is listed then, all level on nothing.
 */
describe("interclub league table, at every club count and week count", () => {
  const WEEK_COUNTS = [0, 1, 2, 3, 6];
  // win-percentage divides by meetings played, and a club yet to play has
  // played none. Head-to-head over an empty record decides nothing. Both are
  // in the chain so that the sort is exercised on the rows that could break it.
  const CHAIN = ["win-percentage", "head-to-head"] as const;
  const NO_MEETINGS: HeadToHead = new Map();

  /**
   * Club 0 wins every meeting it plays (2 points each) and sits out the last
   * week. Club 1 plays every week and halves one of them, so it is BEHIND
   * club 0 per meeting and AHEAD of it on the total. The others score on
   * `i % 3`, so that real ties on points turn up at every size.
   */
  const clubsFor = (n: number, weeks: number): ClubRecord[] =>
    Array.from({ length: n }, (_, i) => {
      const played = i === 0 && weeks > 0 ? weeks - 1 : weeks;
      const perWeek = i === 0 ? 2 : i === 1 ? 2 : i % 3;
      const points = i === 1 && weeks > 0 ? perWeek * played - 1 : perWeek * played;
      const won = i <= 1 ? Math.max(0, played - (i === 1 ? 1 : 0)) : i % 3 === 2 ? played : 0;
      return {
        clubId: `c${i + 1}`,
        name: `Club ${i + 1}`,
        points,
        played,
        won,
        holesWon: 0,
        holesLost: 0,
      };
    });

  for (const weeks of WEEK_COUNTS) {
    for (const n of FIELD_SIZES) {
      it(`${n} club(s) over ${weeks} week(s)`, () => {
        const clubs = clubsFor(n, weeks);
        const table = orderClubs(clubs, [...CHAIN], NO_MEETINGS);

        // Every club appears exactly once. A league table with a club missing
        // reads as a bug on a clubhouse screen.
        expect(table).toHaveLength(n);
        expect(new Set(table.map((r) => r.clubId)).size).toBe(n);

        // The rows come through the sort unchanged, so a club that missed a
        // week still says so beside its total rather than being given a
        // meeting it never played.
        if (weeks > 1) {
          const sat = table.find((r) => r.clubId === "c1");
          expect(sat?.played, "the club that missed a week").toBe(weeks - 1);
        }

        // The order does not depend on the order the clubs were read in. A
        // comparator that returns NaN — a win-percentage over no meetings,
        // for one — gives an order that does.
        const reversed = orderClubs([...clubs].reverse(), [...CHAIN], NO_MEETINGS);
        expect(reversed.map((r) => r.clubId)).toEqual(table.map((r) => r.clubId));

        // THE ORDER IS RIGHT, not merely complete: most points first, and
        // never a club above one with more points.
        for (let i = 1; i < table.length; i += 1) {
          const above = table[i - 1];
          const below = table[i];
          expect(
            above.points,
            `${above.clubId} (${above.points} pts over ${above.played}) placed above ${below.clubId} (${below.points} over ${below.played})`,
          ).toBeGreaterThanOrEqual(below.points);
        }

        // Turning up counts. The club that played every week is ahead of the
        // one with the better rate that missed a week.
        if (n >= 2 && weeks > 1) {
          const at = (id: string) => table.findIndex((r) => r.clubId === id);
          expect(at("c2"), "the absentee was ranked on its rate, not its total").toBeLessThan(at("c1"));
        }

        // The places the screen prints. Everybody is placed, first is 1, a
        // tie on points shares a place, and the next place skips: T2, T2, 4.
        const places = placesByValue(table, (r) => r.points, () => true);
        expect(places.every((p) => p !== null)).toBe(true);
        if (n > 0) expect(places[0]).toBe(1);
        places.forEach((p, i) => {
          if (i === 0) return;
          const prev = places[i - 1] as number;
          if (table[i].points === table[i - 1].points) expect(p, `row ${i} did not share a tie`).toBe(prev);
          else expect(p, `row ${i} did not skip past the tie`).toBe(i + 1);
        });
      });
    }
  }

  it("gives an empty table for a league with no clubs", () => {
    expect(orderClubs([], [...CHAIN], NO_MEETINGS)).toEqual([]);
    expect(placesByValue([] as ClubRecord[], (r) => r.points, () => true)).toEqual([]);
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

  it("names the three policies and nothing else", () => {
    // A fourth value would need a decision everywhere the policy is read.
    // There WAS a fourth — `player`, "Players choose their own tees" — retired
    // on 2026-10-13: the organizer decides the tees. It was scored as `own`.
    expect([...TEE_POLICY].sort()).toEqual(["flight", "one", "own"]);
  });

  it("reads a tournament stored with the retired policy as the one it was scored as", () => {
    expect(readTeePolicy("player")).toBe("own");
    for (const policy of TEE_POLICY) expect(readTeePolicy(policy)).toBe(policy);
    // And the resolver itself, handed the old word raw, still lets a player's own set count.
    expect(teeIdFor("player", "blue", null, "white", () => true, null)).toBe("blue");
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
   * `teeIdFor("flight", …, here)` was asserted directly and was always right. What
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

  /**
   * ONE COURSE, so every set named below is on it.
   *
   * `teeIdFor` takes a fifth argument now — whether a set is at the course
   * being played — because a stored `Player.teeId` names a row on ONE course
   * and a tournament can be played on several. These blocks are about
   * PRECEDENCE, which is a separate question, so they answer yes to all of it
   * and the cross-course behaviour is asserted on its own below.
   */
  const here = () => true;

  it("resolves the id itself the same way, so one reader answers for all", () => {
    // teeIdFor is what both the scoring path and the printed card go through.
    // Arguments are (policy, player, flight, round, is-it-on-this-course).
    expect(teeIdFor("one", "blue", null, "white", here, null)).toBe("white");
    expect(teeIdFor("own", "blue", null, "white", here, null)).toBe("blue");
    expect(teeIdFor("own", null, null, "white", here, null)).toBe("white");
    // No round tee and no player tee is "unrated", not a crash.
    expect(teeIdFor("one", "blue", null, null, here, null)).toBe("");
    // An unrecognised policy behaves as "own" — a bad stored value must not
    // silently impose a restriction nobody chose.
    expect(teeIdFor("nonsense", "blue", null, "white", here, null)).toBe("blue");
  });

  it("lets a FLIGHT claim its own tees, which is how a club championship works", () => {
    // Championship off the blues, seniors off the whites, ladies off the reds:
    // three decisions rather than one per player, which is the only version a
    // club would actually use on a field of 120.
    expect(teeIdFor("flight", null, "white", "blue", here, null)).toBe("white");
    // A flight claiming nothing falls through to the round's set.
    expect(teeIdFor("flight", null, null, "blue", here, null)).toBe("blue");

    // SPECIFICITY WINS ABOVE THE POLICY, AND THE POLICY IS THE FLOOR.
    // "By division" means the flight may differ and an individual may not —
    // otherwise one player quietly opting onto another set would break the
    // division the committee drew.
    expect(teeIdFor("flight", "red", "white", "blue", here, null)).toBe("white");
    // "One set for everyone" overrides both, which is what it says.
    expect(teeIdFor("one", "red", "white", "blue", here, null)).toBe("blue");
    // Where individuals may differ, a player beats their flight, and a flight
    // beats the round.
    expect(teeIdFor("own", "red", "white", "blue", here, null)).toBe("red");
    expect(teeIdFor("own", null, "white", "blue", here, null)).toBe("white");
    expect(teeIdFor("player", null, "white", "blue", here, null)).toBe("white");
  });

  it("steps past a set that is not at the course being played", () => {
    /**
     * A stored `Player.teeId` names a row on ONE course, and a tournament can
     * be played on several — a two-day member-guest, a league with no fixed
     * venue. Honouring it at another club does not give a stale answer; it
     * gives a slope and a course rating from somewhere else, while everybody
     * WITHOUT a stored tee is priced correctly beside them. Measured on a
     * two-venue fixture: 17 strokes where 7 is right.
     *
     * The round's own set is never filtered — `teeForPlay` resolved it against
     * this very course, so asking again would be asking the answer whether it
     * is the answer.
     */
    const atThisCourse = (id: string) => id === "home-white" || id === "home-blue";

    // The player's set is at another club: fall through to the round's.
    expect(teeIdFor("own", "away-red", null, "home-white", atThisCourse, null)).toBe("home-white");
    // So is the flight's — a division drawn at one venue does not travel.
    expect(teeIdFor("flight", null, "away-red", "home-white", atThisCourse, null)).toBe("home-white");
    // Both, falling all the way through.
    expect(teeIdFor("own", "away-red", "away-blue", "home-white", atThisCourse, null)).toBe("home-white");
    // A player's set that IS here still wins, which is the whole point of the
    // preference existing.
    expect(teeIdFor("own", "home-blue", null, "home-white", atThisCourse, null)).toBe("home-blue");
    // And the round's own set is taken whether or not the predicate likes it.
    expect(teeIdFor("one", "home-blue", null, "away-red", atThisCourse, null)).toBe("away-red");
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

  it("pins the pairing where saving half a card outlives the right to enter one", () => {
    /**
     * Saving a partial card is a WEAKER right than entering scores at all, and
     * the two functions do not know about each other: `canPlayerSavePartial`
     * reads only the WINDOW, `canEnterScores` only WHO MAY ENTER. So they
     * disagree across a whole slice of the cross product — every staff-entry
     * tournament scored during play.
     *
     * This assertion USED TO BE A TAUTOLOGY. It branched on
     * `!canEnterScores(s, "player")` and then expected exactly that to be
     * false, inside the branch that had just established it. It ran on
     * hundreds of combinations, could not fail on any of them, and counted as
     * coverage — the same fault as the six fixtures named further up this file,
     * sitting in the sweep itself.
     *
     * What is true, and can fail, is that the pairing OCCURS and occurs for
     * the reason claimed. If either function changed so that it no longer
     * arose, the note above would be describing an impossible case and should
     * go with it.
     *
     * Enforcement is NOT here and cannot be: it is at the actions, where every
     * write path checks `session.role === "player" && !canPlayerSavePartial`
     * alongside who may enter at all. See `audit-idor.test.ts`.
     */
    const conflicted = ALL.filter((s) => !canEnterScores(s, "player") && canPlayerSavePartial(s));
    expect(conflicted.length, "the pairing this note describes no longer occurs").toBeGreaterThan(0);
    for (const s of conflicted) {
      expect(s.scoreEntryBy).not.toBe("players");
      expect(s.scoreEntryWindow).toBe("during");
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

  it("offers no tee policy under which a player picks their own tees", () => {
    // The organizer decides, at every level. A settings combination that named
    // the retired policy would be one this enumeration could not have built.
    for (const s of ALL) {
      expect(["one", "flight", "own"]).toContain(s.teePolicy);
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

            /**
             * 5. A PER-FLIGHT cut keeps its flights — while they are still
             *    flights.
             *
             * This block used to assert the DEFECT, and said so: "it CAN hand
             * on a flight of one... the draw drops those players, and nobody is
             * told". A cut of "1 from each of 3 flights" is an ordinary thing
             * for a club to run, and it left three flights of one, drew no
             * matches at all, and rebuilt the round empty after wiping it.
             *
             * Asserted against the golf now, per CLAUDE.md: a round handed on
             * to players must be playable. When a per-flight cut would leave
             * somebody alone the survivors are pooled instead — flight winners
             * play each other — and a pooled field keeps no old flight rows.
             */
            if (rule.scope === "perFlight") {
              for (const f of next) {
                expect(
                  f.playerIds.length,
                  `${label}: handed on a flight of ${f.playerIds.length}`,
                ).toBeGreaterThanOrEqual(2);
              }
              const pooled = next.some((f: NextRoundFlight) => f.keepGroupId === null);
              if (!pooled) {
                // Nothing was stranded, so every flight is one that already
                // existed — a kept flight must never invent a new row.
                for (const f of next) {
                  expect(f.keepGroupId, `${label}: a kept flight lost its row`).not.toBeNull();
                }
              }
              // And with anyone left to pair, nobody is quietly dropped.
              if (through.size >= 2) {
                expect(placed.length, `${label}: a per-flight cut stranded somebody`).toBe(
                  through.size,
                );
              }
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

/**
 * WHAT A SIDE ACTUALLY PLAYS OFF, on every team format and every legal size.
 *
 * FOUND BY MUTATION, 2026-09-15, and the number is the argument. Making
 * `allocatedStrokes` ignore the allowance entirely — every player off their
 * full course handicap in every team format — failed exactly ONE test in the
 * whole suite. The same mutation on `courseHandicap`'s slope term fails nine.
 *
 * One hand-written unit test stood between a wrong allowance and a real card,
 * and `aggregateTeamCard` is the scoring path: every four-ball, foursomes,
 * greensomes, Chapman and scramble card is built on it.
 *
 * This file's own "round handicaps" block does not cover it, and reading the
 * name suggests otherwise — it sweeps how a handicap is RESOLVED (member,
 * override, frozen, editable) and never what the side plays off once the
 * format's allowance is applied. Exactly the gap the allowance TABLE had,
 * closed a few hours earlier in `handicap-allowances.test.ts`.
 *
 * ASSERTED AGAINST THE FORMAT'S OWN DECLARATION rather than against a second
 * copy of the arithmetic: the expected number is computed here from
 * `allowance` and `weightsBySideSize`, which is what CLAUDE.md means by
 * asserting the rule rather than the behaviour.
 */
describe("what a side plays off, on every team format and size", () => {
  const TEAM_FORMATS = GOLF_FORMATS.filter((f) => f.sideSize > 1);
  // Distinct and spread, so a wrong weighting cannot land on the right answer
  // by accident — four equal handicaps make 25/20/15/10 and a flat 17.5% agree.
  const HANDICAPS = [4, 11, 19, 28];

  it("has team formats to sweep", () => {
    // The control. A filter that matched nothing would make every assertion
    // below vacuous while the block still reported green.
    expect(TEAM_FORMATS.length, "no team formats found").toBeGreaterThan(4);
  });

  for (const format of TEAM_FORMATS) {
    const { min, max } = sideSizeRange(format.name);
    for (let size = min; size <= max; size += 1) {
      it(`${format.name}, side of ${size}`, () => {
        const hcps = HANDICAPS.slice(0, size);
        const weights = format.weightsBySideSize?.[size];
        const got = sideHandicap(hcps, format.allowance, weights);

        /**
         * The expected number, worked from the format's declaration.
         *
         * A weighted format applies one percentage per player in ABILITY
         * order — best first — and a flat one takes a percentage of the
         * combined handicaps. Both are rounded once at the end, which is how
         * an allowance is applied in practice and not per player.
         */
        const best = [...hcps].sort((a, b) => a - b);
        const expected = weights
          ? Math.round(best.reduce((sum, h, i) => sum + (h * (weights[i] ?? 0)) / 100, 0))
          : Math.round((best.reduce((sum, h) => sum + h, 0) * format.allowance) / 100);

        expect(got, `${format.name} side of ${size} plays off the wrong number`).toBe(expected);
        expect(Number.isFinite(got)).toBe(true);
        expect(got, "a side cannot play off a negative allowance").toBeGreaterThanOrEqual(0);
      });
    }
  }

  it("a weighted format does NOT agree with a flat one on mixed handicaps", () => {
    /**
     * THE CELL THAT MAKES THE REST MEAN SOMETHING. Every assertion above
     * passes if `sideHandicap` ignores its weights and applies the flat
     * allowance — as long as the two happen to agree on the fixture. They
     * agree exactly when the partners are equal, which is why the handicaps
     * here are spread.
     *
     * Chapman is the format this was found on: 60/40 and a flat 50% of the
     * combined give the same answer on equal partners and diverge with the
     * gap between them, which is why a wrong allowance survived in production
     * until somebody checked a mismatched pair.
     */
    const pair = [6, 24];
    const weighted = sideHandicap(pair, 100, [60, 40]);
    const flat = sideHandicap(pair, 50);
    expect(weighted, "the weights are not being applied").not.toBe(flat);
  });
});

/**
 * A LEAGUE WEEK ON A SHARED BALL, on every one-ball format and every side size
 * from ONE (backlog J22, 2026-11-03).
 *
 * `leagueMeetings` priced every card by its player, and a side's shared card
 * has none — so every foursomes, greensomes and scramble side in a league week
 * played off scratch, and the league table, its holes-won countback and the
 * play-off seeding were decided off nought. The block above sweeps what a side
 * plays off on the TEAMS screen and could not see it: the league never called
 * that path.
 *
 * Asserted against Appendix C, held HERE as its own table (not read from
 * `formats.ts`), in whole tenths so the rounding is the Rule's — .5 upwards,
 * once, at the end. A side of ONE is outside the appendix (a pair reduced by a
 * withdrawal the committee let play): it must still not be scratch, and must
 * not play off more than its one player.
 *
 * And the cell's MATCH invariant, which needs no table: two sides on level
 * gross, the low one priced however it is, the other wins exactly as many holes
 * as it receives strokes — the difference, off the low SIDE.
 */
describe("a league week on a shared ball, on every one-ball format and side size", () => {
  const SHARED = GOLF_FORMATS.filter((f) => f.ball === "single" && !f.manual);
  const FLAT_HALF = { 2: [50, 50] } as Record<number, number[]>;
  const SIXTY_FORTY = { 2: [60, 40] } as Record<number, number[]>;
  const SCRAMBLE = { 2: [35, 15], 3: [30, 20, 10], 4: [25, 20, 15, 10] } as Record<number, number[]>;
  // Rules of Handicapping, Appendix C (2024), lowest handicap first.
  const APPENDIX_C: Record<string, Record<number, number[]>> = {
    Foursomes: FLAT_HALF,
    "Alternate Shot": FLAT_HALF,
    Greensomes: SIXTY_FORTY,
    "Chapman / Pinehurst": SIXTY_FORTY,
    Scramble: SCRAMBLE,
    "Texas Scramble": SCRAMBLE,
  };
  // Exact Course Handicaps with a decimal, distinct and spread, NOT in order.
  const TENTHS = [227, 48, 315, 131];
  const SI = Array.from({ length: 18 }, (_, i) => i + 1);
  const LEVEL = JSON.stringify(new Array(18).fill(5));
  const noPlayer = (id: string): number => {
    throw new Error(`a shared ball was priced by a player ("${id}")`);
  };

  it("has one-ball formats to sweep, and Appendix C names every one of them", () => {
    // The control: a filter that matched nothing would make every cell vacuous.
    expect(SHARED.length, "no shared-ball formats found").toBeGreaterThanOrEqual(4);
    // A new one-ball format fails here until somebody reads the appendix for it.
    for (const f of SHARED) expect(APPENDIX_C[f.name], `${f.name} has no Appendix C row here`).toBeDefined();
  });

  for (const format of SHARED) {
    const { max } = sideSizeRange(format.name);
    for (let size = 1; size <= max; size += 1) {
      it(`${format.name}, side of ${size}`, () => {
        const tenths = TENTHS.slice(0, size);
        const partners = tenths.map((t) => ({ exact: t / 10, withdrawn: false }));
        const round = { format: format.name, handicapAllowance: 0, allowanceWeights: [] as number[] };
        const balls = leagueSideBalls(round, [{ playerId: "", strokes: LEVEL }], partners, noPlayer);

        expect(balls, "a shared ball is ONE ball").toHaveLength(1);
        const got = balls[0].playingHandicap;
        expect(Number.isFinite(got)).toBe(true);
        // THE J22 INVARIANT: partners who all receive strokes are not scratch.
        expect(got, `${format.name} side of ${size} priced at scratch`).toBeGreaterThan(0);

        const shares = APPENDIX_C[format.name]?.[size];
        if (shares) {
          const best = [...tenths].sort((a, b) => a - b);
          const n = best.reduce((sum, t, i) => sum + t * (shares[i] ?? 0), 0); // in 1000ths
          const rule = Math.floor((2 * n + 1000) / 2000);
          expect(got, `${format.name} side of ${size} is not Appendix C's figure`).toBe(rule);
        } else {
          expect(size, "only a side of one is outside the appendix").toBe(1);
          expect(got, "a side of one plays off more than its one player").toBeLessThanOrEqual(Math.round(tenths[0] / 10));
        }

        // Against a scratch side on level gross: wins exactly the holes it
        // receives a stroke on — the hardest `got` of them, the rest halved.
        const scratch = leagueSideBalls(
          round,
          [{ playerId: "", strokes: LEVEL }],
          [{ exact: 0, withdrawn: false }],
          noPlayer,
        );
        const holes = matchHolesOffTheLow(scratch, balls, SI, 18);
        const strokes = Math.min(18, got);
        expect(holes.filter((h) => h === "B").length, "holes won off the low side").toBe(strokes);
        expect(holes.slice(0, strokes).every((h) => h === "B"), "on the hardest holes").toBe(true);
        expect(holes.filter((h) => h === "A").length).toBe(0);
      });
    }
  }
});

/**
 * A SIDE'S TO-PAR, AT EVERY STAGE OF A HOLE BEING PLAYED.
 *
 * The block above sweeps what a side plays OFF. This sweeps what its card then
 * SAYS, and the axis is the one nothing had ever varied: how many partners
 * have actually holed out, against how many the format counts.
 *
 * `aggregateTeamCard` adds `candidates.slice(0, countBest)` to the gross — so
 * however many are in — and charged `par * countBest` regardless. Where the
 * two differ the side is credited a whole par per missing score: a
 * best-two-of-four with one partner's par in read FOUR UNDER on a hole
 * somebody had parred, and that number reaches `/leaderboard`, `/reports` and
 * the public board through `teamStandings`.
 *
 * It survived because `team.test.ts`'s own best-two cell has all four partners
 * holing out, which is the one column of this table where gross and par cover
 * the same number of scores and agree whatever the code does. Every other
 * column is a state a real side is in while the round is being played, and a
 * pick-up leaves one there for good.
 *
 * ASSERTED AGAINST THE RULE, not against a second copy of the arithmetic:
 * to-par is gross minus par over the scores that COUNTED, and the count is
 * `min(holed out, countBest)` because that is what the slice can return.
 */
describe("a side's to-par counts the scores it actually has", () => {
  const PAR = 4;
  const HOLES = 9;
  const pars = new Array(HOLES).fill(PAR);
  const si = Array.from({ length: HOLES }, (_, i) => i + 1);

  // Scratch, so the allowance cannot move a number this block is not about —
  // `sideHandicap` above is where the allowance is swept.
  const member = (id: string, first: number | null) => ({
    playerId: id,
    courseHandicap: 0,
    strokes: Array.from({ length: HOLES }, (_, i) => (i === 0 ? first : null)),
  });

  for (let countBest = 1; countBest <= 4; countBest += 1) {
    for (let holedOut = 1; holedOut <= 4; holedOut += 1) {
      it(`best ${countBest} of 4, ${holedOut} partner(s) in`, () => {
        const team = ["a", "b", "c", "d"].map((id, i) =>
          // Everybody who is in made par, so a miscount shows up as a whole
          // par of credit rather than as a plausible-looking small number.
          member(id, i < holedOut ? PAR : null),
        );
        const card = aggregateTeamCard(team, pars, si, 100, countBest);

        const counted = Math.min(holedOut, countBest);
        expect(card.grossTotal, "gross is not the scores that counted").toBe(PAR * counted);
        expect(
          card.toPar,
          `${counted} par(s) returned should be level, not ${card.toPar}`,
        ).toBe(0);
        expect(card.played, "the hole was played").toBe(1);
      });
    }
  }

  it("a side that is genuinely OVER par still reads over", () => {
    /**
     * THE CELL THAT MAKES THE REST MEAN SOMETHING.
     *
     * Every assertion above is satisfied by a `toPar` hardcoded to zero, and
     * the fix it guards is a change to how par is counted — so a sweep of
     * level-par fixtures alone could not tell the right rule from no rule at
     * all. One bogey, one partner in, counting the best two: one score, one
     * par charged, one over.
     */
    const team = ["a", "b", "c", "d"].map((id, i) => member(id, i === 0 ? PAR + 1 : null));
    const card = aggregateTeamCard(team, pars, si, 100, 2);
    expect(card.toPar).toBe(1);
  });
});

/**
 * A KNOCKOUT IN SEVERAL FLIGHTS, at every field size, in every shape offered
 * and by both criteria that need nothing but the field (2026-10-12).
 *
 * The arithmetic of dividing has its own file. This cell is the COMBINATION:
 * a division handed to the bracket builder, played to the end in every flight,
 * and read back as a finishing order — three modules that are each right on
 * their own. What must hold whatever the size and shape (Rule 3.2: a match is
 * won on the course; Committee Procedures 5F(1): the general numerical draw):
 *
 *  - every shape holds the whole field, in flights of two or more;
 *  - a flight of k players takes exactly k − 1 results, so the whole knockout
 *    takes n − (number of flights), and never crowns anybody before that;
 *  - no two flights file a tie under the same key;
 *  - once every flight is played, everybody is placed exactly once, the places
 *    are whole numbers from 1, and nobody in a lower flight is placed above
 *    anybody in a higher one.
 *
 * The sizes add the ones this feature lives at — one more than a flight, and
 * a hundred — to the sweep's own.
 */
describe("a knockout in flights, at every field size and every shape", () => {
  for (const n of [...FIELD_SIZES, 9, 17, 18, 33, 100]) {
    it(`divides, plays and places a field of ${n} in every shape it is offered`, () => {
      const players = field(n);
      const entrants = players.map((p) => ({ id: p.id, name: p.name, handicapIndex: p.handicap }));
      const byId = new Map(players.map((p) => [p.id, p]));
      const shapes = proposeShapes(n);
      if (n < 2) {
        expect(shapes, "one player is not a knockout").toEqual([]);
        expect(planFlights(entrants, "handicap", [n]).ok).toBe(false);
        return;
      }
      expect(shapes.length).toBeGreaterThan(0);
      expect(shapes.filter((s) => s.recommended).length, "exactly one shape is suggested").toBe(1);

      for (const shape of shapes) {
        expect(shape.counts.reduce((a, b) => a + b, 0), `${shape.label} does not hold the field`).toBe(n);
        expect(Math.min(...shape.counts), `${shape.label} has a flight of one`).toBeGreaterThanOrEqual(2);
        for (const criterion of ["handicap", "random"] as const) {
          const made = planFlights(entrants, criterion, shape.counts, `seed-${n}`);
          if (!made.ok) throw new Error(`${shape.label} by ${criterion}: ${made.error}`);
          const flights = made.plan.brackets.map((b) => b.playerIds.map((id, i) => ({ ...byId.get(id)!, seed: i + 1 })));
          const winners: Record<string, string> = {};
          const views = () => flights.map((f, i) => buildBracket(flightKind(i), f, winners));
          const where = `${n} players, ${shape.label}, by ${criterion}`;

          const keys = views().flatMap((v) => v.rounds.flatMap((r) => r.matches.map((m) => m.key)));
          expect(new Set(keys).size, `${where}: two flights share a key`).toBe(keys.length);

          let results = 0;
          for (let guard = 0; guard < 12; guard += 1) {
            const open = views().flatMap((v) => v.rounds.flatMap((r) => r.matches)).filter((m) => !m.winnerId && m.a.playerId && m.b.playerId);
            if (open.length === 0) break;
            // Until the last tie is in, at least one flight has no champion.
            expect(views().some((v) => v.champion === null), `${where}: every flight crowned with ties unplayed`).toBe(true);
            for (const m of open) {
              // The LOWER seed wins every tie: a finishing order that simply read the seeding back would be wrong.
              winners[m.key] = (m.a.seed ?? 0) > (m.b.seed ?? 0) ? m.a.playerId! : m.b.playerId!;
              results += 1;
            }
          }
          expect(results, `${where}: results it took`).toBe(n - flights.length);

          const done = views();
          for (const [i, v] of done.entries()) {
            expect(v.champion, `${where}: flight ${i + 1} has no champion`).not.toBeNull();
            expect(flights[i].some((p) => p.id === v.champion!.playerId), `${where}: flight ${i + 1} was won by somebody not in it`).toBe(true);
          }
          const order = bracketFinishOrderAll(done);
          expect(order.length, `${where}: placed`).toBe(n);
          expect(new Set(order.map((p) => p.playerId)).size, `${where}: somebody placed twice`).toBe(n);
          for (const p of order) expect(Number.isInteger(p.rank) && p.rank >= 1 && p.rank <= n, `${where}: ${p.name} is placed ${p.rank}`).toBe(true);
          expect(Math.min(...order.map((p) => p.rank))).toBe(1);
          const flightOf = new Map(flights.flatMap((f, i) => f.map((p) => [p.id, i] as const)));
          let above = 0;
          for (const [i, f] of flights.entries()) {
            const ranks = order.filter((p) => flightOf.get(p.playerId) === i).map((p) => p.rank);
            expect(Math.min(...ranks), `${where}: flight ${i + 1} starts at`).toBe(above + 1);
            expect(Math.max(...ranks), `${where}: flight ${i + 1} runs into the one below`).toBeLessThanOrEqual(above + f.length);
            above += f.length;
          }
        }
      }
    });
  }
});

/**
 * A KNOCKOUT'S PLAY IS OVER WHEN EVERY DRAW'S FINAL IS DECIDED — in every mode,
 * at every field size, with THREE draws where the mode has flights (CLAUDE.md:
 * "flights are separate knockouts; test with THREE").
 *
 * The state machine's knockout row (proposal 3 Nov, panel changes 2–3): play
 * over is every draw in `bracketDraws()` decided, plus the play-off for third
 * when it is on — never `playOverOf`, which a Bracket Stage cannot satisfy.
 *
 * THE EXPECTATION IS WORKED BY A ROUTE THE CODE DOES NOT TAKE. The code asks
 * the bracket for its champion. The Rules route counts ties: in a
 * single-elimination draw every tie (Rule 3.2) puts exactly one player out and
 * a bye puts out nobody, so a draw of n entrants has its Final decided exactly
 * when n − 1 ties have a winner. Each cell plays a draw out tie by tie, the
 * higher seed winning, and checks both.
 */
describe("a knockout is over when every draw's Final is decided, in every mode", () => {
  const winnersIn = (kind: string, winners: Record<string, string>) => Object.keys(winners).filter((k) => k.startsWith(`${kind}-`)).length;

  /** Decide ties in order, top seed through, leaving `stopShort` ties undecided. */
  const playOut = (kind: Parameters<typeof buildBracket>[0], players: Player[], winners: Record<string, string>, fieldComplete = true, stopShort = 0) => {
    const total = Math.max(0, players.length - 1);
    for (let guard = 0; guard < 200 && winnersIn(kind, winners) < total - stopShort; guard++) {
      const view = buildBracket(kind, players, winners, fieldComplete);
      const tie = view.rounds.flatMap((r) => r.matches).find((m) => m.a.playerId && m.b.playerId && !m.winnerId);
      if (!tie) break;
      winners[tie.key] = tie.a.playerId!;
    }
    return buildBracket(kind, players, winners, fieldComplete);
  };

  type Mode = "single" | "split" | "plate" | "flights";
  /** The draws a mode makes of `n` players, each played out (or one tie short where `short(i)`). */
  const drawsFor = (mode: Mode, n: number, short: (i: number) => boolean) => {
    const players = field(n);
    const winners: Record<string, string> = {};
    const left = (i: number) => (short(i) ? 1 : 0);
    if (mode === "single") return [{ label: "", players, view: playOut("winners", players, winners, true, left(0)), results: winners }];
    if (mode === "split") {
      const d = drawBrackets(players, "split");
      return [
        { label: d.mainLabel, players: d.main, view: playOut("winners", d.main, winners, true, left(0)), results: winners },
        { label: d.secondLabel, players: d.second, view: playOut("consolation", d.second, winners, true, left(1)), results: winners },
      ];
    }
    if (mode === "plate") {
      const main = playOut("winners", players, winners, true, left(0));
      const losers = firstRoundLosers(main, new Map(players.map((p) => [p.id, p])));
      return [
        { label: "Main draw", players, view: main, results: winners },
        { label: "Plate", players: losers, view: playOut("consolation", losers, winners, false, left(1)), results: winners },
      ];
    }
    // Three flights, top-down, each its own knockout.
    const size = Math.ceil(n / 3);
    return [0, 1, 2].map((i) => {
      const own = players.slice(i * size, (i + 1) * size);
      return { label: `Flight ${i + 1}`, players: own, view: playOut(flightKind(i), own, winners, true, left(i)), results: winners };
    });
  };

  const statusOf = (mode: Mode, draws: ReturnType<typeof drawsFor>, thirdPlace = { on: false, decided: false }) =>
    tournamentStatus({
      ...launchedFacts(STATUS_FAMILIES[mode === "flights" ? "flightedKnockout" : "knockout"]()),
      bracketMode: mode,
      knockout: { draws: draws.map((d) => drawFacts({ label: d.label, view: d.view })), thirdPlace },
    });

  // Recorded results only: a bye advances a player with no tie played.
  const decidedTies = (d: { view: BracketView; results: Record<string, string> }) => winnersIn(d.view.kind, d.results);

  for (const mode of ["single", "split", "plate", "flights"] as Mode[]) {
    for (const n of FIELD_SIZES) {
      it(`${mode}, ${n} players: a Final is decided exactly when n − 1 ties are, and play is over only then`, () => {
        const all = drawsFor(mode, n, () => false);
        for (const d of all) {
          const where = `${mode} ${n} ${d.label || "draw"}`;
          // The Rules route: a draw of e entrants is decided after e − 1 ties.
          expect(decidedTies(d), where).toBe(Math.max(0, d.players.length - 1));
          const own = drawFacts({ label: d.label, view: d.view });
          expect(own.entrants, where).toBe(d.players.length);
          if (d.players.length >= 2) expect(own.finalDecided, `${where}: every tie played and no champion`).toBe(true);
        }
        const real = all.filter((d) => d.players.length >= 2).length;
        expect(statusOf(mode, all).step, `${mode} ${n}: ${real} draws with a tie in them, all decided`).toBe(real > 0 ? "play-over" : "live");

        // One tie short in the LAST draw with a tie in it — the others decided — is not over.
        const lastReal = all.map((d, i) => (d.players.length >= 2 ? i : -1)).filter((i) => i >= 0).pop();
        if (lastReal !== undefined) {
          const short = drawsFor(mode, n, (i) => i === lastReal);
          expect(decidedTies(short[lastReal]), `${mode} ${n}`).toBe(short[lastReal].players.length - 2);
          expect(drawFacts({ label: "", view: short[lastReal].view }).finalDecided, `${mode} ${n}`).toBe(false);
          expect(statusOf(mode, short).step, `${mode} ${n}: draw ${lastReal + 1} one tie short`).toBe("live");
        }
      });
    }

    it(`${mode}: with a play-off for third on, play is over only once it is decided too (F3)`, () => {
      const all = drawsFor(mode, 8, () => false);
      expect(statusOf(mode, all, { on: true, decided: false }).step).toBe("live");
      expect(statusOf(mode, all, { on: true, decided: true }).step).toBe("play-over");
    });
  }

  it("CONTROL: the flights mode makes three draws, each its own bracket with players in it", () => {
    const three = drawsFor("flights", 28, () => false);
    expect(three.map((d) => d.players.length)).toEqual([10, 10, 8]);
    expect(new Set(three.map((d) => d.view.kind)).size).toBe(3);
  });
});

/**
 * WHAT A TEAM BOARD PRINTS FOR HANDICAP, ON EVERY TEAM FORMAT, SIDE SIZE AND KIND
 * OF ROUND (backlog J21, J23).
 *
 * Invariants, not features:
 *   - where every player plays their own ball the column holds one figure PER
 *     PLAYER and never the side's combined figure (nobody plays off it);
 *   - where the side shares a ball it holds the side's figure and no other;
 *   - the rules sheet states an allowance, and it is the resolver's
 *     (`recommendedAllowance`) unless the format is scored by a split.
 */
describe("what a team board and the rules sheet say about handicap, on every team format", () => {
  const TEAM_FORMATS = GOLF_FORMATS.filter((f) => f.sideSize > 1);
  const HANDICAPS = [4, 11, 19, 28];
  // Distinct from every player's own figure, so a board that printed the side's by mistake is seen.
  const SIDE = 777;

  it("has team formats to sweep", () => {
    expect(TEAM_FORMATS.length, "no team formats found").toBeGreaterThan(4);
  });

  const textOf = (s: string): string => {
    let out = "";
    let inTag = false;
    for (const ch of s) {
      if (ch === "<") inTag = true;
      else if (ch === ">") inTag = false;
      else if (!inTag) out += ch;
    }
    return out;
  };

  // Pinned to the RULES, not to the resolver the sweep below reads.
  // Rules of Handicapping, Appendix C: four-ball stroke play 85%, four-ball match play 90%.
  const stated = (format: string, type: string) =>
    tournamentTerms({
      format, type, holes: 18, scoringBasis: "net", handicapAllowance: 0, countBest: 0,
      tiebreakers: [], cutAfter: null, carryForwardEnabled: false, carryForwardPct: 0, netCountback: "fractions",
    }).find((t) => t.label === "Handicap allowance")?.value;
  it("Appendix C: a four-ball stroke round states 85%", () => {
    expect(stated("Four-Ball", "Stroke Play Round")).toContain("85%");
  });
  it("Appendix C: a four-ball match round states 90%", () => {
    expect(stated("Four-Ball", "Round Robin")).toContain("90%");
  });

  for (const format of TEAM_FORMATS) {
    const { min, max } = sideSizeRange(format.name);
    for (let size = min; size <= max; size += 1) {
      for (const type of STAGE_TYPES) {
        it(`${format.name}, side of ${size}, ${type}`, () => {
          const ownBall = format.ball !== "single";
          const members = HANDICAPS.slice(0, size);
          const row = {
            teamId: "t1",
            name: "zz-side",
            members: members.map((_, i) => `zz-p${i}`),
            memberIds: members.map((_, i) => `p${i}`),
            memberPlaying: members.map((h) => (ownBall ? h : null)),
            playingHandicap: SIDE,
            gross: 70,
            net: 60,
            points: 0,
            played: 18,
            toPar: -2,
            place: 1,
          };
          if (isHeadToHead(type)) {
            // A round of MATCHES is not ranked on the team stroke table at all:
            // every board asks `boardKindForRound` and draws the matches
            // (`TeamMatchLeaderboard`), which has no handicap column. The
            // handicap-column invariant below belongs to the stroke board only.
            expect(boardKindForRound(format.name, type), "a head-to-head team round has the matches' board").toBe("team-match");
          } else {
            expect(boardKindForRound(format.name, type), "a stroke team round has the team stroke board").toBe("team");
            const html = renderToStaticMarkup(createElement(TeamStandingsTable, { basis: "net", rows: [row] }));
            const cell = [...html.match(/<tbody>.*?<\/tr>/s)![0].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => textOf(m[1]))[2];
            if (ownBall) {
              expect(cell, "a two-ball board must list each player's own figure").toBe(members.join(" · "));
              expect(html).not.toContain(`>${SIDE}<`);
            } else {
              expect(cell, "a shared-ball board prints the side's figure").toBe(String(SIDE));
            }
          }

          const words = tournamentTerms({
            format: format.name,
            type,
            holes: 18,
            scoringBasis: "net",
            handicapAllowance: 0,
            countBest: 0,
            tiebreakers: [],
            cutAfter: null,
            carryForwardEnabled: false,
            carryForwardPct: 0, netCountback: "fractions",
          }).find((t) => t.label === "Handicap allowance")?.value;
          expect(words, "the rules sheet states no allowance").toBeTruthy();
          if (!format.weightsBySideSize) expect(words).toContain(`${recommendedAllowance(format.name, type)}%`);
        });
      }
    }
  }
});

/**
 * AN UPSTREAM EDIT TO THE FIELD, EVERY FAMILY × EVERY STEP (J12, state machine
 * PR 7a; the proposal's test plan, "an upstream edit, every scope × every
 * step", for the field and flights rows).
 *
 * The expectation is worked HERE from the panel's table and its Q3, never read
 * off the function:
 *
 *   - before the draw anything goes (nothing is locked yet);
 *   - stroke play and Stableford take a late entrant after the draw with a
 *     WARNING — the unplaced flag where flights exist (J04) — and with a flight
 *     chosen, plainly; once Round 1 has a card in (no published sheet here),
 *     the competition has begun and a new name would have no score for it, so
 *     REFUSE;
 *   - a round robin in flights REFUSES a late entrant with no flight (no
 *     flight, no fixtures) and takes one with a flight as a RE-DRAW (their
 *     matches drawn against it); refused once begun;
 *   - a knockout REFUSES after its draw — launched, or a result recorded
 *     before launch (D2) — and the way out is a reserve; the reserve itself is
 *     never refused before the results are final;
 *   - a match or a cup: the draw is the field, REFUSE after launch;
 *   - a league or a casual round changes week to week: open;
 *   - completed: REFUSE, every family (Rule 20.2e, results final).
 *
 * Field sizes start at ONE (a knockout of one, a medal of one); a flighted
 * knockout has THREE flights (CLAUDE.md, knockouts). Invariants in every cell:
 * the step the facts stand in is the step meant; every refusal has words and a
 * screen; a refusal naming a correction is opened by it; a withdrawal is open
 * until completed; the scope returned is the change's part.
 */
describe("an upstream edit to the field, every family × every step (J12)", () => {
  type Want = "open" | "warn" | "redraw" | "refuse";
  const STEPS: FieldStep[] = ["before-draw", "after-draw", "after-scores", "completed"];
  const FAMILIES = Object.keys(STATUS_FAMILIES) as Family[];
  /** No published sheet: Round 1's first card closes late entries (PR A's rule). */
  const CLOCK = { lastTee: null, now: { day: "2026-11-29", minutes: 8 * 60 } };
  const FLIGHTED: Family[] = ["stroke", "stableford", "roundRobinFlights"];

  /** A family at a step, n entered, with `flights` flights where the family has them — three draws for a flighted knockout. */
  function factsAt(family: Family, step: FieldStep, n: number, flights: number): TournamentFacts {
    const base = STATUS_FAMILIES[family]();
    const f: TournamentFacts = {
      ...base,
      confirmed: n,
      groups: FLIGHTED.includes(family) ? flights : base.groups,
      knockout:
        family === "flightedKnockout"
          ? {
              // Three flights, the field dealt between them as the division would (n = 1 leaves two empty).
              draws: ["Flight A", "Flight B", "Flight C"].map((label, i) => ({ label, entrants: Math.floor((n + 2 - i) / 3), finalDecided: false })),
              thirdPlace: { on: false, decided: false },
            }
          : base.knockout,
    };
    const played = (x: TournamentFacts): TournamentFacts => ({ ...x, rounds: x.rounds.map((r, i) => (i === 0 ? { ...r, hasResult: true } : r)) });
    switch (step) {
      case "before-draw":
        // A casual round is created live and unlocked; everything else is still being set up.
        return family === "casual" ? f : { ...f, status: "draft", configUnlocked: false };
      case "after-draw":
        return launchedFacts(f);
      case "after-scores":
        return played(launchedFacts(f));
      case "completed":
        return { ...played(f), status: "completed", configUnlocked: false };
    }
  }

  /** "add" — a late entrant with no flight. */
  function wantAdd(family: Family, step: FieldStep, flights: number): Want {
    if (step === "completed") return "refuse";
    if (step === "before-draw") return "open";
    if (family === "league" || family === "casual") return "open";
    if (family === "stroke" || family === "stableford") return step === "after-draw" ? (flights > 0 ? "warn" : "open") : "refuse";
    // A round robin needs a flight; a knockout's draw, a match's draw and a cup's sides are the field.
    return "refuse";
  }

  /** "add-to-flight" — a late entrant with a flight, where the family has flights to give. */
  function wantAddWithFlight(family: "stroke" | "stableford" | "roundRobinFlights", step: FieldStep): Want {
    if (step === "completed" || step === "after-scores") return "refuse";
    if (step === "before-draw") return "open";
    return family === "roundRobinFlights" ? "redraw" : "open";
  }

  const kind = (v: FieldVerdict): Want => (!v.ok ? "refuse" : v.warn === "unplaced" ? "warn" : v.warn === "matches-drawn" ? "redraw" : "open");

  const invariants = (facts: ReturnType<typeof fieldFactsOf>, change: FieldChange, v: FieldVerdict, at: string) => {
    expect(v.scope, `${at}: the scope is the change's part`).toBe(partOf(change, facts.family));
    if (v.ok) return;
    expect(v.says.trim().length, `${at}: a refusal in words`).toBeGreaterThan(10);
    expect(v.wayOut.href, `${at}: a way out to a screen`).toMatch(/^\//);
    const named = /to the field|open the field/.test(v.says) ? "field" : /to the flights|open the flights/.test(v.says) ? "flights" : null;
    if (named && fieldStepOf(facts) !== "completed") {
      const opened = { ...facts, correction: { scope: named as "field" | "flights" } };
      expect(fieldChangeAllowed(opened, change).ok, `${at}: the correction its refusal names opens it`).toBe(true);
    }
  };

  for (const family of FAMILIES) {
    for (const step of STEPS) {
      for (const n of [1, 2, 3, 8, 28]) {
        const flightCounts = family === "stroke" || family === "stableford" ? [0, Math.min(3, n)] : [Math.min(3, n)];
        for (const flights of flightCounts) {
          it(`${family} · ${step} · ${n} entered · ${flights} flights`, () => {
            const facts = fieldFactsOf(factsAt(family, step, n, flights), CLOCK);
            expect(fieldStepOf(facts), "the fixture stands in the step meant").toBe(step);

            const add = fieldChangeAllowed(facts, "add");
            expect(kind(add), "a late entrant with no flight").toBe(wantAdd(family, step, flights));
            invariants(facts, "add", add, "add");

            if (family === "stroke" || family === "stableford" || family === "roundRobinFlights") {
              const withFlight = fieldChangeAllowed(facts, "add-to-flight");
              expect(kind(withFlight), "a late entrant with a flight").toBe(wantAddWithFlight(family, step));
              invariants(facts, "add-to-flight", withFlight, "add-to-flight");
            }

            if (family === "knockout" || family === "flightedKnockout") {
              // After the draw the way out is a reserve, and the reserve is taken.
              if (step === "after-draw" || step === "after-scores") {
                expect(add.ok ? null : add.wayOut, "the reserve is the way out").toEqual({ says: "Add them as a reserve on Entries", href: "/registration" });
              }
              expect(fieldChangeAllowed(facts, "reserve").ok, "a reserve, until the results are final").toBe(step !== "completed");
            }

            // A withdrawal never reopens anything: open until completed, every family, every size.
            expect(fieldChangeAllowed(facts, "withdraw").ok).toBe(step !== "completed");
          });
        }
      }
    }
  }

  it("a knockout whose draw was made before launch (D2) refuses a late entrant, a correction or not", () => {
    for (const family of ["knockout", "flightedKnockout"] as Family[]) {
      const base = STATUS_FAMILIES[family]();
      const drawn: TournamentFacts = { ...base, status: "draft", rounds: base.rounds.map((r) => ({ ...r, hasResult: true })) };
      const facts = fieldFactsOf(drawn, CLOCK);
      expect(fieldStepOf(facts)).toBe("after-scores");
      expect(fieldChangeAllowed(facts, "add").ok, family).toBe(false);
      expect(fieldChangeAllowed(facts, "reserve").ok, family).toBe(true);
      // A qualifying round's card is NOT the knockout's draw: before launch a knockout after a medal still takes entries.
      const qualifying: TournamentFacts = {
        ...base,
        status: "draft",
        rounds: [{ ...base.rounds[0], id: "q1", type: "Stroke Play Round", format: "Stroke Play", hasResult: true }, { ...base.rounds[0], id: "k1", position: 1 }],
      };
      expect(fieldChangeAllowed(fieldFactsOf(qualifying, CLOCK), "add").ok, `${family} after a medal`).toBe(true);
    }
  });

  /**
   * THE CONSTANT-OFFSET CHECK (combination sweep): two cells asserted whole,
   * against the panel's words, so a rule that shifted every cell the same way
   * cannot pass on the cells agreeing with each other.
   */
  it("two rows by hand: a medal's late entrant flagged, a knockout's refused with the reserve", () => {
    const medal = fieldFactsOf(factsAt("stroke", "after-draw", 28, 3), CLOCK);
    expect(fieldChangeAllowed(medal, "add")).toEqual({ ok: true, scope: "field", warn: "unplaced" });
    const knockout = fieldFactsOf(factsAt("knockout", "after-scores", 8, 0), CLOCK);
    expect(fieldChangeAllowed(knockout, "add")).toEqual({
      ok: false,
      scope: "field",
      says: "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. To draw it again, clear its results on the Bracket.",
      wayOut: { says: "Add them as a reserve on Entries", href: "/registration" },
    });
  });
});

/**
 * AN UPSTREAM EDIT TO A ROUND, EVERY FORMAT × STAGE TYPE × STEP × FIELD SIZE
 * (J12, state machine PR 7b; the proposal's test plan, "an upstream edit,
 * every scope × every step", for the rounds-and-format rows).
 *
 * The expectation is worked HERE from section 3's table and the Golf Pro's
 * answers, never read off the function:
 *
 *   allowance / basis                     open · open · WARN (confirm, recompute, log) · refuse
 *     — except a round whose result is a MATCH: refused after scores, since a
 *       decided match stands (Rule 3.2a(5)) and is not worked out again;
 *   a round's tees or course (8 Nov, C)   open · open · REFUSE · refuse — its handicaps were
 *                                         frozen off its tees, and the index they were frozen
 *                                         with is not stored, so nothing is re-frozen;
 *   the tournament's / a flight's tees    refused after scores where a round of CARDS is reached;
 *                                         a round of matches keeps its frozen strokes, so open there;
 *   format                                open · RE-DRAW if it now draws differently · refuse
 *                                         both ways (Rule 21.1b vs 3.3b(3); Committee
 *                                         Procedures 5A) · refuse;
 *   holes (8 Nov, format-like)            open · open · refuse · refuse;
 *   a cut made OUT of the round (8 Nov)   its allowance, basis and tees (and the tournament's) refused after
 *                                         scores, the way out the cut's undo on Rounds & formats;
 *   delete                                open · WARN (its draw goes with it) · refuse · refuse;
 *   a round's day                         open · open · WARN (schedules) · refuse.
 *
 * Which rounds file MATCHES is written out by hand from the catalogue — a
 * head-to-head round in any format not scored on strokes or points — not by
 * the predicate the rule uses. Launch is not a step: every cell before
 * completion runs both unlaunched and launched. Field sizes start at ONE: a
 * head-to-head round of one has nobody to be drawn against, so it stays
 * before the draw whatever happens around it. Invariants in every cell: the
 * step meant; every refusal in words with a screen to go to; none offers a
 * committee correction (a correction never opens over recorded scores — TD,
 * panel 8.1); scores send to Score entry (a knockout's results to the Bracket), completion to the dashboard.
 */
describe("an upstream edit to a round, every format × stage type × step × field size (J12)", () => {
  type Want = "open" | "warn" | "redraw" | "refuse";
  const STEPS: RoundStep[] = ["before-draw", "after-draw", "after-scores", "completed"];
  const HEAD_TO_HEAD = ["Round Robin", "Single Match Stage", "Bracket Stage", "Team Session"];
  /** Scored on strokes or points, never hole by hole (the catalogue's stroke, Stableford and modified-Stableford games). */
  const ON_CARDS = ["Stroke Play", "Stableford", "Modified Stableford"];
  const matchesFiled = (type: string, format: string) => HEAD_TO_HEAD.includes(type) && !ON_CARDS.includes(format);

  /** `cut`: a cut has been made OUT of this round — the next round's field was decided on its figures (8 Nov). */
  function want(kind: RoundChangeAsk["kind"], step: RoundStep, matches: boolean, redraws: boolean, cut = false): Want {
    if (step === "completed") return "refuse";
    switch (kind) {
      case "allowance":
        return step === "after-scores" ? (matches || cut ? "refuse" : "warn") : "open";
      case "round-tees":
        // Option C (8 Nov): a scored round's handicaps were frozen off its tees, and the index is not stored.
        return step === "after-scores" ? "refuse" : "open";
      case "field-tees":
        // A scored round of cards refuses; a round of matches keeps the strokes it was frozen at.
        return step === "after-scores" && !matches ? "refuse" : "open";
      case "format":
        return step === "after-scores" ? "refuse" : step === "after-draw" && redraws ? "redraw" : "open";
      case "holes":
        // Format-like (8 Nov): another length makes the cards mean something else.
        return step === "after-scores" ? "refuse" : "open";
      case "delete":
        return step === "after-scores" ? "refuse" : step === "after-draw" ? "warn" : "open";
      case "day":
        return step === "after-scores" ? "warn" : "open";
    }
  }
  const kind = (v: RoundVerdict): Want => (!v.ok ? "refuse" : v.warn === null ? "open" : v.warn === "redraw" ? "redraw" : "warn");

  /** A round of `type` in `format` at `step`, for a field of `n`. Head to head, the pairings are the field halved — none for one. */
  function roundAt(type: string, format: string, step: RoundStep, n: number): { round: RoundChangeRound; meant: RoundStep } {
    const h2h = HEAD_TO_HEAD.includes(type);
    const pairings = h2h ? Math.floor(n / 2) : 0;
    // A head-to-head round with nobody to draw has no draw and no result.
    const undrawable = h2h && pairings === 0;
    const drawn = step !== "before-draw" && !undrawable;
    const played = (step === "after-scores" || step === "completed") && !undrawable;
    const meant: RoundStep = step === "completed" ? "completed" : undrawable ? "before-draw" : step;
    return {
      round: { id: "r1", label: "Round 1", type, format, playing: true, hasResult: played, matches: drawn ? pairings : 0, teeSheetSaved: h2h ? null : drawn, cutMadeAfter: false },
      meant,
    };
  }

  const invariants = (v: RoundVerdict, at: string, type: string) => {
    if (v.ok) return;
    expect(v.says.trim().length, `${at}: a refusal in words`).toBeGreaterThan(10);
    expect(v.wayOut.href, `${at}: a way out to a screen`).toMatch(/^\//);
    expect(v.says, `${at}: never a correction over scores`).not.toMatch(/committee correction/i);
    // A made cut is undone where it is made — reopening the round on Rounds & formats.
    const scoresWayOut = /^The cut after /.test(v.says) ? "/stages" : type === "Bracket Stage" ? "/bracket" : "/entry";
    expect(v.wayOut.href, `${at}: the way out of its step`).toBe(v.step === "completed" ? "/dashboard" : scoresWayOut);
  };

  const PAIRS = STAGE_TYPES.flatMap((type) => GOLF_FORMATS.filter((f) => formatFitsRound(type, f.name)).map((f) => ({ type, format: f.name })));

  it("CONTROL: the sweep has both kinds of round to judge — cards and matches, in more than one type", () => {
    expect(PAIRS.some((p) => matchesFiled(p.type, p.format))).toBe(true);
    expect(PAIRS.some((p) => !matchesFiled(p.type, p.format))).toBe(true);
    expect(new Set(PAIRS.map((p) => p.type)).size).toBeGreaterThan(2);
  });

  for (const { type, format } of PAIRS) {
    const matches = matchesFiled(type, format);
    const fitting = GOLF_FORMATS.filter((f) => f.name !== format && formatFitsRound(type, f.name)).map((f) => f.name);
    // The format it would become: one of the OTHER draw where the type allows it (a re-draw), else one of the same.
    const other = fitting.find((f) => matchesFiled(type, f) !== matches);
    const to = other ?? fitting[0];
    for (const step of STEPS) {
      for (const n of [1, 2, 3, 8, 28]) {
        it(`${type} · ${format} · ${step} · ${n} in the field`, () => {
          const { round: base, meant } = roundAt(type, format, step, n);
          // A cut can only have been made OUT of a played round of cards (`cutHasBeenMade`: individual stroke rounds, the feeder closed).
          const cuts = base.hasResult && !matches ? [false, true] : [false];
          for (const cut of cuts) {
            const round = { ...base, cutMadeAfter: cut };
            for (const status of step === "completed" ? ["completed"] : ["draft", "live"]) {
              const facts = { status, round };
              const at = `${status}${cut ? " · cut made after it" : ""}`;
              expect(roundStepOf(facts), `${at}: the round stands in the step meant`).toBe(meant);
              for (const k of ["allowance", "round-tees", "holes", "delete", "day"] as const) {
                const v = roundChangeAllowed(facts, { kind: k });
                expect(kind(v), `${at}: ${k}`).toBe(want(k, meant, matches, false, cut));
                invariants(v, `${at}: ${k}`, type);
              }
              if (to) {
                const v = roundChangeAllowed(facts, { kind: "format", to });
                expect(kind(v), `${at}: format → ${to}`).toBe(want("format", meant, matches, other !== undefined, cut));
                invariants(v, `${at}: format`, type);
              }
              // The tournament's tees, over a tournament of this one round.
              const across = acrossRounds({ status, rounds: [{ ...STATUS_FAMILIES.stroke().rounds[0], ...round }] }, { kind: "field-tees" }, new Set(cut ? ["r1"] : []));
              expect(kind(across), `${at}: field tees`).toBe(want("field-tees", meant, matches, false, cut));
              // Never re-frozen (option C): a refusal names the round and the way out, in the rule's words.
              if (!across.ok && meant === "after-scores") expect(across.says, `${at}: field tees refused in words`).toBe(teesFrozenWords("Round 1", type === "Bracket Stage" ? { what: "results", where: "on the Bracket" } : undefined));
              invariants(across, `${at}: field tees`, type);
            }
          }
        });
      }
    }
  }

  it("adding a round is refused only once completed, every family and step (section 3, 'Add a round')", () => {
    for (const family of Object.keys(STATUS_FAMILIES) as Family[]) {
      const base = STATUS_FAMILIES[family]();
      const played = { ...launchedFacts(base), rounds: base.rounds.map((r) => ({ ...r, hasResult: true })) };
      for (const [f, refused] of [
        [{ ...base, status: "draft", configUnlocked: false }, false],
        [launchedFacts(base), false],
        [played, false],
        [{ ...played, status: "completed" }, true],
      ] as const) {
        expect(addRoundLockOf(locksFor(lockFactsOf(f))) !== null, `${family} · ${f.status}`).toBe(refused);
      }
    }
  });
});

/**
 * "RECOMPUTE" IS THE RESOLVER'S OWN ANSWER, AND THE RULES' (J12, PR 7b; the
 * Golf Pro's Q2: warn, recompute and log). After scores an allowance change
 * re-prices every player off the figure FROZEN at the first card — the exact
 * Course Handicap, the allowance taken of it, rounded ONCE (Rules of
 * Handicapping, Rule 6.1 and 6.2, Appendix C) — and the moves the audit line
 * names are exactly the players whose playing handicap changed.
 *
 * Worked by hand here from decimal indexes off one rated set (Slope 131,
 * Course Rating 72.4, Par 71): Course Handicap = Index × Slope ÷ 113 +
 * (Course Rating − Par), never rounded before the allowance. Every format that
 * takes an individual allowance, on every type that plays it on cards, field
 * sizes from one.
 */
describe("an allowance changed after play re-prices off the frozen figure, by the Rules (J12)", () => {
  const SLOPE = 131;
  const RATING = 72.4;
  const PAR = 71;
  const exactOf = (index: number) => (index * SLOPE) / 113 + (RATING - PAR);
  /** Rounded once, .5 up (Rule 6.1 — the figure is never negative in these fields). */
  const once = (x: number) => Math.floor(x + 0.5);
  const indexes = (n: number) => Array.from({ length: n }, (_, i) => Number(((i % 10) * 4.3 + 0.6).toFixed(1)));

  const CARDS = [
    { type: "Stroke Play Round", format: "Stroke Play" },
    { type: "Stroke Play Round", format: "Stableford" },
    { type: "Round Robin", format: "Stroke Play" },
  ];

  for (const { type, format } of CARDS) {
    for (const n of [1, 2, 3, 8, 28]) {
      it(`${type} · ${format} · ${n} in the field: 95% → 85% moves exactly the players the Rules move`, () => {
        // After scores, a round of cards: the rule asks and lets it through to be worked out again.
        const v = roundChangeAllowed({ status: "live", round: { id: "r1", label: "Round 1", type, format, playing: true, hasResult: true, matches: 0, teeSheetSaved: true, cutMadeAfter: false } }, { kind: "allowance" });
        expect(v).toEqual({ ok: true, scope: "rounds", step: "after-scores", warn: "rescore" });

        const field = indexes(n).map((index, i) => {
          const exact = exactOf(index);
          return { playerId: `p${i}`, row: { frozen: once(exact), frozenExact: exact, frozenParStrokes: 0, override: null }, exact };
        });
        const priced = (allowance: number) =>
          field.map((p) => ({
            playerId: p.playerId,
            // The member's live figures are deliberately wrong: a frozen round must not read them.
            figure: playingHandicapInRound({ format, type, scoringBasis: "net", handicapAllowance: allowance }, p.row, { whole: 99, exact: 99, parStrokes: 7 }),
          }));
        const before = priced(95);
        const after = priced(85);
        expect(before.map((p) => p.figure)).toEqual(field.map((p) => once((p.exact * 95) / 100)));
        expect(after.map((p) => p.figure)).toEqual(field.map((p) => once((p.exact * 85) / 100)));
        const hand = field
          .map((p) => ({ playerId: p.playerId, from: once((p.exact * 95) / 100), to: once((p.exact * 85) / 100) }))
          .filter((m) => m.from !== m.to);
        expect(handicapMoves(before, after)).toEqual(hand);
      });
    }
  }

  /**
   * THE CONSTANT-OFFSET CHECK: one player whole, against the Rules by hand, so
   * a re-pricing that rounded the Course Handicap first (16 → 85% = 13.6 → 14)
   * or took the live figure instead of the frozen one cannot pass on the cells
   * agreeing with each other. Index 12.4: 12.4 × 131 ÷ 113 = 14.3752…; + 1.4 =
   * 15.7752…; 95% = 14.986… → 15; 85% = 13.408… → 13.
   */
  it("one row by hand: index 12.4 plays off 15 at 95% and 13 at 85%, and the move says 15 → 13", () => {
    const row = { frozen: 16, frozenExact: 15.775221238938052, frozenParStrokes: 0, override: null };
    const at = (allowance: number) => playingHandicapInRound({ format: "Stroke Play", type: "Stroke Play Round", scoringBasis: "net", handicapAllowance: allowance }, row, { whole: 0, exact: 0, parStrokes: 0 });
    expect(at(95)).toBe(15);
    expect(at(85)).toBe(13);
    expect(handicapMoves([{ playerId: "p", figure: at(95) }], [{ playerId: "p", figure: at(85) }])).toEqual([{ playerId: "p", from: 15, to: 13 }]);
  });
});

/**
 * THE ALLOWANCE A ROUND PLAYS AT, ON EVERY FORMAT x EVERY STAGE TYPE x EVERY
 * FIELD SIZE, AGAINST APPENDIX C HELD HERE (the accuracy sweep, 2026-11-09).
 *
 * The first block of this file sweeps every format on every stage type for
 * COHERENCE and asserts no figure. `round-allowance.test.ts` pins Four-Ball's
 * two figures and reads the rest off the format table — the code's own route.
 * This cell holds the Rules of Handicapping, Appendix C (2024), as its OWN
 * table, and asks the one reader (`recommendedAllowance(format, stage.type)`)
 * for every cell: a four-ball is 85 in a medal and 90 in a match, and nothing
 * else in the catalogue moves with the round.
 *
 * Then a VALUE at every field size from ONE: each individual net format,
 * on every stage type, prices a field of decimal indexes (plus handicaps
 * included) through `playingHandicapInRound` — what the board prices a round
 * with — and every player must play off the Rule worked in WHOLE NUMBERS
 * (an index in tenths, everything over 1130 x 100), sharing neither formula
 * nor floating point with `domain/handicap.ts`.
 *
 * And which formats give the strokes for tees of a higher par (Rule 6.2b), by
 * format and by the basis a round is set to.
 */
describe("the allowance a round plays at, on every format, stage type and field size, against Appendix C", () => {
  /** Appendix C, held here. `match` is the figure where the round is head-to-head. */
  const APPENDIX_C: Record<string, { stroke: number; match: number; weights?: Record<number, number[]> }> = {
    "Match Play": { stroke: 100, match: 100 }, // individual match play
    "Stroke Play": { stroke: 95, match: 95 }, // individual stroke play (a medal, wherever it is held)
    Stableford: { stroke: 95, match: 95 }, // individual Stableford
    "Modified Stableford": { stroke: 95, match: 95 }, // individual Stableford, a committee's table
    Nassau: { stroke: 100, match: 100 }, // three individual matches
    "Four-Ball": { stroke: 85, match: 90 }, // four-ball stroke play / match play
    // A pair counting its better ball is a four-ball: 85 / 90 (moved here from the
    // departures on 2026-11-09). Best 1 of 4 (75%) and 3 of 4 (100%) at stroke play
    // still play 85 — `docs/deferred-register.md`, "Best Ball plays at 85%".
    "Best Ball": { stroke: 85, match: 90 },
    Foursomes: { stroke: 50, match: 50 }, // 50% of the combined
    "Alternate Shot": { stroke: 50, match: 50 }, // foursomes by another name
    Greensomes: { stroke: 100, match: 100, weights: { 2: [60, 40] } }, // 60% low + 40% high
    "Chapman / Pinehurst": { stroke: 100, match: 100, weights: { 2: [60, 40] } },
    Scramble: { stroke: 25, match: 25, weights: { 2: [35, 15], 3: [30, 20, 10], 4: [25, 20, 15, 10] } },
    "Texas Scramble": { stroke: 25, match: 25, weights: { 2: [35, 15], 3: [30, 20, 10], 4: [25, 20, 15, 10] } },
  };
  /**
   * Formats Appendix C does not name, at the figure the app states for them and
   * says is a convention or carries no allowance of its own. Held so that a
   * format added to the catalogue must be placed in one table or the other.
   */
  const NO_PUBLISHED_FIGURE: Record<string, number> = { Skins: 100, Shamble: 85, "Other (scored by hand)": 100 };
  /**
   * KNOWN DEPARTURES FROM APPENDIX C — asserted to be STILL THERE, so that the
   * day one is fixed this list goes red and the cell moves into the table.
   * Empty since 2026-11-09, when Best Ball in a match went to 90% (it held
   * `{ format: "Best Ball", headToHead: true, app: 85, rules: 90 }`).
   */
  const KNOWN_DEPARTURES: Array<{ format: string; headToHead: boolean; app: number; rules: number }> = [];

  it("CONTROL: every format in the catalogue is in exactly one table, and both kinds of round exist", () => {
    for (const f of FORMAT_NAMES) {
      const placed =
        Number(f in APPENDIX_C) + Number(f in NO_PUBLISHED_FIGURE) + Number(KNOWN_DEPARTURES.some((d) => d.format === f));
      expect(placed, `${f} is placed ${placed} times`).toBe(1);
    }
    expect(STAGE_TYPES.some((t) => isHeadToHead(t))).toBe(true);
    expect(STAGE_TYPES.some((t) => !isHeadToHead(t))).toBe(true);
  });

  for (const format of FORMAT_NAMES) {
    for (const type of STAGE_TYPES) {
      it(`${format} on a ${type}`, () => {
        const h2h = isHeadToHead(type);
        const got = recommendedAllowance(format, type);
        const rule = APPENDIX_C[format];
        if (rule) {
          expect(got, `${format} on a ${type}`).toBe(h2h ? rule.match : rule.stroke);
          expect(findFormat(format).weightsBySideSize, `${format}'s shares`).toEqual(rule.weights);
          return;
        }
        if (format in NO_PUBLISHED_FIGURE) {
          expect(got).toBe(NO_PUBLISHED_FIGURE[format]);
          return;
        }
        const d = KNOWN_DEPARTURES.find((k) => k.format === format && k.headToHead === h2h)!;
        expect(got, `${format} on a ${type}: if this now gives ${d.rules}, move it into APPENDIX_C`).toBe(d.app);
      });
    }
  }

  /** Round half up, in integers: floor((2 x num + den) / (2 x den)). */
  const roundHalfUp = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));
  /** Off 131 / 72.3 / par 72; indexes from plus 3.0, in tenths. */
  const SLOPE = 131;
  const CR10 = 723;
  const PAR = 72;
  const indexTenths = (i: number) => ((i * 137) % 420) - 30;
  const INDIVIDUAL_NET = GOLF_FORMATS.filter((f) => f.sideSize === 1 && !f.manual).map((f) => f.name);

  it("CONTROL: the field walks plus handicaps and decimals, and there are individual formats to price", () => {
    const sample = FIELD_SIZES.flatMap((n) => Array.from({ length: n }, (_, i) => indexTenths(i)));
    expect(sample.some((t) => t < 0)).toBe(true);
    expect(sample.some((t) => t % 10 !== 0)).toBe(true);
    expect(INDIVIDUAL_NET.length).toBeGreaterThanOrEqual(5);
  });

  for (const format of INDIVIDUAL_NET) {
    for (const type of STAGE_TYPES) {
      it(`${format} on a ${type}: every player at every field size plays off the Rule`, () => {
        const pct = recommendedAllowance(format, type);
        for (const n of FIELD_SIZES) {
          for (let i = 0; i < n; i += 1) {
            const t = indexTenths(i);
            const rated = { slopeRating: SLOPE, courseRating: CR10 / 10, par: PAR };
            const exact = courseHandicapExact(t / 10, rated);
            const playing = playingHandicapInRound(
              { format, type, scoringBasis: "net", handicapAllowance: 0 },
              null,
              { whole: courseHandicap(t / 10, rated), exact, parStrokes: 0 },
            );
            // Course Handicap x 1130 = t x Slope + (CR10 - 10 x Par) x 113; then x pct / 100.
            const num = (t * SLOPE + (CR10 - 10 * PAR) * 113) * pct;
            expect(playing, `${format}, ${type}, field of ${n}, index ${t / 10}`).toBe(roundHalfUp(num, 1130 * 100));
          }
        }
      });
    }
  }

  it("the strokes for a higher par (6.2b): stroke and match play in strokes, never points, never a shared ball", () => {
    const GIVES: Record<string, boolean> = {
      "Match Play": true,
      "Stroke Play": true,
      Stableford: false,
      "Modified Stableford": false,
      Skins: true,
      Nassau: true,
      "Four-Ball": true,
      "Best Ball": true,
      Shamble: true,
      // A shared ball: not decided (`docs/deferred-register.md`), nought for now.
      Foursomes: false,
      "Alternate Shot": false,
      "Chapman / Pinehurst": false,
      Greensomes: false,
      Scramble: false,
      "Texas Scramble": false,
      "Other (scored by hand)": false,
    };
    for (const format of FORMAT_NAMES) {
      expect(format in GIVES, `${format} is not in the table`).toBe(true);
      expect(parStrokesApply(format, "net"), `${format}, net`).toBe(GIVES[format]);
      expect(parStrokesApply(format, "gross"), `${format}, gross`).toBe(GIVES[format]);
      // Set to points, every round is counted against par and gives none (6.2b).
      expect(parStrokesApply(format, "stableford"), `${format}, Stableford`).toBe(false);
      expect(parStrokesApply(format, "modified-stableford"), `${format}, Modified Stableford`).toBe(false);
    }
  });
});

/**
 * A NET TIE COUNTED BACK BY FRACTIONS OF THE HANDICAP, AT EVERY FIELD SIZE AND
 * BOTH HOLE COUNTS (2026-11-09).
 *
 * Committee Procedures 5A(7): in a handicap stroke-play competition the last 9,
 * 6, 3 and 1 holes are compared after taking off ½, ⅓, ⅙ and 1/18 of the
 * handicap; a nine-hole round's last 6, 3 and 1 take ⅔, ⅓ and 1/9 — holes
 * counted over holes played. The FRACTIONS table below is written as the
 * guidance writes it, not derived from the code's `n / holes`.
 *
 * Every player in a field finishes on the SAME net total (gross = par +
 * playing handicap, the extra strokes spread differently per player), so every
 * pair is a tie the countback must break. Handicaps run from plus 2 up, and the
 * playing handicap is recovered from the card itself (gross less net), as the
 * board does. Invariants: the order is the table's, it is antisymmetric, and a
 * player is level with themselves. Control: somewhere in the sweep the
 * hole-by-hole method gives a different answer, or the cell could not tell the
 * two apart.
 */
describe("a net tie counted back by fractions of the handicap, at every field size and hole count", () => {
  const FRACTIONS: Record<9 | 18, Array<[number, number]>> = {
    18: [[9, 1 / 2], [6, 1 / 3], [3, 1 / 6], [1, 1 / 18]],
    9: [[6, 2 / 3], [3, 1 / 3], [1, 1 / 9]],
  };
  let disagreements = 0;

  for (const H of [18, 9] as const) {
    // Stroke index 1..H spread round the card, as a club prints it.
    const si = Array.from({ length: H }, (_, j) => ((j * 7) % H) + 1);
    for (const n of FIELD_SIZES) {
      it(`${n} level on net over ${H} holes`, () => {
        const field = Array.from({ length: n }, (_, i) => {
          const playing = ((i * 5) % (H + 2)) - 2;
          const extra = Math.abs(playing);
          const gross = Array.from({ length: H }, (_, j) =>
            4 + (((j * 5 + i * 3) % H) < extra ? Math.sign(playing) : 0),
          );
          const net = gross.map((g, j) => g - holeStrokesReceived(playing, si[j], H));
          return { id: `p${i}`, playing, gross, net };
        });
        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
        for (const p of field) {
          expect(sum(p.net), `${p.id} is level on net`).toBe(4 * H);
          expect(countbackCardOn(p.id, { gross: p.gross, net: p.net, points: [] }, "net", "fractions").fractionOf).toBe(p.playing);
        }
        /** The guidance's order, negative when a is ahead: the first step whose figures differ. */
        const byTable = (a: (typeof field)[number], b: (typeof field)[number]) => {
          for (const [k, f] of FRACTIONS[H]) {
            const va = sum(a.gross.slice(H - k)) - a.playing * f;
            const vb = sum(b.gross.slice(H - k)) - b.playing * f;
            if (Math.abs(va - vb) > 1e-9) return Math.sign(va - vb);
          }
          return 0;
        };
        const card = (p: (typeof field)[number], how: "fractions" | "hole-by-hole") =>
          countbackCardOn(p.id, { gross: p.gross, net: p.net, points: [] }, "net", how);
        for (const a of field) {
          expect(countbackBetween(card(a, "fractions"), card(a, "fractions"), H).order).toBe(0);
          for (const b of field) {
            const ab = Math.sign(countbackBetween(card(a, "fractions"), card(b, "fractions"), H).order);
            const ba = Math.sign(countbackBetween(card(b, "fractions"), card(a, "fractions"), H).order);
            expect(ab, `${a.id} (${a.playing}) v ${b.id} (${b.playing}) over ${H}`).toBe(byTable(a, b));
            expect(ab + ba, "antisymmetric").toBe(0);
            if (Math.sign(countbackBetween(card(a, "hole-by-hole"), card(b, "hole-by-hole"), H).order) !== ab) disagreements += 1;
          }
        }
      });
    }
  }

  it("CONTROL: the sweep reaches ties the hole-by-hole countback decides differently", () => {
    expect(disagreements).toBeGreaterThan(0);
  });
});

/**
 * AN UPSTREAM EDIT TO THE TEE SHEET, EVERY ROUND TYPE × STEP × PUBLISHED × FIELD
 * SIZE (J12, state machine PR 7c; the proposal's test plan, "an upstream edit,
 * every scope × every step", for the tee-sheet row).
 *
 * The expectation is worked HERE from section 3's row and the ruling of 12 Nov,
 * never read off the function:
 *
 *   before the draw  open · after the draw  open · after scores  open (the groups that
 *   have started are held by their own locks) · completed  REFUSE, every change;
 *   a PUBLISHED sheet is changed and SAID: a save that publishes, a move, a place and a
 *   replace tell players ("told"); taking the sheet back, or saving it unpublished, hides it.
 *
 * Launch is not a step: every cell before completion runs both unlaunched and launched. A
 * round robin, a bracket or a cup session files its results as matches and has no stroke
 * "saved sheet" fact (null); it still has a sheet to move. Field sizes start at ONE: a field
 * of one is one group, so a re-draw that moves nobody tells nobody. Invariants in every cell:
 * the step meant; a refusal in words with a screen to go to, completion to the dashboard,
 * never a committee correction; the count the screen says is the notice's own diff.
 */
describe("an upstream edit to the tee sheet, every round type × step × published × field size (J12)", () => {
  const STEPS_7C: TeeSheetStep[] = ["before-draw", "after-draw", "after-scores", "completed"];
  const ASKS_7C: { ask: TeeSheetChangeAsk; told: boolean; hides: boolean; touchesGroups: boolean }[] = [
    { ask: { kind: "save", publish: true }, told: true, hides: false, touchesGroups: true },
    { ask: { kind: "save", publish: false }, told: false, hides: true, touchesGroups: true },
    { ask: { kind: "publish" }, told: false, hides: false, touchesGroups: false },
    { ask: { kind: "unpublish" }, told: false, hides: true, touchesGroups: false },
    { ask: { kind: "place" }, told: true, hides: false, touchesGroups: true },
    { ask: { kind: "move" }, told: true, hides: false, touchesGroups: true },
    { ask: { kind: "replace" }, told: true, hides: false, touchesGroups: true },
  ];
  /** A sheet of `n` players in fours, ten minutes apart — the Rules do not say how a club sends its groups out. */
  const sheetOf = (n: number): TeeSheet => ({
    savedAt: "t",
    startType: "tee-times",
    groups: Array.from({ length: Math.ceil(n / 4) }, (_, g) => ({
      name: `Group ${g + 1}`,
      startHole: 1,
      time: `${8 + Math.floor((g * 10) / 60)}:${String((g * 10) % 60).padStart(2, "0")} AM`,
      playerIds: Array.from({ length: Math.min(4, n - g * 4) }, (_, i) => `p${g * 4 + i}`),
    })),
  });

  it("CONTROL: the sweep has every round type, and a field that has more than one group", () => {
    expect(STAGE_TYPES.length).toBeGreaterThan(3);
    expect(sheetOf(28).groups).toHaveLength(7);
    expect(sheetOf(1).groups).toHaveLength(1);
  });

  for (const type of STAGE_TYPES) {
    for (const step of STEPS_7C) {
      for (const published of [false, true]) {
        for (const n of [1, 2, 3, 8, 28]) {
          it(`${type} · ${step} · ${published ? "published" : "not published"} · ${n} in the field`, () => {
            const h2h = ["Round Robin", "Single Match Stage", "Bracket Stage", "Team Session"].includes(type);
            // A sheet that has been drawn, or played, has a saved sheet; a round that has not been drawn has none.
            const drawn = step !== "before-draw";
            const round = {
              id: "r1",
              label: "Round 1",
              hasResult: step === "after-scores" || step === "completed",
              teeSheetSaved: h2h ? null : drawn,
              teeSheetPublished: published && drawn,
            };
            for (const status of step === "completed" ? ["completed"] : ["draft", "live"]) {
              const facts = { status, round };
              const at = `${status} · ${type}`;
              expect(teeSheetStepOf(facts), `${at}: the step meant`).toBe(h2h && step === "after-draw" ? "before-draw" : step);
              for (const { ask, told, hides, touchesGroups } of ASKS_7C) {
                const k = `${at} · ${ask.kind}`;
                const v = teeSheetChangeAllowed(facts, ask);
                if (step === "completed") {
                  expect(v.ok, `${k}: refused`).toBe(false);
                  if (v.ok) continue;
                  expect(v.says.trim().length, `${k}: in words`).toBeGreaterThan(10);
                  expect(v.says, `${k}: never a correction`).not.toMatch(/committee correction/i);
                  expect(v.wayOut.href, `${k}: completion goes to the dashboard`).toBe("/dashboard");
                  continue;
                }
                expect(v.ok, `${k}: open`).toBe(true);
                if (!v.ok) continue;
                const out = published && drawn;
                expect(v.warn, `${k}: said only over a sheet players were sent`).toBe(!out ? null : told ? "told" : hides ? "hidden" : null);
                expect(v.groupsDecide, `${k}: the groups decide in a round with scores`).toBe(step === "after-scores" && touchesGroups);
              }
              // The count the screen says is the notice's own: moving the last player into the first group tells exactly that player
              // (their group's time differs) — and nobody, where there is only the one group.
              const before = sheetOf(n);
              const moved = sheetOf(n);
              if (before.groups.length > 1) {
                const mover = moved.groups[moved.groups.length - 1].playerIds.pop()!;
                moved.groups[0].playerIds.push(mover);
                const lone = moved.groups[moved.groups.length - 1].playerIds.length === 0;
                if (lone) moved.groups.pop();
                expect(toldCount(before, moved), `${at}: one player moved, one player told`).toBe(1);
              } else {
                expect(toldCount(before, moved), `${at}: nobody moved, nobody told`).toBe(0);
              }
            }
          });
        }
      }
    }
  }
});
