import { describe, it, expect } from "vitest";
import {
  tournamentStatus,
  tournamentFamily,
  drawFacts,
  LOCK_SCOPES,
  type DrawFacts,
  type Family,
  type LockBy,
  type LockScope,
  type NextKind,
  type RoundFacts,
  type Step,
  type TournamentFacts,
  type TournamentStatus,
} from "../tournament-status";
import { buildBracket, flightKind } from "../bracket";
import type { BracketKind, Player } from "../types";
import { facts, round } from "./tournament-facts-fixtures";
import { roundChangeFactsOf, roundDoors } from "../round-change";
import { fieldChangeAllowed, fieldFactsOf } from "../field-change";
import { isKnockoutRound } from "../../stage-types";

/**
 * J13 — THE STATE MACHINE, FAMILY BY STAGE.
 *
 * `tournament-status.test.ts` pins one rule at a time. This file walks a whole
 * tournament of each of the nine families from the first screen of setup to the
 * day it is reopened, and at EVERY stage says three things: the step, what is
 * locked (scope by scope, and why), and the ONE next action. Then a second
 * block holds every stage of every walk to the dependency rules, so a stage added
 * to any walk is swept without a line more.
 *
 * HOW THE EXPECTED VALUES WERE WORKED. Not by calling the machine and copying.
 * Each is what a tournament director would say standing at the desk at that
 * moment, and the numbers a fixture needs come from the director's arithmetic,
 * not from a reader the app has:
 *
 *   a round robin of n players has n(n−1)/2 matches (every pair meets once);
 *   a knockout of n players has n−1 ties, played in rounds, and nobody is in a
 *     later round until the tie before it is decided (Rule 3.2: a match is won
 *     on the course or conceded, not by the draw being slow);
 *   a cup of P points is won by whoever first holds more than P/2 — so 8.5 of
 *     16, and 8–8 retains the cup for the holder (Ryder Cup practice);
 *   a league of c clubs meets in c/2 four-ball meetings a week.
 *
 * Knockout draws are built with the REAL `buildBracket` and read with
 * `drawFacts`, played round by round by the higher seed, so "a round decided and
 * the next one TBD" is a bracket the app drew and not a number typed in.
 *
 * A stage is a TournamentFacts value — pure, no database, no names of anybody.
 * Every name is invented.
 */

/* --------------------------------------------------------------- the helpers */

const BLANKET: readonly LockScope[] = ["details", "rounds", "field", "flights", "draw", "sides", "cup"];
type Locked = Partial<Record<LockScope, LockBy>>;
type RoundState = "not-started" | "under-way" | "closed";

const CHIP: Record<Step, string> = { "setting-up": "Setting up", live: "Live", "play-over": "Play over", completed: "Completed" };
const RANK: Record<Step, number> = { "setting-up": 0, live: 1, "play-over": 2, completed: 3 };

/** The scopes that are locked now, and by what — the part of the lock a director reads. */
function lockedNow(st: TournamentStatus): Locked {
  const out: Locked = {};
  for (const scope of LOCK_SCOPES) {
    const l = st.locks[scope];
    if (l.locked) out[scope] = l.by;
  }
  return out;
}

/** Every blanket scope locked by one reason; `except` stays open. */
function allBy(by: LockBy, except: LockScope[] = []): Locked {
  const scopes: readonly LockScope[] = by === "completed" ? [...BLANKET, "teeSheet"] : BLANKET; // a completed tournament shuts the tee sheet too (PR 7c)
  return Object.fromEntries(scopes.filter((s) => !except.includes(s)).map((s) => [s, by])) as Locked;
}

const live = (f: TournamentFacts): TournamentFacts => ({ ...f, status: "live", configUnlocked: false });
const done = (f: TournamentFacts): TournamentFacts => ({ ...f, status: "completed", configUnlocked: false });
/** Patch round i (in play order) with `patches[i]`; rounds past the list are untouched. */
const patch = (f: TournamentFacts, patches: Partial<RoundFacts>[]): TournamentFacts => ({
  ...f,
  rounds: f.rounds.map((r, i) => ({ ...r, ...(patches[i] ?? {}) })),
});
const everyRound = (f: TournamentFacts, p: Partial<RoundFacts>): TournamentFacts => ({ ...f, rounds: f.rounds.map((r) => ({ ...r, ...p })) });

interface Next {
  kind: NextKind;
  enabled: boolean;
  label?: string;
  /** The refusal, in place, when it is disabled. */
  blocked?: RegExp;
  /** Where the refusal is put right. */
  wayOut?: string;
  /** The confirm sentence; null = none; undefined = not checked. */
  asks?: RegExp | null;
}

interface Stage {
  name: string;
  f: TournamentFacts;
  step: Step;
  chip?: string;
  detail?: string;
  /** null = the machine offers no button at all (a casual round). */
  next: Next | null;
  locked: Locked;
  rounds?: RoundState[];
  /** A move backwards on purpose: reopening a completed tournament. */
  stepsBack?: true;
}

const ALL: { family: Family; stage: Stage }[] = [];

/** One tournament of `family`, walked stage by stage. */
function walk(family: Family, title: string, stages: Stage[]) {
  describe(`${family}: ${title}`, () => {
    for (const stage of stages) {
      ALL.push({ family, stage });
      it(stage.name, () => {
        const st = tournamentStatus(stage.f);
        expect(st.family).toBe(family);
        expect(st.step).toBe(stage.step);
        expect(st.chip).toBe(stage.chip ?? CHIP[stage.step]);
        expect(st.chipDetail).toBe(stage.detail ?? "");
        if (stage.next === null) {
          expect(st.nextAction).toBeNull();
        } else {
          const n = st.nextAction;
          expect(n, "a next action").not.toBeNull();
          expect(n!.kind).toBe(stage.next.kind);
          expect(n!.enabled).toBe(stage.next.enabled);
          if (stage.next.label !== undefined) expect(n!.label).toBe(stage.next.label);
          if (stage.next.enabled) {
            expect(n!.disabledBecause).toBeNull();
            expect(n!.wayOut).toBeNull();
          } else {
            expect(n!.disabledBecause).not.toBeNull();
            if (stage.next.blocked) expect(n!.disabledBecause).toMatch(stage.next.blocked);
            if (stage.next.wayOut) expect(n!.wayOut?.href).toBe(stage.next.wayOut);
          }
          if (stage.next.asks === null) expect(n!.asks).toBeNull();
          else if (stage.next.asks) expect(n!.asks).toMatch(stage.next.asks);
        }
        expect(lockedNow(st)).toEqual(stage.locked);
        if (stage.rounds) expect(st.rounds.map((r) => r.state)).toEqual(stage.rounds);
      });
    }

    it("only ever moves forward — setting up, live, play over, completed — except a deliberate reopen", () => {
      let prev: Step | null = null;
      for (const stage of stages) {
        const step = tournamentStatus(stage.f).step;
        if (prev !== null && !stage.stepsBack) expect(RANK[step], `${stage.name}: ${prev} -> ${step}`).toBeGreaterThanOrEqual(RANK[prev]);
        prev = step;
      }
    });
  });
}

const launch: Next = { kind: "launch", enabled: true, label: "Launch tournament" };
const reopen: Next = { kind: "reopen", enabled: true, label: "Reopen tournament" };
const nothingScored: Next = { kind: "complete", enabled: false, blocked: /^Nothing has been scored yet/, wayOut: "/entry" };

/* ---------------------------------------------------------------- stroke play */

