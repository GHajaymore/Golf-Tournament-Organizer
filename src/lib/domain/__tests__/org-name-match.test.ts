import { describe, it, expect } from "vitest";
import {
  normalizeOrgName,
  orgNamesLookLikeOne,
  clubExistsQuestion,
  inTheSameArea,
} from "../org-name-match";

/**
 * TWO SECRETARIES TYPING THE SAME CLUB.
 *
 * The cells below are the ways one outfit gets written twice, and the ways two
 * outfits that are genuinely different must not be fused. The asymmetry is
 * deliberate and argued in the module: an over-match costs one question, an
 * under-match costs a season with the roster in two halves.
 */

describe("names that are one outfit", () => {
  const same: [string, string][] = [
    ["Mill Ridge Golf Club", "Mill Ridge G.C."],
    ["Mill Ridge GC", "mill ridge gc"],
    ["The Cedar Dunes Golf Club", "Cedar Dunes GC"],
    // Accents and curly punctuation, which is how the SAME person writing on
    // two devices ends up with two clubs.
    ["Château Bushwood", "Chateau Bushwood"],
    ["Men’s & Ladies’ Society", "Mens and Ladies Society"],
    ["Ravenswood  Golf   Society", "ravenswood golf society"],
    ["Oakmoor Country Club", "Oakmoor CC"],
    ["Oakmoor Golf and Country Club", "Oakmoor GCC"],
    // The one Ajay named: a league called after the night it plays, typed by
    // three different people.
    ["Thursday Night League", "thursday night league"],
  ];
  for (const [a, b] of same) {
    it(`asks about “${a}” beside “${b}”`, () => {
      expect(orgNamesLookLikeOne(a, b)).toBe(true);
    });
  }
});

describe("names that are two outfits", () => {
  const different: [string, string][] = [
    ["Mill Ridge Golf Club", "Mill Ridge Golf Society"],
    ["Cedar Dunes GC", "Cedar Downs GC"],
    ["Thursday Night League", "Thursday Morning League"],
    ["Oakmoor CC", "Oakmoor GC"],
    // Nothing clever: two clubs that merely sound alike are two clubs. A
    // matcher with an edit distance in it would fuse these, and fusing two
    // real clubs is the failure this must not have.
    ["Bushwood", "Brushwood"],
  ];
  for (const [a, b] of different) {
    it(`stays quiet about “${a}” beside “${b}”`, () => {
      expect(orgNamesLookLikeOne(a, b)).toBe(false);
    });
  }

  it("says nothing about an empty name", () => {
    // An organization that has never been named carries the person's own, and
    // two organizers with no club are not a duplicate of each other.
    expect(orgNamesLookLikeOne("", "")).toBe(false);
    expect(orgNamesLookLikeOne("   ", "Mill Ridge GC")).toBe(false);
  });
});

describe("what it reduces a name to", () => {
  it("keeps words apart rather than running them together", () => {
    // "mill-ridge" is two words. Deleting punctuation instead of replacing it
    // would make "millridge", which then fails to match "Mill Ridge".
    expect(normalizeOrgName("Mill-Ridge")).toBe("mill ridge");
    expect(normalizeOrgName("Mill Ridge")).toBe("mill ridge");
  });

  it("folds the long form of the words that mean the same thing", () => {
    expect(normalizeOrgName("Oakmoor Golf and Country Club")).toBe("oakmoor gcc");
    expect(normalizeOrgName("Oakmoor Country Club")).toBe("oakmoor cc");
  });

  it("only folds them at the END, where a club's name carries them", () => {
    // "Golf Club Lane Society" is not the Lane Society of a golf club.
    expect(normalizeOrgName("Golf Club Lane Society")).toBe("golf club lane society");
  });
});

describe("near enough to be the same outfit", () => {
  const HERE = { city: "Cincinnati", region: "OH", country: "US" };

  it("is near when the town is the same, however the region is written", () => {
    expect(inTheSameArea(HERE, { city: "Cincinnati", region: "Ohio", country: "US" })).toBe(true);
  });

  it("is near across the county, which is about the distance asked for", () => {
    expect(inTheSameArea(HERE, { city: "Loveland", region: "OH", country: "US" })).toBe(true);
  });

  it("is not near in another state", () => {
    expect(inTheSameArea(HERE, { city: "Austin", region: "TX", country: "US" })).toBe(false);
  });

  it("is never near in another country — the case worth being certain about", () => {
    // A Thursday League in Ohio and one in Cheshire are two leagues, always.
    expect(inTheSameArea(HERE, { city: "Knutsford", region: "Cheshire", country: "GB" })).toBe(false);
  });

  it("FAILS OPEN when nobody knows where one of them is", () => {
    /**
     * The whole point. Somebody who signed up an hour ago has no town on their
     * outfit, and that is exactly the person about to build a club's second
     * half — so an unknown location must be treated as near, not as far away.
     * A location filter that silences the warning for every brand new tenant
     * silences it for everybody it was written for.
     */
    const nowhere = { city: "", region: "", country: "" };
    expect(inTheSameArea(HERE, nowhere)).toBe(true);
    expect(inTheSameArea(nowhere, HERE)).toBe(true);
    expect(inTheSameArea(nowhere, nowhere)).toBe(true);
  });
});

describe("the question it asks", () => {
  it("names the outfit and where it is, because that is the answerable part", () => {
    const q = clubExistsQuestion({ name: "Thursday Night League", label: "Society or league", where: "Cincinnati, OH" });
    expect(q).toContain("Thursday Night League");
    expect(q).toContain("Cincinnati, OH");
    expect(q).toContain("society or league");
    // It must read as a question with a way past it, not a refusal.
    expect(q).toMatch(/carry on/);
  });

  it("leaves the place out rather than saying 'in '", () => {
    const q = clubExistsQuestion({ name: "Mill Ridge GC", label: "Golf club", where: "" });
    expect(q).toContain("Mill Ridge GC");
    expect(q).not.toMatch(/\bin\s*[”"]/);
    expect(q).not.toContain("in  ");
  });

  it("names who runs it, so “ask them” means somebody", () => {
    const q = clubExistsQuestion({
      name: "Thursday Night League",
      label: "Society or league",
      where: "Cincinnati, OH",
      runBy: "Dana Whitfield",
    });
    expect(q).toContain("run by Dana Whitfield");
  });

  it("never invents a sentence about nobody", () => {
    const q = clubExistsQuestion({ name: "Mill Ridge GC", label: "Golf club", where: "", runBy: "" });
    expect(q).not.toContain("run by");
    expect(q).not.toContain("It is run by .");
  });

  it("says what a second one actually costs, which is the roster", () => {
    const q = clubExistsQuestion({ name: "Mill Ridge GC", label: "Golf club", where: "" });
    // Ajay's whole reason for wanting the warning: not a tidy list of names,
    // but a club whose roster ends up split across two tenants.
    expect(q).toMatch(/roster/);
  });
});
