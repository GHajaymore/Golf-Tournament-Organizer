import { describe, it, expect } from "vitest";
import { brandLines, brandMonogram, isBrandDisplay, BRAND_DISPLAY, BRAND_DISPLAY_LABEL, BRAND_DISPLAY_HELP } from "../brand";

/**
 * How a club's name sits beside its logo.
 *
 * The point of the resolver is that no setting can produce a bad result:
 * nothing repeats, nothing disappears.
 */

const FULL = "Cedar Dunes Golf & Country Club";
const SHORT = "CDG";

describe("choosing the lines", () => {
  it("shows only what was asked for", () => {
    expect(brandLines(FULL, SHORT, "full")).toEqual({ primary: FULL, secondary: "" });
    expect(brandLines(FULL, SHORT, "short")).toEqual({ primary: SHORT, secondary: "" });
  });

  it("stacks short over full when both are wanted", () => {
    expect(brandLines(FULL, SHORT, "both")).toEqual({ primary: SHORT, secondary: FULL });
  });

  it("never prints the same words twice", () => {
    // Asking for both at a club whose short name is its full name should give
    // one line, not an echo.
    expect(brandLines("Ridgeline", "Ridgeline", "both").secondary).toBe("");
    expect(brandLines("Ridgeline", "ridgeline", "both").secondary).toBe("");
  });

  it("falls back rather than leaving the logo unlabelled", () => {
    // Choosing "short name" at a club that never set one must still show a
    // name. The alternative is blank space next to a logo.
    expect(brandLines(FULL, "", "short")).toEqual({ primary: FULL, secondary: "" });
    expect(brandLines("", SHORT, "full")).toEqual({ primary: SHORT, secondary: "" });
    expect(brandLines(FULL, "", "both")).toEqual({ primary: FULL, secondary: "" });
  });

  it("treats whitespace as unset", () => {
    expect(brandLines(FULL, "   ", "short").primary).toBe(FULL);
    expect(brandLines(FULL, "   ", "both").secondary).toBe("");
  });

  it("gives nothing when the club has filled in nothing", () => {
    expect(brandLines("", "", "both")).toEqual({ primary: "", secondary: "" });
  });

  it("trims stray spacing off both names", () => {
    expect(brandLines(`  ${FULL} `, ` ${SHORT} `, "both")).toEqual({ primary: SHORT, secondary: FULL });
  });
});

describe("the monogram, when there is no logo", () => {
  it("keeps an acronym intact", () => {
    // "CDG" is already a monogram. Reducing it to "C" throws away the part
    // that identifies the club.
    expect(brandMonogram(FULL, "CDG")).toBe("CDG");
    expect(brandMonogram(FULL, "RGC")).toBe("RGC");
  });

  it("takes two initials from a name, not one", () => {
    // Three clubs in a league starting with R is ordinary; one letter tells
    // them apart about as well as no letter.
    expect(brandMonogram("Cedar Dunes Golf & Country Club", "")).toBe("CD");
    expect(brandMonogram("Ridgeline Park", "")).toBe("RP");
  });

  it("falls back to one letter for a single long word", () => {
    expect(brandMonogram("Ridgeline", "")).toBe("R");
  });

  it("prefers the short name when there is one", () => {
    expect(brandMonogram("Cedar Dunes", "Ridgeline Park")).toBe("RP");
  });

  it("never renders empty", () => {
    expect(brandMonogram("", "")).toBe("?");
    expect(brandMonogram("   ", "  ")).toBe("?");
    expect(brandMonogram("&&&", "")).toBe("?");
  });
});

describe("the setting itself", () => {
  it("rejects anything not offered", () => {
    for (const k of BRAND_DISPLAY) expect(isBrandDisplay(k), k).toBe(true);
    expect(isBrandDisplay("acronym")).toBe(false);
    expect(isBrandDisplay("")).toBe(false);
  });

  it("describes every option", () => {
    for (const k of BRAND_DISPLAY) {
      expect(BRAND_DISPLAY_LABEL[k], k).toBeTruthy();
      expect(BRAND_DISPLAY_HELP[k].length, k).toBeGreaterThan(25);
    }
  });
});
