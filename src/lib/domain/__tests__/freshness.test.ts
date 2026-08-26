import { describe, it, expect } from "vitest";
import { freshness, STALE_AFTER_MS, POLL_MS } from "../freshness";

/**
 * What the public board says about its own age.
 *
 * Read outdoors, on a course, on a phone that loses signal between holes. The
 * label is the only thing telling a spectator whether they are looking at the
 * current standings or at whatever arrived before the last dead spot, and
 * there is nobody beside them to correct it.
 */

const sec = (n: number) => n * 1000;
const min = (n: number) => n * 60_000;

describe("how old the board says it is", () => {
  it("says just now for anything inside a poll or two", () => {
    // The board refreshes on POLL_MS, so a healthy page spends most of its
    // life somewhere under a minute old. Counting seconds at a spectator
    // would be noise.
    expect(freshness(0).label).toBe("just now");
    expect(freshness(sec(20)).label).toBe("just now");
    expect(freshness(sec(44)).label).toBe("just now");
  });

  it("starts counting minutes once it is worth counting", () => {
    expect(freshness(sec(60)).label).toBe("1 min ago");
    expect(freshness(min(5)).label).toBe("5 min ago");
    expect(freshness(min(59)).label).toBe("59 min ago");
  });

  it("moves to hours rather than saying 90 min ago", () => {
    expect(freshness(min(60)).label).toBe("1 hour ago");
    expect(freshness(min(150)).label).toBe("3 hours ago");
  });

  it("does not warn while the board is keeping up", () => {
    expect(freshness(0).stale).toBe(false);
    expect(freshness(POLL_MS).stale).toBe(false);
    expect(freshness(STALE_AFTER_MS - 1).stale).toBe(false);
  });

  it("warns once several polls have brought nothing back", () => {
    /**
     * THE CASE THIS EXISTS FOR. The page keeps asking; the phone is in a dead
     * spot behind the 12th. The scores on screen are the best information
     * available and should stay up — but presenting them as current is a lie
     * the reader has no way to check.
     */
    expect(freshness(STALE_AFTER_MS).stale).toBe(true);
    expect(freshness(min(10)).stale).toBe(true);
    expect(freshness(min(10)).label).toBe("10 min ago");
  });

  it("never says the board was updated in the future", () => {
    // The age comes from a SERVER timestamp against the DEVICE clock, and a
    // phone whose clock is a minute slow would otherwise read "in 1 minute" —
    // which looks like a bug and makes the scores look wrong too.
    expect(freshness(-sec(90)).label).toBe("just now");
    expect(freshness(-sec(90)).stale).toBe(false);
  });

  it("survives a clock that gives it nonsense", () => {
    expect(freshness(NaN).label).toBe("just now");
    expect(freshness(Infinity).label).toBe("just now");
  });
});
