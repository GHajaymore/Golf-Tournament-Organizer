import { describe, it, expect } from "vitest";
import { yourCardNote } from "../your-card";

/**
 * THE SENTENCE UNDER "YOUR CARD" ON A ROUND THE PLAYER DOES NOT SCORE.
 *
 * It ended "it appears on the board as soon as it's in" on every round of that
 * shape, whether or not it was in — read on the seeded club on 2026-09-20 four
 * inches beneath a panel saying "Round complete · 35 gross, 26 net · 5th of 8
 * sides". It also named both shapes at once on a round that is only ever one
 * of them.
 *
 * Each case below is a state a player is actually in on a team day, and the
 * three are deliberately distinguishable: a wrong branch cannot satisfy two of
 * them at once.
 */
describe("what Today says about a card that is not the player's own", () => {
  it("promises the board only while there is nothing on the card", () => {
    const note = yourCardNote({ side: { played: 0 }, holes: 18 });
    expect(note).toMatch(/as soon as it/i);
    expect(note).toMatch(/played in sides/i);
  });

  it("says the card is in once every hole is on it", () => {
    const note = yourCardNote({ side: { played: 18 }, holes: 18 });
    expect(note).toMatch(/card is in/i);
    // The defect: this is the state the old sentence was false in.
    expect(note).not.toMatch(/as soon as it/i);
  });

  it("says how far round the side is part way through", () => {
    const note = yourCardNote({ side: { played: 7 }, holes: 18 });
    expect(note).toMatch(/thru 7/i);
    expect(note).not.toMatch(/card is in/i);
    expect(note).not.toMatch(/as soon as it/i);
  });

  it("counts a nine-hole round's holes, not eighteen", () => {
    // Nine holes on a nine-hole round is a finished card. Against a hard 18 it
    // would read "thru 9" for ever — the away round on the seeded club is a
    // nine, which is how this case came up.
    expect(yourCardNote({ side: { played: 9 }, holes: 9 })).toMatch(/card is in/i);
    expect(yourCardNote({ side: { played: 9 }, holes: 18 })).toMatch(/thru 9/i);
  });

  it("names the match, not the side, when there is no side", () => {
    const note = yourCardNote({ side: null, holes: 18 });
    expect(note).toMatch(/against your opponent/i);
    expect(note).not.toMatch(/played in sides/i);
    // Nothing is known about a match from here, so the old promise is right.
    expect(note).toMatch(/as soon as it/i);
  });

  it("does not claim a finished card when the round's length is unknown", () => {
    // `me.round.holes` is 0 when there is no round in hand. Treating that as
    // "every hole is in" would report a finished card off a missing number.
    expect(yourCardNote({ side: { played: 3 }, holes: 0 })).toMatch(/thru 3/i);
  });

  /**
   * NO ROUND AT ALL — the third shape, added 2026-09-20.
   *
   * There were two: a side's card, or a match. A tournament whose organizer
   * has added no round is neither, so it fell through to the match sentence
   * and named an opponent who does not exist, on a tournament that has not
   * started. Read off the seeded club's roundless entry as a confirmed member.
   */
  it("says nothing at all when there is no round", () => {
    expect(yourCardNote({ side: null, holes: 0, round: false })).toBe("");
    // And not even when a side somehow came with it: no round, no sentence.
    expect(yourCardNote({ side: { played: 4 }, holes: 18, round: false })).toBe("");
  });

  it("still speaks when there IS a round, however the caller says so", () => {
    // The half a narrow fix breaks, and the old callers: `round` is optional,
    // so every existing one must keep the sentence it had.
    expect(yourCardNote({ side: null, holes: 18, round: true })).toMatch(/against your opponent/i);
    expect(yourCardNote({ side: null, holes: 18 })).toMatch(/against your opponent/i);
    expect(yourCardNote({ side: { played: 9 }, holes: 9, round: true })).toMatch(/card is in/i);
  });
});
