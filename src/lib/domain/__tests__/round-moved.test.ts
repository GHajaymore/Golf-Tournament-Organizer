import { describe, it, expect, afterEach, vi } from "vitest";
import { roundMovedNotice, noticesOffWords, type RoundMove } from "../round-moved";

/**
 * A MOVED ROUND IS NEWS ONLY WHEN SOMEBODY COULD HAVE PLANNED AROUND IT
 * (J39/J40 PR 2, design §4.3). Each branch, and the day written as the club
 * writes it whatever zone the server sits in.
 */

const base: RoundMove = {
  before: "2026-11-21",
  after: "2026-11-28",
  told: true,
  roundLabel: "Round 2",
  eventName: "zz Autumn Medal",
  locale: "en-GB",
  organizer: "organiser",
};

describe("roundMovedNotice", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a move after the field was told: the new day and the old, in the club's words", () => {
    expect(roundMovedNotice(base)).toEqual({
      title: "Round 2 has moved to 28 Nov 2026",
      body: "It was on 21 Nov 2026. · zz Autumn Medal",
    });
  });

  it("a first dating is not a move: nobody planned around a day that was not there", () => {
    expect(roundMovedNotice({ ...base, before: "" })).toBeNull();
  });

  it("the same day saved again is not a move", () => {
    expect(roundMovedNotice({ ...base, after: base.before })).toBeNull();
  });

  it("before the field could see the day (not launched), nobody is told", () => {
    expect(roundMovedNotice({ ...base, told: false })).toBeNull();
  });

  it("clearing a day tells: no longer on it, and the club's own word for who will say", () => {
    expect(roundMovedNotice({ ...base, after: "" })).toEqual({
      title: "Round 2 is no longer on 21 Nov 2026",
      body: "Your organiser will say when it is. · zz Autumn Medal",
    });
  });

  it("an American club writes the day its own way", () => {
    expect(roundMovedNotice({ ...base, locale: "en-US", organizer: "organizer" })?.title).toBe("Round 2 has moved to Nov 28, 2026");
  });

  it("the day is a DAY, not an instant: the same words with the process in Auckland (E2E_TZ's zone) or Honolulu", () => {
    const here = roundMovedNotice(base);
    for (const tz of ["Pacific/Auckland", "Pacific/Honolulu"]) {
      vi.stubEnv("TZ", tz);
      expect(roundMovedNotice(base), tz).toEqual(here);
    }
  });

  it("a one-round event says 'Your round'", () => {
    expect(roundMovedNotice({ ...base, roundLabel: "" })?.title).toBe("Your round has moved to 28 Nov 2026");
  });
});

describe("noticesOffWords", () => {
  it("a count, never names, and nothing when everybody can be reached", () => {
    expect(noticesOffWords(0)).toBe("");
    expect(noticesOffWords(1)).toBe("1 player has notices off. Tell them in person.");
    expect(noticesOffWords(3)).toBe("3 players have notices off. Tell them in person.");
  });
});