/**
 * A 36-HOLE CLUB CHAMPIONSHIP, 24 players, one division. Rule 3.3: the Committee
 * sets the number of rounds in the Terms and the result is the total; Rule
 * 3.3b(2): a round is complete when the score is returned and signed off. So:
 * Live until the Committee has closed both rounds, "Play over" then, and only the
 * Committee's Complete releases the result.
 */
const medal = (over: Partial<TournamentFacts> = {}): TournamentFacts =>
  facts({ confirmed: 24, groups: 0, rounds: [round({ id: "r1", position: 0 }), round({ id: "r2", position: 1 })], ...over });
const medalPlayedOut = (): TournamentFacts => everyRound(live(medal()), { hasResult: true, closed: true });

walk("stroke", "a 36-hole club championship from first screen to reopened", [
  { name: "no dates yet: Launch is there, refused in place, and points at the details", f: medal({ dated: false }), step: "setting-up", next: { kind: "launch", enabled: false, blocked: /no dates/, wayOut: "/event" }, locked: {} },
  { name: "set up: Launch is allowed and nothing is locked", f: medal(), step: "setting-up", next: launch, locked: {} },
  { name: "launched, before a ball is struck: Complete is there but refused — nothing to release", f: live(medal()), step: "live", next: nothingScored, locked: allBy("launch"), rounds: ["not-started", "not-started"] },
  {
    name: "round 1 under way: Complete is allowed and asks about the round nobody has played",
    f: patch(live(medal()), [{ hasResult: true }]),
    step: "live",
    next: { kind: "complete", enabled: true, asks: /^Round 2 has no scores\. Completing will close it as not played/ },
    locked: allBy("launch"),
    rounds: ["under-way", "not-started"],
  },
  {
    name: "the committee unlocks setup mid-round to correct an entry: still live, the blanket lock is open",
    f: { ...patch(live(medal()), [{ hasResult: true }]), configUnlocked: true },
    step: "live",
    next: { kind: "complete", enabled: true },
    locked: {},
  },
  {
    name: "round 1 closed, round 2 under way: nothing left to ask about",
    f: patch(live(medal()), [{ hasResult: true, closed: true }, { hasResult: true }]),
    step: "live",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["closed", "under-way"],
  },
  {
    name: "both rounds closed: play over, and the second line says why and that nothing is released",
    f: medalPlayedOut(),
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["closed", "closed"],
  },
  {
    name: "play over with a card awaiting sign-off: Complete is refused and points at Score entry (Rule 3.3b(2))",
    f: { ...medalPlayedOut(), review: { pendingConfirmations: 1, disputed: 0 } },
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: false, blocked: /waiting to be signed off/, wayOut: "/entry" },
    locked: allBy("launch"),
  },
  {
    name: "play over with a disputed result: the Committee owes a ruling before anything is signed (Rule 20.1c)",
    f: { ...medalPlayedOut(), review: { pendingConfirmations: 3, disputed: 1 } },
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: false, blocked: /1 result is disputed/, wayOut: "/entry" },
    locked: allBy("launch"),
  },
  { name: "completed: Reopen is the one action, and everything is locked by completion", f: done(medalPlayedOut()), step: "completed", next: reopen, locked: allBy("completed"), rounds: ["closed", "closed"] },
  {
    name: "reopened to fix a score: live again, the rounds still closed, so play is over and Complete is back",
    f: medalPlayedOut(),
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
    stepsBack: true,
  },
]);

/* ------------------------------------------------------------------ Stableford */

/**
 * A SATURDAY STABLEFORD, 18 players in three handicap divisions. The Terms may
 * set divisions (CP 5A) but one field is a whole competition too; a player left
 * out of the divisions is a thing to say, never a reason to refuse the start.
 */
const stableford = (over: Partial<TournamentFacts> = {}): TournamentFacts =>
  facts({ confirmed: 18, groups: 3, rounds: [round({ id: "r1", position: 0, format: "Stableford", stableford: true })], ...over });

walk("stableford", "a one-day Stableford in three divisions", [
  { name: "set up: Launch is allowed", f: stableford(), step: "setting-up", next: launch, locked: {} },
  {
    name: "one player in no division: Launch is still allowed, and the warning names it",
    f: stableford({ unplacedInFlights: 1 }),
    step: "setting-up",
    next: launch,
    locked: {},
  },
  { name: "launched: Complete refused until a card is in", f: live(stableford()), step: "live", next: nothingScored, locked: allBy("launch"), rounds: ["not-started"] },
  {
    name: "first cards in, the round still open: Complete allowed, nothing to ask (the only round has scores)",
    f: patch(live(stableford()), [{ hasResult: true }]),
    step: "live",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["under-way"],
  },
  {
    name: "the round closed: play over",
    f: patch(live(stableford()), [{ hasResult: true, closed: true }]),
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
  },
  { name: "completed", f: done(patch(stableford(), [{ hasResult: true, closed: true }])), step: "completed", next: reopen, locked: allBy("completed") },
  {
    name: "reopened",
    f: patch(live(stableford()), [{ hasResult: true, closed: true }]),
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
    stepsBack: true,
  },
]);

/* ----------------------------------------------------------------- single match */

/**
 * THE CLUB FINAL, ONE 18-HOLE MATCH BETWEEN TWO PLAYERS. A match is over the
 * moment it cannot be caught (Rule 3.2a(1): won by the player ahead by more holes
 * than remain), or on a concession (3.2b) — before the 18th, and whether or not
 * the Committee has closed the round. Level after 18 is NOT over (3.2a(4)): the
 * match goes on, hole by hole.
 */
const matchRound = (over: Partial<RoundFacts> = {}): RoundFacts =>
  round({ id: "m1", position: 0, type: "Single Match Stage", format: "Match Play", matches: 1, teeSheetSaved: null, ...over });
const duel = (over: Partial<TournamentFacts> = {}): TournamentFacts => facts({ confirmed: 2, groups: 1, rounds: [matchRound()], ...over });
/** 3&2: the match stood level for a time, then one player went three up with two to play. */
const duelOver = (): TournamentFacts => patch(live(duel()), [{ hasResult: true, matchesOver: 1 }]);

walk("match", "the club final, two players", [
  { name: "only one player entered: a match of one has nothing to play, and the way out is Entries", f: duel({ confirmed: 1 }), step: "setting-up", next: { kind: "launch", enabled: false, blocked: /^A match needs two players/, wayOut: "/registration" }, locked: {} },
  { name: "two entered but the match not made: refused, the way out is Rounds & formats", f: patch(duel(), [{ matches: 0 }]), step: "setting-up", next: { kind: "launch", enabled: false, blocked: /no match made yet/, wayOut: "/stages" }, locked: {} },
  { name: "the match made: Launch is allowed", f: duel(), step: "setting-up", next: launch, locked: {} },
  { name: "launched, no hole played: Complete refused", f: live(duel()), step: "live", next: nothingScored, locked: allBy("launch"), rounds: ["not-started"] },
  {
    name: "in progress, level (or one up with holes to play): live, not over — Rule 3.2a(4)",
    f: patch(live(duel()), [{ hasResult: true, matchesOver: 0 }]),
    step: "live",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["under-way"],
  },
  {
    name: "won 3&2 with the round not closed: play over — the match is over, the Committee has not closed it",
    f: duelOver(),
    step: "play-over",
    detail: "Every match over · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["under-way"],
  },
  {
    name: "the round closed as well: still play over",
    f: patch(duelOver(), [{ closed: true }]),
    step: "play-over",
    detail: "Every match over · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
    rounds: ["closed"],
  },
  { name: "completed", f: done(patch(duelOver(), [{ closed: true }])), step: "completed", next: reopen, locked: allBy("completed") },
  {
    name: "reopened (the result was wrong): play over again, Complete back",
    f: patch(duelOver(), [{ closed: true }]),
    step: "play-over",
    detail: "Every match over · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
    stepsBack: true,
  },
]);

