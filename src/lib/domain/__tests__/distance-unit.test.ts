import { describe, expect, it } from "vitest";
import { clubDistanceUnit, distanceWords, resolveDistanceUnit } from "../distance-unit";
import { directorySourceUrl } from "../course-directory";

/**
 * WHAT A CARD'S DISTANCES ARE IN (decision 15, 2026-09-28).
 *
 * Asserted against where golf is actually measured in each unit, and in the
 * ORDER the rule is decided — each step below is shown to beat the next.
 */
describe("a club's unit comes from where it plays", () => {
  it("is metres where courses are measured in metres", () => {
    for (const c of ["AU", "NZ", "ZA", "DE", "FR", "ES", "SE", "KR", "CN"]) expect(clubDistanceUnit(c), c).toBe("metres");
  });

  it("is yards where courses are measured in yards, and for a club that has not said", () => {
    for (const c of ["US", "GB", "IE", "CA", "JP", "IN", "", "unknown"]) expect(clubDistanceUnit(c), c || "(blank)").toBe("yards");
  });

  it("reads a country written out in full", () => {
    expect(clubDistanceUnit("Australia")).toBe("metres");
    expect(clubDistanceUnit("United States")).toBe("yards");
  });
});

describe("a course's unit, in the order it is decided", () => {
  const directory = directorySourceUrl("zz-12345");

  it("1. what the course says wins over everything", () => {
    expect(resolveDistanceUnit({ stored: "yards", country: "DE" })).toBe("yards");
    expect(resolveDistanceUnit({ stored: "metres", sourceUrl: directory, country: "US" })).toBe("metres");
  });

  it("2. a directory card is yards, even at a club measured in metres", () => {
    // The directory's cards are in yards wherever the course is. Following the
    // club's country here would relabel real yardages as metres.
    expect(resolveDistanceUnit({ stored: "", sourceUrl: directory, country: "AU" })).toBe("yards");
  });

  it("3. otherwise the club's country — a card a club typed or pasted is in its own unit", () => {
    expect(resolveDistanceUnit({ stored: "", sourceUrl: "https://club.example/card", country: "AU" })).toBe("metres");
    expect(resolveDistanceUnit({ stored: "", sourceUrl: "", country: "GB" })).toBe("yards");
  });

  it("falls through an unrecognised stored value rather than trusting it", () => {
    expect(resolveDistanceUnit({ stored: "furlongs", country: "FR" })).toBe("metres");
    expect(resolveDistanceUnit({ stored: " METRES ", country: "US" })).toBe("metres");
  });
});

describe("how a card labels its distances", () => {
  it("names the unit in the row and in the suffix", () => {
    expect(distanceWords("yards")).toEqual({ row: "Yards", short: "yds", noun: "yards" });
    expect(distanceWords("metres")).toEqual({ row: "Metres", short: "m", noun: "metres" });
  });
});
