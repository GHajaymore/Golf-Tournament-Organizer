import { describe, it, expect } from "vitest";
import { tournamentResult, resultSummary, type RoundOutcome } from "../tournament-result";
import { PLAY_KIND_KEYS, isPlayKind } from "../play-kind";
import { eventWords } from "../event-words";

/**
 * EVERY KIND OF PLAY, AGAINST EVERY KIND OF ROUND.
 *
 * Ajay, 2026-09-19: "add all combinations". A club's day is one tournament —
 * outing, charity day, league, roll-up — holding rounds that are not the same
 * game as each other, and the result card has to read correctly for any pair
 * of those. Nine kinds of play by five kinds of round is forty-five, and no
 * screen has ever been rendered in most of them.
 *
 * INVARIANTS, NOT FEATURES, the way `matrix.test.ts` sweeps the engines: one
 * line per round in the order given, never an empty sentence, never the word
 * "undefined", and `settled` true only where the result can no longer change.
 * A sweep of shapes catches the class; the named cases in
 * `tournament-result.test.ts` catch the wording.
 */

/** One round of each kind, all of them settled. */
const SETTLED: RoundOutcome[] = [
  { kind: "stroke", label: "Medal", winners: [{ name: "Ada", score: "71" }], unit: "net" },
  { kind: "team", label: "Four-ball", winners: [{ name: "The Ridge", score: "−4" }] },
  { kind: "match", label: "Singles", winner: "Ada", loser: "Bo", margin: "3&2" },
  { kind: "manual", label: "Scramble", note: "Ellis & Ferrari, 42 points" },
];

/** The same rounds with nothing decided yet. */
const OUTSTANDING: RoundOutcome[] = [
  { kind: "stroke", label: "Medal", winners: [] },
  { kind: "team", label: "Four-ball", winners: [] },
  { kind: "manual", label: "Scramble", note: "" },
  { kind: "pending", label: "Round 4" },
];

describe("a result card for every kind of play", () => {
  it("has a heading, a label and a mid-sentence word for each", () => {
    for (const key of PLAY_KIND_KEYS) {
      expect(isPlayKind(key), key).toBe(true);
      expect(eventWords(key, "us").resultHeading, key).toBe(`${eventWords(key, "us").kind} result`);
      expect(eventWords(key, "uk").kind.length, key).toBeGreaterThan(0);
      // "this outing", "this charity day" — lower case, because it lands in
      // the middle of a sentence.
      expect(eventWords(key, "au").kindLower, key).toBe(eventWords(key, "au").kind.toLowerCase());
    }
  });

  it("falls back to tournament for anything it does not know", () => {
    /**
     * An unknown key must not print itself into a member's sentence, which is
     * what echoing the stored value would do. A row written before this column
     * existed, or by a caller that invented a word, reads as a tournament.
     */
    for (const bad of ["", "   ", "Outing", "casual", "zz-nonsense"]) {
      expect(eventWords(bad, "us").resultHeading, bad).toBe("Tournament result");
      expect(eventWords(bad, "us").kind, bad).toBe("Tournament");
      expect(isPlayKind(bad), bad).toBe(false);
    }
  });

  it("reads correctly for every kind of play against every kind of round", () => {
    for (const key of PLAY_KIND_KEYS) {
      for (const round of [...SETTLED, ...OUTSTANDING]) {
        const [line] = tournamentResult([round]);
        const where = `${key} / ${round.kind}`;
        expect(line.label, where).toBe(round.label);
        expect(line.result.trim().length, where).toBeGreaterThan(0);
        expect(line.result, where).not.toContain("undefined");
        expect(line.result, where).not.toContain("null");
        expect(line.result, where).not.toMatch(/·\s*$/);
        // The heading is the tournament's own word, whatever the rounds were.
        expect(eventWords(key, "us").resultHeading, where).toContain("result");
      }
    }
  });

  it("settles only what cannot change", () => {
    for (const line of tournamentResult(SETTLED)) expect(line.settled, line.label).toBe(true);
    for (const line of tournamentResult(OUTSTANDING)) expect(line.settled, line.label).toBe(false);
  });

  it("keeps one line per round however the day is mixed", () => {
    // Every ordering of the four settled rounds, because a day is whatever
    // order the club played it in and nothing here may drop or merge one.
    const orders = [
      SETTLED,
      [...SETTLED].reverse(),
      [SETTLED[2], SETTLED[0], SETTLED[3], SETTLED[1]],
      [...SETTLED, ...OUTSTANDING],
    ];
    for (const day of orders) {
      const lines = tournamentResult(day);
      expect(lines.length).toBe(day.length);
      expect(lines.map((l) => l.label)).toEqual(day.map((r) => r.label));
    }
  });

  it("summarises any mixture by counting", () => {
    expect(resultSummary(tournamentResult(SETTLED))).toBe("4 rounds · all settled");
    expect(resultSummary(tournamentResult(OUTSTANDING))).toBe("4 rounds · nothing settled yet");
    expect(resultSummary(tournamentResult([...SETTLED, ...OUTSTANDING]))).toBe("8 rounds · 4 settled");
  });

  it("handles a day of one round and a day of none", () => {
    // The two ends every list feature gets wrong: a single-round medal, and a
    // tournament that exists with nothing played.
    expect(tournamentResult([SETTLED[0]]).length).toBe(1);
    expect(resultSummary(tournamentResult([SETTLED[0]]))).toBe("1 round · all settled");
    expect(tournamentResult([])).toEqual([]);
    expect(resultSummary([])).toBe("Nothing played yet");
  });
});