/** HOME AND AWAY, TWO MATCHES: the first over means nothing while the second is not even made. */
const twoLegs = (over: Partial<TournamentFacts> = {}): TournamentFacts =>
  facts({ confirmed: 2, groups: 1, rounds: [matchRound({ id: "m1", position: 0 }), matchRound({ id: "m2", position: 1 })], ...over });

walk("match", "a two-leg series: every match must be over, not the first", [
  {
    name: "leg 1 won, leg 2 not yet made: live — a series is not over on one leg",
    f: patch(live(twoLegs()), [{ hasResult: true, matchesOver: 1 }, { matches: 0 }]),
    step: "live",
    next: { kind: "complete", enabled: true, asks: /^Round 2 has no scores/ },
    locked: allBy("launch"),
  },
  {
    name: "leg 2 made, nobody has teed off: still live",
    f: patch(live(twoLegs()), [{ hasResult: true, matchesOver: 1 }]),
    step: "live",
    next: { kind: "complete", enabled: true, asks: /^Round 2 has no scores/ },
    locked: allBy("launch"),
  },
  {
    name: "both legs over: play over, whoever closed what",
    f: patch(live(twoLegs()), [{ hasResult: true, matchesOver: 1 }, { hasResult: true, matchesOver: 1 }]),
    step: "play-over",
    detail: "Every match over · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
  },
]);

/* ----------------------------------------------------------- round robin in flights */

/**
 * NINE PLAYERS, TWO FLIGHTS OF FOUR AND FIVE. Every pair in a flight meets once:
 * n(n−1)/2 — six in the four, ten in the five, sixteen in all. Without flights
 * there are no fixtures; a player in no flight has no matches. Play is over when
 * the Committee has closed the round (not when the last match merely ends: a
 * late concession or a dispute can still move a result).
 */
const pairs = (n: number) => (n * (n - 1)) / 2;
const flightMatches = (sizes: number[]) => sizes.reduce((sum, n) => sum + pairs(n), 0);
const rrRound = (matches: number, over: Partial<RoundFacts> = {}): RoundFacts =>
  round({ id: "rr1", position: 0, type: "Round Robin", format: "Match Play", drawsPairings: true, matches, teeSheetSaved: null, ...over });
const rr = (over: Partial<TournamentFacts> = {}): TournamentFacts =>
  facts({ confirmed: 9, groups: 2, rounds: [rrRound(flightMatches([4, 5]))], ...over });

walk("roundRobinFlights", "nine players in a four and a five", [
  {
    name: "no flights and no pairings: refused, and the way out is Flights",
    f: facts({ confirmed: 9, groups: 0, rounds: [rrRound(0)] }),
    step: "setting-up",
    next: { kind: "launch", enabled: false, blocked: /no pairings/, wayOut: "/grouping" },
    locked: {},
  },
  {
    name: "flights made but the pairings not generated: refused",
    f: rr({ rounds: [rrRound(0)] }),
    step: "setting-up",
    // Rounds & formats, where the refusal says Generate is (PR 5c review) — it was Flights, which has no Generate button.
    next: { kind: "launch", enabled: false, blocked: /^Round 1 has no pairings/, wayOut: "/stages" },
    locked: {},
  },
  {
    name: "a four and a four with one player in no flight: refused — no flight, no matches",
    f: rr({ unplacedInFlights: 1, rounds: [rrRound(flightMatches([4, 4]))] }),
    step: "setting-up",
    next: { kind: "launch", enabled: false, blocked: /^1 player is in no flight, so they have no matches/, wayOut: "/grouping" },
    locked: {},
  },
  { name: "flights made and every pair drawn: Launch is allowed", f: rr(), step: "setting-up", next: launch, locked: {} },
  { name: "launched, no match played: Complete refused", f: live(rr()), step: "live", next: nothingScored, locked: allBy("launch"), rounds: ["not-started"] },
  {
    name: "seven of sixteen matches over: live",
    f: patch(live(rr()), [{ hasResult: true, matchesOver: 7 }]),
    step: "live",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["under-way"],
  },
  {
    name: "all sixteen matches over but the round not closed: still live — closing is the Committee's act",
    f: patch(live(rr()), [{ hasResult: true, matchesOver: 16 }]),
    step: "live",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
  },
  {
    name: "the round closed: play over",
    f: patch(live(rr()), [{ hasResult: true, matchesOver: 16, closed: true }]),
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["closed"],
  },
  { name: "completed", f: done(patch(rr(), [{ hasResult: true, matchesOver: 16, closed: true }])), step: "completed", next: reopen, locked: allBy("completed") },
  {
    name: "reopened",
    f: patch(live(rr()), [{ hasResult: true, matchesOver: 16, closed: true }]),
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
    stepsBack: true,
  },
]);

walk("roundRobinFlights", "a second round added after launch needs its pairings drawn", [
  {
    name: "round 1 closed, round 2 added with no pairings: the next action is to draw them",
    f: {
      ...live(rr()),
      rounds: [rrRound(flightMatches([4, 5]), { hasResult: true, closed: true }), rrRound(0, { id: "rr2", position: 1 })],
    },
    step: "live",
    next: { kind: "draw", enabled: true, label: "Generate Round 2 pairings" },
    locked: allBy("launch"),
  },
  {
    name: "pairings drawn: back to Complete (round 2 is unplayed, so it asks)",
    f: {
      ...live(rr()),
      rounds: [rrRound(flightMatches([4, 5]), { hasResult: true, closed: true }), rrRound(flightMatches([4, 5]), { id: "rr2", position: 1 })],
    },
    step: "live",
    next: { kind: "complete", enabled: true, asks: /^Round 2 has no scores/ },
    locked: allBy("launch"),
  },
]);

/* -------------------------------------------------------------------- knockout */

const players = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `zz-p${i + 1}`, name: `Zz Player ${i + 1}`, handicap: i, seed: i + 1 }));

/**
 * A DRAW PLAYED BY THE HIGHER SEED, ROUND BY ROUND, up to `rounds` rounds (all of
 * them when omitted). Each tie is decided only when both its places are filled —
 * a place in a later round is somebody or TBD.
 */
function results(kind: BracketKind, n: number, rounds = Infinity): Record<string, string> {
  const ps = players(n);
  const won: Record<string, string> = {};
  for (let r = 0; r < Math.min(rounds, 8); r += 1) {
    const view = buildBracket(kind, ps, won);
    for (const m of view.rounds[r]?.matches ?? []) {
      if (m.a.playerId && m.b.playerId && !m.winnerId) won[m.key] = (m.a.seed! < m.b.seed! ? m.a : m.b).playerId!;
    }
  }
  return won;
}

/** The draw as the machine is handed it, for a bracket of `n` played to `won`. */
const drawOf = (label: string, kind: BracketKind, n: number, won: Record<string, string> = {}): DrawFacts =>
  drawFacts({ label, view: buildBracket(kind, players(n), won) });

