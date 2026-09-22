import { describe, it, expect } from "vitest";
import { snapshotStanding } from "@/lib/domain/lifecycle-state";

/**
 * A TOURNAMENT WITH NO ROUND IS NOT A ROUND WITH NO CARDS.
 *
 * Both arrive here as `done: 0, total: 0`, and until 2026-09-22 both got the
 * same sentence: "Nothing returned for this round yet — these standings will
 * change." Printed on `/reports` for the seeded club's "Winter Series — Not
 * Yet Planned", which has no rounds and nobody entered, while its own Rounds
 * screen two clicks away was still asking "What is being played? Add at least
 * one round."
 *
 * An absence reported as a DELAY — the sentence promises something is coming
 * when nothing has been set up to come. It is also the state every club is in
 * for its first ten minutes, which is the reason `verify-lifecycle.mjs`
 * exists.
 *
 * These pin the DISTINCTION rather than either sentence: whatever the words
 * become, a tournament with no round must not be told its round is pending,
 * and a round that genuinely has no cards yet must still say so.
 */

const base = { status: "live", done: 0, total: 0, unit: "cards" };

describe("no round is not an empty round", () => {
  it("says a round has to exist before anything can be reported", () => {
    const { note } = snapshotStanding({ ...base, hasRound: false });
    expect(note).toMatch(/no round has been added/i);
  });

  it("still tells a real round with no cards that its cards are pending", () => {
    const { note } = snapshotStanding({ ...base, hasRound: true });
    expect(note).toMatch(/nothing returned for this round/i);
  });

  /**
   * THE CONTROL, and the reason this is not satisfied by one sentence. The two
   * states share their numbers exactly, so a fix that reworded the note for
   * both — or that reported "no round" whenever the totals are zero — passes
   * every check that looks at one of them alone.
   */
  it("says two different things about the same two zeroes", () => {
    const without = snapshotStanding({ ...base, hasRound: false }).note;
    const withRound = snapshotStanding({ ...base, hasRound: true }).note;
    expect(without).not.toBe(withRound);
    expect(without).not.toMatch(/this round/i);
  });

  it("leaves a caller that says nothing behaving exactly as before", () => {
    // Two of the three callers can only run with a round on screen and do not
    // pass the flag. Defaulting the other way would have changed their text.
    expect(snapshotStanding(base).note).toBe(snapshotStanding({ ...base, hasRound: true }).note);
  });
});

describe("and the states that already had their own sentence keep it", () => {
  it("a hand-scored round is still hand-scored", () => {
    // Checked BEFORE the new branch, and it must stay that way: a manual round
    // is a round, so `hasRound` is true for it anyway — but a future caller
    // that forgets the flag must not turn it into "no round has been added".
    for (const hasRound of [true, false, undefined]) {
      const { note } = snapshotStanding({ ...base, unit: "manual", hasRound });
      expect(note, `hasRound=${hasRound}`).toMatch(/scored by hand/i);
    }
  });

  it("a knockout with no tie decided still talks about ties", () => {
    const { note } = snapshotStanding({ ...base, unit: "ties", hasRound: true });
    expect(note).toMatch(/no tie has been decided/i);
  });

  it("a completed tournament says nothing at all, round or no round", () => {
    for (const hasRound of [true, false]) {
      const s = snapshotStanding({ ...base, status: "completed", hasRound });
      expect(s.note).toBe("");
      expect(s.title).toMatch(/^Final/);
    }
  });

  it("a round part way through still counts what is in", () => {
    const { note } = snapshotStanding({ ...base, done: 16, total: 24, hasRound: true });
    expect(note).toMatch(/16 of 24/);
  });

  it("a round all in says so", () => {
    const { note } = snapshotStanding({ ...base, done: 24, total: 24, hasRound: true });
    expect(note).toMatch(/all in/i);
  });
});
