import { describe, it, expect } from "vitest";
import { parseAreaQuery, stateCodeOf } from "../course-area";

/**
 * Finding a course by where it is.
 *
 * A society deciding where to play thinks in places. The search matched name
 * and city only, and the catalogue stores states as two-letter codes — so
 * "Ohio" found nothing at all, and "Cincinnati, OH" found nothing either
 * because the comma made it one string matching no city on earth.
 */

describe("reading a state", () => {
  it("takes the name people actually type", () => {
    expect(stateCodeOf("Ohio")).toBe("OH");
    expect(stateCodeOf("ohio")).toBe("OH");
    expect(stateCodeOf("  Ohio  ")).toBe("OH");
  });

  it("takes the code the catalogue stores", () => {
    expect(stateCodeOf("OH")).toBe("OH");
    expect(stateCodeOf("oh")).toBe("OH");
  });

  it("handles the two-word states", () => {
    expect(stateCodeOf("New York")).toBe("NY");
    expect(stateCodeOf("rhode island")).toBe("RI");
    expect(stateCodeOf("West Virginia")).toBe("WV");
    expect(stateCodeOf("District of Columbia")).toBe("DC");
  });

  it("is empty for anything that is not a state", () => {
    for (const s of ["Cincinnati", "Green Crest", "ZZ", "", "  ", "Ontario"]) {
      expect(stateCodeOf(s), s).toBe("");
    }
  });
});

describe("reading a place out of a search", () => {
  it("splits an address on its comma, which is what the comma means", () => {
    expect(parseAreaQuery("Cincinnati, OH")).toEqual({ text: "", city: "Cincinnati", state: "OH" });
    expect(parseAreaQuery("Cincinnati, Ohio")).toEqual({ text: "", city: "Cincinnati", state: "OH" });
  });

  it("takes a state on its own", () => {
    expect(parseAreaQuery("Ohio")).toEqual({ text: "", city: "", state: "OH" });
    expect(parseAreaQuery("New York")).toEqual({ text: "", city: "", state: "NY" });
  });

  it("takes a trailing state and keeps the rest as a name", () => {
    // "Crest Ohio" should still search names for Crest, not just the state.
    expect(parseAreaQuery("Crest Ohio")).toEqual({ text: "Crest", city: "", state: "OH" });
    expect(parseAreaQuery("Hillcrest OH")).toEqual({ text: "Hillcrest", city: "", state: "OH" });
  });

  it("tries the last TWO words before the last one", () => {
    // Otherwise "Pebble New York" reads as the state "York", which is not one,
    // and the whole thing stays text — losing the state half of the search.
    expect(parseAreaQuery("Pebble New York")).toEqual({ text: "Pebble", city: "", state: "NY" });
  });

  it("leaves an ordinary course name completely alone", () => {
    for (const q of ["Green Crest", "Pebble Beach Golf Links", "Ballybunion"]) {
      expect(parseAreaQuery(q), q).toEqual({ text: q, city: "", state: "" });
    }
  });

  it("keeps the whole string when a comma is not an address", () => {
    // "Smith, Jones & Co Golf Club" is a name, not a city and a state.
    const q = "Smith, Jones Golf Club";
    expect(parseAreaQuery(q)).toEqual({ text: q, city: "", state: "" });
  });

  it("never throws away the text half in favour of a place", () => {
    // The rule that stops this making search WORSE: adding place-reading must
    // not remove a result that name-matching would have found.
    const parsed = parseAreaQuery("Crest Ohio");
    expect(parsed.text).toBe("Crest");
  });

  it("survives an empty or blank query", () => {
    expect(parseAreaQuery("")).toEqual({ text: "", city: "", state: "" });
    expect(parseAreaQuery("   ")).toEqual({ text: "", city: "", state: "" });
  });

  it("collapses untidy spacing rather than failing on it", () => {
    expect(parseAreaQuery("  Cincinnati ,   OH ")).toEqual({
      text: "",
      city: "Cincinnati",
      state: "OH",
    });
  });
});