const koRound = (over: Partial<RoundFacts> = {}) => round({ id: "k1", position: 0, type: "Bracket Stage", format: "Match Play", teeSheetSaved: null, ...over });
const knockout = (n: number, won: Record<string, string> = {}, third: { on: boolean; decided: boolean } = { on: false, decided: false }, over: Partial<TournamentFacts> = {}): TournamentFacts =>
  facts({
    confirmed: n,
    groups: 0,
    rounds: [koRound({ hasResult: Object.keys(won).length > 0 })],
    knockout: { draws: [drawOf("", "winners", n, won)], thirdPlace: third },
    ...over,
  });

/** Eight players: 4 quarter-final ties, 2 semi-finals, 1 final — seven ties for eight players (n−1). */
const QF = results("winners", 8, 1);
const QF_SF = results("winners", 8, 2);
const ALL_TIES = results("winners", 8);

describe("knockout: the fixtures are the draw the stage names say they are", () => {
  it("eight players make seven ties, and the higher seed wins each (the director's count, n−1)", () => {
    expect(Object.keys(ALL_TIES)).toHaveLength(7);
    expect(Object.keys(QF)).toHaveLength(4);
    expect(Object.keys(QF_SF)).toHaveLength(6);
  });

  it("with the quarter-finals played, the final is TBD: nobody is in a later round until the tie before it is decided (Rule 3.2)", () => {
    const view = buildBracket("winners", players(8), QF);
    const final = view.rounds[2].matches[0];
    expect(final.a.playerId).toBeNull();
    expect(final.b.playerId).toBeNull();
    expect(view.champion).toBeNull();
    // The semi-finals are filled (their feeders are played) but not decided.
    expect(view.rounds[1].matches.every((m) => m.a.playerId && m.b.playerId && !m.winnerId)).toBe(true);
  });

  it("with only some quarter-finals played the semi-final is half-filled — still not decided", () => {
    const first = { "winners-0-0": "zz-p1", "winners-0-1": "zz-p4" };
    const view = buildBracket("winners", players(8), first);
    expect(view.rounds[1].matches[0].a.playerId).toBe("zz-p1");
    expect(view.rounds[1].matches[0].b.playerId).toBe("zz-p4");
    expect(view.rounds[1].matches[1].a.playerId).toBeNull();
  });
});

walk("knockout", "an eight-player club knockout, round by round", [
  { name: "one player entered: a knockout needs two", f: knockout(8, {}, undefined, { confirmed: 1 }), step: "setting-up", next: { kind: "launch", enabled: false, blocked: /^A knockout needs at least two players/, wayOut: "/registration" }, locked: {} },
  { name: "eight entered and drawn: Launch is allowed", f: knockout(8), step: "setting-up", next: launch, locked: {} },
  { name: "launched, draw made, no tie played: Complete refused", f: live(knockout(8)), step: "live", next: nothingScored, locked: allBy("launch"), rounds: ["not-started"] },
  {
    name: "two quarter-finals decided: live, the round is under way",
    f: live(knockout(8, { "winners-0-0": "zz-p1", "winners-0-1": "zz-p4" })),
    step: "live",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["under-way"],
  },
  {
    name: "every quarter-final decided, semi-finals drawn but not played, final TBD: live",
    f: live(knockout(8, QF)),
    step: "live",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
  },
  { name: "semi-finals decided, final not played: live — the Final decides the competition (Rule 3.2)", f: live(knockout(8, QF_SF)), step: "live", next: { kind: "complete", enabled: true }, locked: allBy("launch") },
  {
    name: "the Final decided, nobody closed anything: play over — a Bracket Stage is never closed",
    f: live(knockout(8, ALL_TIES)),
    step: "play-over",
    detail: "Final decided · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["under-way"],
  },
  { name: "completed", f: done(knockout(8, ALL_TIES)), step: "completed", next: reopen, locked: allBy("completed") },
  {
    name: "reopened (a result was entered the wrong way round): play over again",
    f: live(knockout(8, ALL_TIES)),
    step: "play-over",
    detail: "Final decided · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
    stepsBack: true,
  },
]);

walk("knockout", "with a play-off for third switched on (a Term the Committee may add)", [
  {
    name: "the Final decided but the play-off for third not played: live until it is",
    f: live(knockout(8, ALL_TIES, { on: true, decided: false })),
    step: "live",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
  },
  {
    name: "the play-off for third played too: play over",
    f: live(knockout(8, ALL_TIES, { on: true, decided: true })),
    step: "play-over",
    detail: "Final decided · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
  },
]);

walk("knockout", "two players are a Final and nothing else", [
  { name: "two entered: launchable — the minimum field", f: knockout(2), step: "setting-up", next: launch, locked: {} },
  { name: "launched, the Final unplayed: live", f: live(knockout(2)), step: "live", next: nothingScored, locked: allBy("launch") },
  {
    name: "the Final decided: play over, one final",
    f: live(knockout(2, results("winners", 2))),
    step: "play-over",
    detail: "Final decided · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
  },
]);

describe("knockout: every field from 2 to 17, played by the higher seed", () => {
  for (let n = 2; n <= 17; n += 1) {
    it(`${n} players: ${n - 1} ties; live until the Final, then play over`, () => {
      // The director's count, again: a draw of n has n−1 ties.
      expect(Object.keys(results("winners", n))).toHaveLength(n - 1);
      expect(tournamentStatus(live(knockout(n))).step).toBe("live");
      // Every round but the last played: no champion, so not over (the Final is the competition).
      const rounds = Math.ceil(Math.log2(n));
      const short = results("winners", n, rounds - 1);
      expect(tournamentStatus(live(knockout(n, short))).step, `${n} players, final unplayed`).toBe("live");
      expect(tournamentStatus(live(knockout(n, results("winners", n)))).step).toBe("play-over");
      expect(tournamentStatus(done(knockout(n, results("winners", n)))).step).toBe("completed");
    });
  }

  it("a knockout can be launched from two players and not from one, at any field size the sweep reaches", () => {
    expect(tournamentStatus(knockout(2)).refusals.launch).toBeNull();
    expect(tournamentStatus(knockout(17)).refusals.launch).toBeNull();
    expect(tournamentStatus(knockout(2, {}, undefined, { confirmed: 1 })).refusals.launch).not.toBeNull();
  });
});

/* ------------------------------------------------------------ knockout in flights */

/**
 * A BIG FIELD DIVIDED INTO FLIGHTS, EACH ITS OWN KNOCKOUT (knockouts doc). The
 * division IS the draw: it stays open after launch — a flighted club championship
 * can only be divided after the qualifying round, which is after launch — and
 * shuts at the first result in any flight. Over only when every flight with a tie
 * to play has its Final decided; a flight of one has no tie to play.
 */
const FLIGHT_KINDS = [flightKind(0), flightKind(1), flightKind(2)];
const flightsOf = (sizes: number[], upTo: (i: number) => number = () => 0): DrawFacts[] =>
  sizes.map((n, i) => drawOf(`Flight ${"ABC"[i]}`, FLIGHT_KINDS[i], n, upTo(i) === 0 ? {} : results(FLIGHT_KINDS[i], n, upTo(i))));
const fko = (draws: DrawFacts[], played: boolean, over: Partial<TournamentFacts> = {}): TournamentFacts =>
  facts({
    confirmed: 24,
    groups: 0,
    bracketMode: "flights",
    rounds: [koRound({ hasResult: played })],
    knockout: { draws, thirdPlace: { on: false, decided: false } },
    ...over,
  });
