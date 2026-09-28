import { describe, it, expect } from "vitest";
import { GOLF_TERMS, golfRegister, golfTermsFor, GOLF_REGISTERS } from "../golf-terms";
import { countryCode } from "../country";

describe("which golf a club speaks", () => {
  it("follows the club's country", () => {
    for (const c of ["GB", "Scotland", "England", "Ireland", "Australia", "New Zealand", "South Africa", "FR", "DE"]) {
      expect(golfRegister(c), c).toBe("uk");
    }
    for (const c of ["US", "USA", "United States", "Canada", "CA"]) {
      expect(golfRegister(c), c).toBe("us");
    }
  });

  it("defaults to US where the country is blank or unlisted (Ajay, 2026-09-27)", () => {
    expect(golfRegister("")).toBe("us");
    expect(golfRegister(null)).toBe("us");
    expect(golfRegister("Japan")).toBe("us");
  });

  it("lets the club's own choice win over its country, and ignores junk", () => {
    expect(golfRegister("Scotland", "us")).toBe("us");
    expect(golfRegister("US", "uk")).toBe("uk");
    expect(golfRegister("Scotland", "")).toBe("uk");
    expect(golfRegister("Scotland", "klingon")).toBe("uk");
    expect(golfRegister("Scotland", " US ")).toBe("us");
  });

  it("reads the home nations as Britain", () => {
    expect(countryCode("Scotland")).toBe("GB");
    expect(countryCode("wales")).toBe("GB");
    expect(countryCode("Northern Ireland")).toBe("GB");
  });
});

describe("the words", () => {
  it("names every concept in both registers, and differently", () => {
    for (const [key, words] of Object.entries(GOLF_TERMS)) {
      for (const r of GOLF_REGISTERS) expect(words[r].trim(), `${key}.${r}`).not.toBe("");
      expect(words.us, `${key} is the same word in both`).not.toBe(words.uk);
    }
  });

  it("never swaps a Rules of Golf format's name", () => {
    // UK "foursomes" is alternate shot; a US "foursome" is a group of four.
    // The table may use "foursome" for the GROUP, but never as a key for the
    // format, and never rename a format — those names are the Rules'.
    const keys = Object.keys(GOLF_TERMS).join(" ").toLowerCase();
    for (const format of ["foursomes", "fourball", "four-ball", "greensomes", "scramble", "stableford", "chapman"]) {
      expect(keys, `a format (${format}) is a term`).not.toContain(format);
    }
  });

  it("resolves a whole register at once", () => {
    expect(golfTermsFor("us").cart).toBe("cart");
    expect(golfTermsFor("uk").cart).toBe("buggy");
    expect(golfTermsFor("uk").group).toBe("fourball");
    expect(golfTermsFor("us").organizer).toBe("organizer");
  });
});
