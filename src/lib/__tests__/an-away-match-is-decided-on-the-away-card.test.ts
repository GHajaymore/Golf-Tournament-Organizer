import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeStandings, decidedOutcome } from "@/lib/domain/standings";
import { breakMatchTie } from "@/lib/domain/match-tiebreak";
import type { HoleResult, Match, Player, ScoringRules } from "@/lib/domain/types";
import { countbackCardsFor, matchCountbackIndex, type EventCourseFields, type StoredCourse } from "@/lib/services/course-resolution";

/**
 * AN AWAY MATCH HALVED ON THE COURSE IS DECIDED ON THE AWAY CARD'S HOLES (J26,
 * 2026-11-06).
 *
 * The Rules: a match all square after the stipulated round is decided however
 * the Committee's Terms of the Competition say (Committee Procedures, Section
 * 5A(6) — "How ties will be decided"; Rule 3.2a(4) keeps the match tied until
 * then). A countback "on the toughest holes" names holes by their STROKE
 * INDEX, and a stroke index is a property of the course being played: the
 * Committee allocates it per course (Rules of Handicapping, Appendix E), and
 * the same eighteen numbers at another club are another club's holes. So the
 * hardest six of a match played at Ardmore are Ardmore's hardest six — not
 * the tournament's home course's, which the players never stood on.
 *
 * Until J26 the standings, the week view and the head-to-head record all took
 * the TOURNAMENT's stroke index for every match. This file works the right
 * answer out by a route the code does not take — the hardest N holes of a card
 * that is a permutation of 1..18 are the holes whose index is AT MOST N, read
 * by value, never sorted — and holds `matchCountbackIndex` and the standings to
 * it.
 */

const HOME_SI = Array.from({ length: 18 }, (_, i) => i + 1); // hole 1 hardest
const AWAY_SI = Array.from({ length: 18 }, (_, i) => 18 - i); // hole 18 hardest

const stored = (name: string, si: number[]): StoredCourse => ({
  id: name,
  name,
  city: "",
  pars: JSON.stringify(new Array(si.length).fill(4)),
  yards: "",
  strokeIndex: JSON.stringify(si),
});

/** A tournament whose OWN card is the home course. */
const homeEvent = (si: number[] = HOME_SI): EventCourseFields => ({
  course: "zz-home",
  city: "",
  customPars: JSON.stringify(new Array(si.length).fill(4)),
  customYards: "",
  customStrokeIndex: JSON.stringify(si),
});

const AWAY = stored("zz-away", AWAY_SI);

/**
 * All square after eighteen: Ann won the 1st, 2nd and 3rd, Bea the 16th, 17th
 * and 18th, the other twelve halved.
 */
const HALVED: HoleResult[] = ["A", "A", "A", ...new Array(12).fill("H"), "B", "B", "B"];

const match = (id: string, holes: HoleResult[] = HALVED): Match => ({
  id,
  stageId: "zz-week",
  groupId: "g",
  round: 1,
  playerAId: "ann",
  playerBId: "bea",
  holes,
});

const players: Player[] = [
  { id: "ann", name: "Ann", handicap: 10, seed: 1 },
  { id: "bea", name: "Bea", handicap: 10, seed: 2 },
];

/** Points for a result and nothing else, so every figure below is the result's. */
const SCORING: ScoringRules = {
  winPts: 3,
  tiePts: 1,
  lossPts: 0,
  holeRatioPts: 0,
  bonusPts: 0,
  playPts: 0,
  maxPerMatch: 0,
  tiebreakers: [],
};

/**
 * THE ROUTE THE CODE DOES NOT TAKE: on a card whose indexes are exactly 1..n,
 * the hardest N holes are the ones whose index is N or less. Read by value, so
 * no sort is involved, and the holes are counted off the card one by one.
 */
function refCountback(holes: HoleResult[], si: number[], n: number): "A" | "B" | null {
  let a = 0;
  let b = 0;
  for (let hole = 0; hole < holes.length; hole += 1) {
    if (si[hole] > n) continue;
    if (holes[hole] === "A") a += 1;
    if (holes[hole] === "B") b += 1;
  }
  return a === b ? null : a > b ? "A" : "B";
}