const wholeDraws = (sizes: number[]) => flightsOf(sizes, () => 8);
const EIGHTS = [8, 8, 8];
/** The draw scope stays open after launch until the first result. */
const openDraw = (by: LockBy) => allBy(by, ["draw"]);

walk("flightedKnockout", "24 players in three flights of eight", [
  { name: "set up: Launch is allowed, the division is open", f: fko(flightsOf(EIGHTS), false), step: "setting-up", next: launch, locked: {} },
  {
    name: "launched, division made, nothing played: everything is locked by launch EXCEPT the draw",
    f: live(fko(flightsOf(EIGHTS), false)),
    step: "live",
    next: nothingScored,
    locked: openDraw("launch"),
  },
  {
    name: "launched with the division not yet made (qualifying still to play): live, the draw open",
    f: live(fko([], false)),
    step: "live",
    next: nothingScored,
    locked: openDraw("launch"),
  },
  {
    name: "the first tie in Flight A decided: the draw locks BY RESULTS, which no correction opens",
    f: live(fko(flightsOf(EIGHTS, (i) => (i === 0 ? 1 : 0)), true)),
    step: "live",
    next: { kind: "complete", enabled: true },
    locked: { ...openDraw("launch"), draw: "results" },
  },
  {
    name: "Flight A's Final decided, B and C not: live",
    f: live(fko(flightsOf(EIGHTS, (i) => (i === 0 ? 3 : 1)), true)),
    step: "live",
    next: { kind: "complete", enabled: true },
    locked: { ...openDraw("launch"), draw: "results" },
  },
  {
    name: "A and B decided, C one round short: still live — all THREE Finals",
    f: live(fko(flightsOf(EIGHTS, (i) => (i < 2 ? 3 : 2)), true)),
    step: "live",
    next: { kind: "complete", enabled: true },
    locked: { ...openDraw("launch"), draw: "results" },
  },
  {
    name: "all three Finals decided: play over, every final",
    f: live(fko(wholeDraws(EIGHTS), true)),
    step: "play-over",
    detail: "Every final decided · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: { ...openDraw("launch"), draw: "results" },
  },
  { name: "completed: even the draw is locked, by completion", f: done(fko(wholeDraws(EIGHTS), true)), step: "completed", next: reopen, locked: allBy("completed") },
  {
    name: "reopened: the results are still there, so the draw stays locked BY RESULTS",
    f: live(fko(wholeDraws(EIGHTS), true)),
    step: "play-over",
    detail: "Every final decided · results not released",
    next: { kind: "complete", enabled: true },
    locked: { ...openDraw("launch"), draw: "results" },
    stepsBack: true,
  },
]);

walk("flightedKnockout", "17 players: a flight of one has no tie to play", [
  {
    name: "two flights of eight and a flight of one, the second flight's Final still to play: live",
    f: live(fko(flightsOf([8, 8, 1], (i) => (i === 0 ? 3 : i === 1 ? 2 : 0)), true, { confirmed: 17 })),
    step: "live",
    next: { kind: "complete", enabled: true },
    locked: { ...openDraw("launch"), draw: "results" },
  },
  {
    name: "both Finals decided: play over — the flight of one is not waited on for ever",
    f: live(fko(wholeDraws([8, 8, 1]), true, { confirmed: 17 })),
    step: "play-over",
    detail: "Every final decided · results not released",
    next: { kind: "complete", enabled: true },
    locked: { ...openDraw("launch"), draw: "results" },
  },
]);

describe("knockout in flights: the flight of one really has one player and no champion", () => {
  it("the draw the stage hands the machine says so", () => {
    const [, , c] = wholeDraws([8, 8, 1]);
    expect(c).toMatchObject({ entrants: 1, finalDecided: false });
  });
});

/* --------------------------------------------------------------------- team cup */

/**
 * A TWO-TEAM CUP, SIXTEEN PLAYERS, THREE SESSIONS: four fourball matches, four
 * foursomes matches, eight singles — sixteen points. The cup is won by the first
 * team to hold more than half the points (8.5), and 8–8 is a draw the holder
 * keeps. A decided cup is "Play over" even with sessions still unplayed: the
 * remaining matches no longer change who holds it.
 */
const CUP_POINTS = 4 + 4 + 8;
const cupWon = (a: number, b: number) => Math.max(a, b) > CUP_POINTS / 2;
const sessions = (): RoundFacts[] => [
  round({ id: "s1", position: 0, type: "Team Session", format: "Four-Ball", matches: 4, teeSheetSaved: null }),
  round({ id: "s2", position: 1, type: "Team Session", format: "Foursomes", matches: 4, teeSheetSaved: null }),
  round({ id: "s3", position: 2, type: "Team Session", format: "Singles", matches: 8, teeSheetSaved: null }),
];
const cup = (over: Partial<TournamentFacts> = {}): TournamentFacts =>
  facts({
    confirmed: 16,
    teams: { needed: true, sides: 0, unsided: 16 },
    cup: { flights: 2, unplaced: 0 },
    rounds: sessions(),
    ...over,
  });
/** The cup after `a` v `b` points, with the sessions in `closedThrough` closed and one more under way. */
const cupAt = (a: number, b: number, closedThrough: number, underWay: number | null): TournamentFacts =>
  patch(live(cup({ cupDecided: cupWon(a, b) })), sessions().map((_, i) => (i < closedThrough ? { hasResult: true, closed: true } : i === underWay ? { hasResult: true } : {})));

describe("team cup: the director's arithmetic", () => {
  it("16 points are won at 8.5, not at 8", () => {
    expect(CUP_POINTS).toBe(16);
    expect(cupWon(8.5, 7.5)).toBe(true);
    expect(cupWon(8, 8)).toBe(false);
    expect(cupWon(6, 2)).toBe(false);
  });
});

walk("teamCup", "two teams of eight over three sessions", [
  { name: "three teams made: a cup is two (refused, Team cup)", f: cup({ cup: { flights: 3, unplaced: 0 } }), step: "setting-up", next: { kind: "launch", enabled: false, blocked: /two teams, and this one has 3/, wayOut: "/cup" }, locked: {} },
  { name: "two teams, one player on neither: refused — he cannot be picked for a session", f: cup({ cup: { flights: 2, unplaced: 1 } }), step: "setting-up", next: { kind: "launch", enabled: false, blocked: /^1 player is not on a team/, wayOut: "/cup" }, locked: {} },
  { name: "two teams, everybody on one: Launch is allowed", f: cup(), step: "setting-up", next: launch, locked: {} },
  { name: "launched, no match played: Complete refused", f: live(cup({ cupDecided: false })), step: "live", next: nothingScored, locked: allBy("launch"), rounds: ["not-started", "not-started", "not-started"] },
  {
    name: "after the fourballs, 3–1: live, and Complete would ask about the two sessions unplayed",
    f: cupAt(3, 1, 1, null),
    step: "live",
    next: { kind: "complete", enabled: true, asks: /^Rounds 2 and 3 have no scores/ },
    locked: allBy("launch"),
    rounds: ["closed", "not-started", "not-started"],
  },
  { name: "after the foursomes, 6–2: not decided at 6", f: cupAt(6, 2, 2, null), step: "live", next: { kind: "complete", enabled: true, asks: /^Round 3 has no scores/ }, locked: allBy("launch") },
  {
    name: "four singles in: 8.5–3.5 — decided with the singles half played",
    f: cupAt(8.5, 3.5, 2, 2),
    step: "play-over",
    detail: "Cup decided · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
    rounds: ["closed", "closed", "under-way"],
  },
  {
    name: "all sixteen played, 8–8: not decided, every session closed — a drawn cup",
    f: cupAt(8, 8, 3, null),
    step: "play-over",
    detail: "Every session closed · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
  },
  { name: "completed", f: done(cupAt(8.5, 3.5, 2, 2)), step: "completed", next: reopen, locked: allBy("completed") },
  {
    name: "reopened: decided still, so play over, Complete back",
    f: cupAt(8.5, 3.5, 2, 2),
    step: "play-over",
    detail: "Cup decided · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
    stepsBack: true,
  },
]);

