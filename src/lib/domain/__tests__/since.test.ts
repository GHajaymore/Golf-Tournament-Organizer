import { describe, it, expect } from "vitest";
import { sinceWords } from "../since";

/**
 * The sentence this exists for is "you asked them two days ago, no answer yet",
 * so every cell is about whether a person could act on what it says.
 */

const NOW = new Date("2026-09-18T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("how long ago, in words", () => {
  const cases: [number, string][] = [
    [0, "just now"],
    [30 * SECOND, "just now"],
    [5 * MINUTE, "5 minutes ago"],
    [59 * MINUTE, "59 minutes ago"],
    [HOUR, "an hour ago"],
    [5 * HOUR, "5 hours ago"],
    [DAY, "yesterday"],
    [2 * DAY, "2 days ago"],
    [13 * DAY, "13 days ago"],
    [21 * DAY, "3 weeks ago"],
    // Weeks run to eight, so this is six weeks and not "a month ago" — the
    // cell that found the unreachable branch. See the note in since.ts.
    [40 * DAY, "6 weeks ago"],
    [120 * DAY, "4 months ago"],
  ];

  for (const [delta, words] of cases) {
    it(`${delta / 1000}s ago reads as "${words}"`, () => {
      expect(sinceWords(ago(delta), NOW)).toBe(words);
    });
  }

  it("never counts backwards when the clocks disagree", () => {
    /**
     * Server and browser clocks differ by seconds routinely. "asked in -3
     * seconds" is the kind of thing that makes somebody distrust every other
     * number on the screen, so a future timestamp reads as just now.
     */
    expect(sinceWords(new Date(NOW.getTime() + 3 * SECOND), NOW)).toBe("just now");
    expect(sinceWords(new Date(NOW.getTime() + 2 * DAY), NOW)).toBe("just now");
  });

  it("takes the string a serialized payload actually carries", () => {
    // Server components hand dates to client components as ISO strings.
    expect(sinceWords("2026-09-16T12:00:00Z", NOW)).toBe("2 days ago");
  });

  it("says something harmless when the date is unusable", () => {
    // Rather than "NaN days ago", which has been shipped by better products.
    expect(sinceWords("not a date", NOW)).toBe("recently");
    expect(sinceWords(new Date("nonsense"), NOW)).toBe("recently");
  });

  it("does not round a day away", () => {
    // 36 hours is not "yesterday" to somebody deciding whether to chase.
    expect(sinceWords(ago(36 * HOUR), NOW)).toBe("2 days ago");
  });
});