describe("which card's holes decide a halved match", () => {
  it("THE RULES: the match played at the away club is decided on the away club's toughest six", () => {
    // Worked by hand. The away card's hardest six are the 13th to the 18th
    // (indexes 6, 5, 4, 3, 2, 1); Bea won the 16th, 17th and 18th of them and
    // Ann none, so the countback is Bea's, 3–0. On the home card the hardest
    // six are the 1st to the 6th — Ann's three — which is the answer the
    // tournament's card gave for a match nobody played there.
    expect(refCountback(HALVED, AWAY_SI, 6)).toBe("B");
    expect(refCountback(HALVED, HOME_SI, 6)).toBe("A");

    const card = matchCountbackIndex({ match: AWAY, round: null }, {}, { holes: 18 }, homeEvent());
    expect(card).toEqual(AWAY_SI);
    expect(breakMatchTie(HALVED, card, ["toughest-6"])).toMatchObject({ winner: "B", decidedBy: "toughest-6" });
  });

  it("ONE ABSOLUTE ROW: Bea, who won the away countback, has the win and its 3 points; Ann the loss and 0", () => {
    const cards = countbackCardsFor(homeEvent(), [{ id: "zz-week", courseId: "zz-away", holes: 18 }], [{ id: "m1", stageId: "zz-week" }], (id) =>
      id === "zz-away" ? AWAY : null,
    );
    const rows = computeStandings(players, [match("m1")], SCORING, {}, cards, ["toughest-6"]);
    const row = (id: string) => rows.find((r) => r.player.id === id)!;
    expect(rows.map((r) => r.player.id)).toEqual(["bea", "ann"]);
    expect({ wins: row("bea").stats.wins, losses: row("bea").stats.losses, ties: row("bea").stats.ties, points: row("bea").stats.totalPoints }).toEqual({
      wins: 1,
      losses: 0,
      ties: 0,
      points: 3,
    });
    expect({ wins: row("ann").stats.wins, losses: row("ann").stats.losses, points: row("ann").stats.totalPoints }).toEqual({ wins: 0, losses: 1, points: 0 });
  });

  it("walks match, then round, then tournament — the venue the match was PLAYED at", () => {
    const venueOf = (id: string) => (id === "zz-away" ? AWAY : id === "zz-third" ? stored("zz-third", HOME_SI) : null);
    const rounds = [
      { id: "home-week", courseId: null, holes: 18 },
      { id: "away-week", courseId: "zz-away", holes: 18 },
    ];
    const matches = [
      { id: "at-home", stageId: "home-week" },
      { id: "away-week-match", stageId: "away-week" },
      // A pairing that moved its own match: the round is away, the match was
      // played at a third club whose card is the home layout.
      { id: "moved", stageId: "away-week", courseId: "zz-third" },
    ];
    const cards = countbackCardsFor(homeEvent(), rounds, matches, venueOf);
    expect(decidedOutcome(match("at-home"), { sequence: ["toughest-6"], strokeIndex: cards })).toBe("A");
    expect(decidedOutcome(match("away-week-match"), { sequence: ["toughest-6"], strokeIndex: cards })).toBe("B");
    expect(decidedOutcome(match("moved"), { sequence: ["toughest-6"], strokeIndex: cards })).toBe("A");
    // A match the reader was not given has no venue to ask: no card, so the
    // toughest-holes step decides nothing rather than borrowing the home card.
    expect(cards({ id: "unknown" })).toEqual([]);
  });

  it("decides a back-nine away match on the back nine's hardest holes, re-ranked 1..9", () => {
    // Nine holes, the back nine of the away card: holes 10..18 carry 9..1, so
    // the 18th is the hardest of the nine. Ann won the 10th, Bea the 18th.
    const holes: HoleResult[] = ["A", "H", "H", "H", "H", "H", "H", "H", "B"];
    const card = matchCountbackIndex({ match: null, round: AWAY }, {}, { holes: 9, nine: "back" }, homeEvent());
    expect(card).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(breakMatchTie(holes, card, ["toughest-1"]).winner).toBe("B");
  });

  it("ranks the toughest-holes STANDINGS tiebreaker on each match's own card too", () => {
    // Two players level on points (one halve each, decided by nothing), one
    // tiebreaker: record on the six hardest holes. Cal's halve was AWAY.
    const cal: Player = { id: "cal", name: "Cal", handicap: 10, seed: 3 };
    const dee: Player = { id: "dee", name: "Dee", handicap: 10, seed: 4 };
    const away: Match = { ...match("cal-away"), playerAId: "cal", playerBId: "dee" };
    const cards = countbackCardsFor(homeEvent(), [{ id: "zz-week", courseId: "zz-away", holes: 18 }], [{ id: "cal-away", stageId: "zz-week" }], (id) =>
      id === "zz-away" ? AWAY : null,
    );
    const rows = computeStandings([cal, dee], [away], { ...SCORING, tiebreakers: ["toughest-6"] }, {}, cards, []);
    // On the away card Dee (side B) took the 16th–18th: Dee ranks first.
    expect(rows.map((r) => r.player.id)).toEqual(["dee", "cal"]);
  });

  it("PROPERTY: for any halved match and any two cards, the reader decides it on the card of the venue named", () => {
    const perm = fc.shuffledSubarray(HOME_SI, { minLength: 18, maxLength: 18 });
    const card = fc.array(fc.constantFrom<HoleResult>("A", "B", "H"), { minLength: 18, maxLength: 18 });
    const level = fc.constantFrom<"match" | "round" | "event">("match", "round", "event");
    const n = fc.constantFrom(1, 3, 6);
    fc.assert(
      fc.property(perm, perm, card, level, n, (homeSi, awaySi, raw, where, toughest) => {
        // Force a genuine halve: as many A as B, by turning the surplus into halves.
        const holes = [...raw];
        let lead = holes.filter((h) => h === "A").length - holes.filter((h) => h === "B").length;
        for (let i = 0; i < holes.length && lead !== 0; i += 1) {
          if (lead > 0 && holes[i] === "A") {
            holes[i] = "H";
            lead -= 1;
          } else if (lead < 0 && holes[i] === "B") {
            holes[i] = "H";
            lead += 1;
          }
        }
        const away = stored("zz-away", awaySi);
        const cards = countbackCardsFor(
          homeEvent(homeSi),
          [{ id: "w", courseId: where === "round" ? "zz-away" : null, holes: 18 }],
          [{ id: "m", stageId: "w", courseId: where === "match" ? "zz-away" : null }],
          (id) => (id === "zz-away" ? away : null),
        );
        const key = `toughest-${toughest}` as "toughest-1" | "toughest-3" | "toughest-6";
        const played = where === "event" ? homeSi : awaySi;
        const expected = refCountback(holes, played, toughest);
        const got = decidedOutcome({ ...match("m"), holes }, { sequence: [key], strokeIndex: cards });
        expect(got).toBe(expected ?? "H");
      }),
      { seed: 20261106, numRuns: 1500 },
    );
  });
});