/* ----------------------------------------------------------------------- league */

/**
 * AN EIGHT-CLUB LEAGUE, SIX WEEKS, FOUR MEETINGS A WEEK (c/2). Inter-club weeks
 * are arranged within a window, so only the NEXT unplayed week needs a day or a
 * deadline (Golf Pro Q4; J08) and a later one is asked for as the season goes.
 */
const CLUBS = 8;
const MEETINGS = CLUBS / 2;
const week = (i: number, over: Partial<RoundFacts> = {}): RoundFacts =>
  round({ id: `w${i + 1}`, position: i, type: "Round Robin", format: "Match Play", drawsPairings: true, matches: MEETINGS, teeSheetSaved: null, scheduled: false, ...over });
/** Weeks 1..6; `dated` are the weeks with a day; `played` are over (played and closed); `under` is a week with cards in. */
function season(o: { dated?: number[]; played?: number; under?: number | null; owed?: number | null }): RoundFacts[] {
  return [0, 1, 2, 3, 4, 5].map((i) =>
    week(i, {
      scheduled: (o.dated ?? []).includes(i),
      hasResult: i < (o.played ?? 0) || i === o.under,
      closed: i < (o.played ?? 0),
      matches: i === o.owed ? 0 : MEETINGS,
    }),
  );
}
const league = (rounds: RoundFacts[], over: Partial<TournamentFacts> = {}): TournamentFacts =>
  facts({ league: true, confirmed: 32, groups: CLUBS, startOn: "2026-11-10", endOn: "2026-12-22", rounds, ...over });

walk("league", "eight clubs over six weeks", [
  { name: "no week has a day: refused — nobody knows when to play the first", f: league(season({})), step: "setting-up", next: { kind: "launch", enabled: false, blocked: /^Round 1 has no day and no deadline/, wayOut: "/stages" }, locked: {} },
  { name: "only week 1 dated: Launch is allowed — the others are warned about, not held (J08)", f: league(season({ dated: [0] })), step: "setting-up", next: launch, locked: {} },
  { name: "launched, week 1 to play: Complete refused", f: live(league(season({ dated: [0] }))), step: "live", next: nothingScored, locked: allBy("launch") },
  {
    name: "week 1 played and closed, week 2 has no day: the next action is to set it",
    f: live(league(season({ dated: [0], played: 1 }))),
    step: "live",
    next: { kind: "schedule", enabled: true, label: "Set Round 2’s day" },
    locked: allBy("launch"),
  },
  {
    name: "week 2 dated: Complete is back, and asks about the four weeks not yet played",
    f: live(league(season({ dated: [0, 1], played: 1 }))),
    step: "live",
    next: { kind: "complete", enabled: true, asks: /^Rounds 2, 3, 4, 5 and 6 have no scores/ },
    locked: allBy("launch"),
  },
  {
    name: "week 4 under way and week 5 undated: week 4 has cards in, so week 5 is the next to date",
    f: live(league(season({ dated: [0, 1, 2, 3], played: 3, under: 3 }))),
    step: "live",
    next: { kind: "schedule", enabled: true, label: "Set Round 5’s day" },
    locked: allBy("launch"),
  },
  {
    name: "week 4's pairings not drawn: drawing them outranks dating the next week",
    f: live(league(season({ dated: [0, 1, 2, 3], played: 3, owed: 3 }))),
    step: "live",
    next: { kind: "draw", enabled: true, label: "Generate Round 4 pairings" },
    locked: allBy("launch"),
  },
  {
    name: "every week closed: play over",
    f: live(league(season({ dated: [0, 1, 2, 3, 4, 5], played: 6 }))),
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: true, asks: null },
    locked: allBy("launch"),
  },
  { name: "completed", f: done(league(season({ dated: [0, 1, 2, 3, 4, 5], played: 6 }))), step: "completed", next: reopen, locked: allBy("completed") },
  {
    name: "reopened",
    f: live(league(season({ dated: [0, 1, 2, 3, 4, 5], played: 6 }))),
    step: "play-over",
    detail: "Every round closed · results not released",
    next: { kind: "complete", enabled: true },
    locked: allBy("launch"),
    stepsBack: true,
  },
]);

/* ----------------------------------------------------------------------- casual */

/**
 * A FOUR-BALL ROUND AMONG FRIENDS. Created live, in one step, with its setup
 * unlocked; there is no launch, no completion and no reopen — it is kept or
 * deleted. So it never has a next action, never "plays over", never locks.
 */
const casual = (over: Partial<TournamentFacts> = {}): TournamentFacts =>
  facts({ shape: "match", status: "live", configUnlocked: true, confirmed: 4, groups: 0, moneyAnswered: false, rounds: [round({ id: "c1", position: 0, teeSheetSaved: null })], ...over });

walk("casual", "a round among friends", [
  { name: "just created: live, no setup, no button, nothing locked", f: casual(), step: "live", next: null, locked: {}, rounds: ["not-started"] },
  { name: "scores in: still live, still no button", f: casual({ rounds: [round({ id: "c1", position: 0, teeSheetSaved: null, hasResult: true })] }), step: "live", next: null, locked: {}, rounds: ["under-way"] },
  {
    name: "all eighteen holes in and the round closed: still live — there is no result to release",
    f: casual({ rounds: [round({ id: "c1", position: 0, teeSheetSaved: null, hasResult: true, closed: true })] }),
    step: "live",
    next: null,
    locked: {},
    rounds: ["closed"],
  },
]);

/* ------------------------------------------------------- family by what is in it */

describe("which family a tournament is — first match wins, and progress never changes it", () => {
  it("a bracket after a qualifying round is a knockout, not a medal", () => {
    const f = facts({ rounds: [round({ id: "q", position: 0 }), koRound({ id: "k", position: 1 })] });
    expect(tournamentFamily(f)).toBe("knockout");
  });

  it("the flights mode makes a flighted knockout only where there is a Bracket Stage", () => {
    expect(tournamentFamily(facts({ bracketMode: "flights" }))).toBe("stroke");
    for (const mode of ["single", "split", "plate"]) expect(tournamentFamily(facts({ bracketMode: mode, rounds: [koRound()] }))).toBe("knockout");
    expect(tournamentFamily(facts({ bracketMode: "flights", rounds: [koRound()] }))).toBe("flightedKnockout");
  });

  it("a team session outranks a league flag and a round robin", () => {
    const f = facts({ league: true, rounds: [week(0), round({ id: "s", position: 1, type: "Team Session", format: "Singles" })] });
    expect(tournamentFamily(f)).toBe("teamCup");
  });

  it("a casual round is casual whatever it holds", () => {
    expect(tournamentFamily(casual({ rounds: [koRound()] }))).toBe("casual");
  });

  it("a Stableford and a stroke round together are stroke play: Stableford is for a competition scored in points throughout", () => {
    const f = facts({ rounds: [round({ id: "a", position: 0, format: "Stableford", stableford: true }), round({ id: "b", position: 1 })] });
    expect(tournamentFamily(f)).toBe("stroke");
  });

  it("walking a tournament through its stages never changes its family", () => {
    for (const { family, stage } of ALL) expect(tournamentFamily(stage.f), stage.name).toBe(family);
  });
});

/* ------------------------------------------------------------ dependency rules */

describe("what the next action may and may not offer — swept over every stage above", () => {
  for (const { family, stage } of ALL) {
    describe(`${family} · ${stage.name}`, () => {
      const st = tournamentStatus(stage.f);
      const launched = stage.f.status !== "draft";
      const scored = stage.f.rounds.some((r) => r.hasResult);

      it("offers only what the step allows", () => {
        const kind = st.nextAction?.kind;
        const allowed: Record<Step, NextKind[]> = {
          "setting-up": ["launch"],
          live: ["complete", "draw", "schedule"],
          "play-over": ["complete"],
          completed: ["reopen"],
        };
        if (kind !== undefined) expect(allowed[st.step]).toContain(kind);
        if (family === "casual") expect(st.nextAction).toBeNull();
        else expect(st.nextAction).not.toBeNull();
      });

      it("never offers to launch what is launched, nor to complete what is not, nor to reopen what is open", () => {
        const kind = st.nextAction?.kind;
        if (launched) expect(kind).not.toBe("launch");
        if (!launched) expect(kind === "complete" || kind === "draw" || kind === "schedule" || kind === "reopen").toBe(false);
        if (st.step !== "completed") expect(kind).not.toBe("reopen");
        if (st.step === "completed") expect(kind).toBe("reopen");
      });

      it("a button is enabled exactly when its refusal is empty, and a refusal always says where to go", () => {
        const n = st.nextAction;
        if (!n) return;
        if (n.kind === "launch") expect(n.enabled).toBe(st.refusals.launch === null);
        if (n.kind === "complete") expect(n.enabled).toBe(st.refusals.complete === null);
        if (n.kind === "reopen") expect(n.enabled).toBe(st.refusals.reopen === null);
        if (!n.enabled) {
          expect(n.disabledBecause).toBeTruthy();
          expect(n.wayOut?.href).toMatch(/^\//);
          expect(n.wayOut?.says).toBeTruthy();
        } else {
          expect(n.wayOut).toBeNull();
        }
      });

      it("Complete is never allowed while nothing has been scored", () => {
        if (st.nextAction?.kind === "complete" && !scored) expect(st.nextAction.enabled).toBe(false);
      });

      it("only a launched tournament can be over, and only a completed one is completed", () => {
        if (st.step === "play-over" || st.step === "completed") expect(launched).toBe(true);
        expect(st.step === "completed").toBe(stage.f.status === "completed");
        if (st.step === "play-over") expect(st.chipDetail).toMatch(/ · results not released$/);
        else expect(st.chipDetail).toBe("");
      });

      it("the journey agrees with the step", () => {
        const allowed: Record<Step, string[]> = {
          "setting-up": ["setup", "launch", "play"],
          live: ["play"],
          "play-over": ["play"],
          completed: ["results"],
        };
        expect(allowed[st.step]).toContain(st.journey);
      });

      it("money was never locked, and the tee sheet is shut only by a completed tournament (PR 7c)", () => {
        expect(st.locks.money.locked).toBe(false);
        expect(st.locks.teeSheet.locked).toBe(st.step === "completed");
      });

      it("every lock gives its reason and a way out, and only a launch or a draw lock may be corrected", () => {
        for (const scope of LOCK_SCOPES) {
          const l = st.locks[scope];
          if (!l.locked) continue;
          expect(l.because).toMatch(/^Locked because /);
          expect(l.wayOut.href).toMatch(/^\//);
          expect(l.wayOut.says).toBeTruthy();
          expect(l.correctable).toBe(l.by === "launch" || l.by === "draw");
        }
      });

      it("a completed tournament is locked by completion everywhere, correctably nowhere (Rule 20.2e: the result is final)", () => {
        if (st.step !== "completed") return;
        for (const scope of BLANKET) expect(st.locks[scope]).toMatchObject({ locked: true, by: "completed", correctable: false });
      });

      it("a tournament being set up is locked nowhere (no draw is confirmed in these walks)", () => {
        if (st.step !== "setting-up") return;
        expect(lockedNow(st)).toEqual({});
      });

      it("reports one round state for each playing round", () => {
        expect(st.rounds).toHaveLength(stage.f.rounds.filter((r) => r.playing).length);
      });
    });
  }
});

/**
 * THE RULES THAT CAME AFTER THE WALKS WERE WRITTEN (state machine PR 5b, 7a, 7b),
 * HELD AT EVERY STAGE OF EVERY WALK. `matrix.test.ts` holds each rule on its own
 * axis (family × step); this asks them of the very tournaments walked above, so a
 * stage added to any walk is asked too, and a rule that came to depend on the
 * STATUS again — the fault each of those PRs ended — goes red at the stage that
 * shows it.
 *
 * The expected answers are worked from the stage's facts by the director's
 * route, never by calling the rule twice: a round is "played" when the fixture
 * says it has a result; the sentences are written out here by hand.
 */
describe("the rules since the walks — the lock's words, a round's own settings, a late entrant — at every stage above", () => {
  /** What each reason for a lock says and where it sends the organizer (PR 5b; the TD's ruling, panel 8.1). */
  const SAID: Record<LockBy, { because: string; wayOut: string; href: string; correctable: boolean }> = {
    launch: { because: "Locked because the tournament is live.", wayOut: "Make a committee correction", href: "/dashboard", correctable: true },
    draw: { because: "Locked because the draw is confirmed.", wayOut: "Reopen the draw on Flights", href: "/grouping", correctable: true },
    results: { because: "Locked because this knockout has results.", wayOut: "Clear the results on the Bracket", href: "/bracket", correctable: false },
    completed: { because: "Locked because the tournament is completed.", wayOut: "Reopen it on the dashboard", href: "/dashboard", correctable: false },
    // No walk above is locked by scores; the entry keeps the table whole for the day one is.
    scores: { because: "", wayOut: "", href: "", correctable: false },
  };
  const COMPLETED_ROUNDS_SAID = "The tournament is completed, so its rounds are final. An Organizer can reopen it on the dashboard.";
  const CLOCK = { lastTee: null, now: { day: "2026-01-01", minutes: 0 } };
  /** The families whose late entrant is taken and FLAGGED where flights are a prize division (J04, panel Q3). */
  const TAKES_LATE: Family[] = ["stroke", "stableford"];
  /** The families whose draw IS the field: nobody joins once launched (field-change.ts, header). */
  const DRAW_IS_FIELD: Family[] = ["match", "roundRobinFlights", "knockout", "flightedKnockout", "teamCup"];

  for (const { family, stage } of ALL) {
    describe(`${family} · ${stage.name}`, () => {
      const f = stage.f;
      const st = tournamentStatus(f);
      const completed = f.status === "completed";
      const launched = f.status === "live" || completed;
      const locked = launched && !f.configUnlocked;

      it("a locked scope says its reason in words and its way out — the committee correction after launch, never an Unlock (5b)", () => {
        for (const scope of LOCK_SCOPES) {
          const l = st.locks[scope];
          if (!l.locked) continue;
          expect(l.by, `${scope}: no walk is locked by scores`).not.toBe("scores");
          expect({ because: l.because, wayOut: l.wayOut.says, href: l.wayOut.href, correctable: l.correctable }, scope).toEqual(SAID[l.by]);
          expect(`${l.because} ${l.wayOut.says}`, scope).not.toMatch(/unlock/i);
        }
      });

      it("a round's format, holes, tees and delete are open until ITS first result, whatever the launch; then shut with the reason (7b)", () => {
        for (const r of f.rounds) {
          const one = roundChangeFactsOf(f, r.id, new Set());
          expect(one, r.id).not.toBeNull();
          const doors = roundDoors(one!);
          const four = [doors.format, doors.holes, doors["round-tees"], doors.delete];
          if (completed) {
            // Rule 20.2e: the result is final. Reopen is the deliberate route.
            expect(four, `${r.id}, completed`).toEqual([COMPLETED_ROUNDS_SAID, COMPLETED_ROUNDS_SAID, COMPLETED_ROUNDS_SAID, COMPLETED_ROUNDS_SAID]);
          } else if (r.hasResult) {
            // Shut by its own play: the way out clears that play, where it is cleared — and is never a correction (TD, panel 8.1).
            const wayOut = isKnockoutRound(r.type) ? "on the Bracket first." : "on Score entry first.";
            for (const says of four) {
              expect(says, `${r.id}: a played round's setting is offered`).not.toBeNull();
              expect(says!.endsWith(wayOut), `${r.id}: "${says}"`).toBe(true);
              expect(says).not.toMatch(/committee correction|unlock/i);
            }
          } else {
            // Not played: launch invalidates nothing a round setting decides.
            expect(four, `${r.id}, ${launched ? "launched" : "setting up"}, no result`).toEqual([null, null, null, null]);
          }
        }
      });

      it("a late entrant: taken and flagged where flights are a prize division, refused where the draw is the field (7a)", () => {
        const v = fieldChangeAllowed(fieldFactsOf(f, CLOCK), "add");
        const played = f.rounds.some((r) => r.hasResult);
        if (completed) {
          expect(v.ok).toBe(false);
          if (!v.ok) expect(v.wayOut.href).toBe("/dashboard");
          return;
        }
        if (TAKES_LATE.includes(family) && locked) {
          if (!played) {
            // No published sheet in these walks: open until the first card, and FLAGGED only where there are flights to be in.
            expect(v).toMatchObject({ ok: true, warn: f.groups > 0 ? "unplaced" : null });
          } else {
            expect(v.ok, "a late entry after the first card").toBe(false);
            if (!v.ok) expect(v.says).toContain("an Organizer can make a committee correction to the field");
          }
        }
        if (TAKES_LATE.includes(family) && !launched) expect(v).toMatchObject({ ok: true, warn: null });
        if (DRAW_IS_FIELD.includes(family) && locked) expect(v.ok, "somebody joined a drawn field").toBe(false);
      });
    });
  }
});

describe("the scoring gate — play is refused only before launch, and never once a card exists", () => {
  for (const { family, stage } of ALL) {
    it(`${family} · ${stage.name}`, () => {
      const st = tournamentStatus(stage.f);
      const launched = stage.f.status !== "draft";
      const scored = stage.f.rounds.some((r) => r.hasResult);
      if (launched || scored) expect(st.refusals.play).toBeNull();
      else expect(st.refusals.play).toMatch(/hasn’t been launched yet/);
    });
  }
});

describe("results before launch: every format, the same answer (a played-but-never-launched tournament is still Setting up)", () => {
  const readyStages = ALL.filter(({ family, stage }) => family !== "casual" && stage.step === "setting-up" && stage.next?.kind === "launch" && stage.next.enabled);
  it("there is a ready-to-launch stage for every family but the casual round", () => {
    expect(new Set(readyStages.map((s) => s.family)).size).toBe(8);
  });
  for (const { family, stage } of readyStages) {
    it(`${family}: a first round with results in keeps its Launch button's name and says so on the chip`, () => {
      const f = patch(stage.f, [{ hasResult: true }]);
      const st = tournamentStatus(f);
      expect(st.step).toBe("setting-up");
      expect(st.underWayUnlaunched).toBe(true);
      expect(st.chip).toBe("Setting up · results in");
      expect(st.nextAction).toMatchObject({ kind: "launch", label: "Launch tournament" });
      expect(st.refusals.play).toBeNull();
      expect(st.journey).toBe("play");
    });
  }
});

describe("what each stage locks — the blanket, the confirmed draw, the correction", () => {
  const stroke = (over: Partial<TournamentFacts> = {}) => medal({ groups: 2, ...over });

  it("setting up: nothing; a confirmed draw locks the flights alone, by the draw, and it may be corrected", () => {
    expect(lockedNow(tournamentStatus(stroke()))).toEqual({});
    const st = tournamentStatus(stroke({ flightsConfirmed: true }));
    expect(lockedNow(st)).toEqual({ flights: "draw" });
    expect(st.locks.flights).toMatchObject({ correctable: true, wayOut: { href: "/grouping" } });
  });

  it("live: the launch lock wins over the draw's — the first reason is the one given", () => {
    expect(lockedNow(tournamentStatus(live(stroke({ flightsConfirmed: true }))))).toEqual(allBy("launch"));
  });

  it("live and unlocked by the committee: a confirmed draw is STILL confirmed until it is reopened on Flights", () => {
    const f = { ...live(stroke({ flightsConfirmed: true })), configUnlocked: true };
    expect(lockedNow(tournamentStatus(f))).toEqual({ flights: "draw" });
  });

  it("a committee correction opens exactly the scope it names, and only if that lock is correctable", () => {
    const fix = (scope: LockScope) => ({ scope, by: "A. Organizer", reason: "Wrong flight for one player", until: "2026-11-04" });
    const open = tournamentStatus({ ...live(stroke()), correction: fix("flights") });
    expect(lockedNow(open)).toEqual(allBy("launch", ["flights"]));
    // A correction on a scope that is not locked changes nothing else.
    const idle = tournamentStatus({ ...stroke(), correction: fix("rounds") });
    expect(lockedNow(idle)).toEqual({});
    // A completed result is final: no correction reopens it.
    const final = tournamentStatus({ ...done(medalPlayedOut()), correction: fix("rounds") });
    expect(lockedNow(final)).toEqual(allBy("completed"));
  });

  it("completed, then reopened: from locked by completion to locked by launch, and correctable again", () => {
    const fin = tournamentStatus(done(medalPlayedOut()));
    const back = tournamentStatus(medalPlayedOut());
    expect(fin.locks.details).toMatchObject({ by: "completed", correctable: false });
    expect(back.locks.details).toMatchObject({ by: "launch", correctable: true });
  });

  it("a flighted knockout's draw is the one scope that outlives the launch and is lost to a result, not to a correction", () => {
    const started = live(fko(flightsOf(EIGHTS, () => 1), true));
    const withCorrection = tournamentStatus({ ...started, correction: { scope: "draw", by: "A. Organizer", reason: "Seeded the wrong way round", until: "2026-11-04" } });
    expect(withCorrection.locks.draw).toMatchObject({ locked: true, by: "results", correctable: false });
  });

  it("only the knockout in flights has this exception: a plain knockout's draw is locked by launch like everything else", () => {
    expect(lockedNow(tournamentStatus(live(knockout(8))))).toEqual(allBy("launch"));
    expect(lockedNow(tournamentStatus(live(knockout(8, QF))))).toEqual(allBy("launch"));
  });
});
