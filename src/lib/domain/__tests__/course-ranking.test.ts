import { describe, it, expect } from "vitest";
import { rankCourseHits, tierOf, Tier } from "../course-ranking";
import type { DirectoryHit } from "../course-directory";

/**
 * Which course a golfer meant.
 *
 * Every fixture here is a real shape the catalogue returns. The names
 * beginning with digits are not invented to make a point — "1 At Ponkapoag
 * Golf Club" and "18 Mile Creek Golf Course" are really in there, and they
 * really did sit at the top of every search, because "1" sorts before every
 * letter.
 */

const hit = (over: Partial<DirectoryHit>): DirectoryHit => ({
  id: over.name ?? "id",
  name: "A Course",
  city: "",
  state: "",
  country: "US",
  par: 72,
  website: "",
  ...over,
});

describe("what a query is aiming at", () => {
  it("puts the whole name first", () => {
    expect(tierOf({ name: "Pebble Beach", city: "" }, "pebble beach")).toBe(Tier.ExactName);
  });

  it("then a name being typed out", () => {
    expect(tierOf({ name: "Pebble Beach Golf Links", city: "" }, "pebble")).toBe(Tier.NameStarts);
  });

  it("then a word inside the name, which is how people actually search", () => {
    // "crest" for Green Crest. Nobody types the first word of a club's name.
    expect(tierOf({ name: "Green Crest Golf Course", city: "" }, "crest")).toBe(Tier.NameWordStarts);
  });

  it("then the town, because where you play is a real way to look", () => {
    expect(tierOf({ name: "Losantiville", city: "Cincinnati" }, "cincinnati")).toBe(Tier.CityStarts);
  });

  it("then a bare substring, a match but rarely the one meant", () => {
    expect(tierOf({ name: "Kruisselt", city: "" }, "uissel")).toBe(Tier.Contains);
  });

  it("ignores case, punctuation and accents", () => {
    // Real names carry apostrophes and accents; a golfer types neither.
    expect(tierOf({ name: "St. Andrew's Links", city: "" }, "st andrews")).toBe(Tier.NameStarts);
    expect(tierOf({ name: "Golf de Chantilly", city: "" }, "CHANTILLY")).toBe(Tier.NameWordStarts);
  });

  it("says no match rather than pretending, on an empty query", () => {
    expect(tierOf({ name: "Anything", city: "" }, "   ")).toBe(Tier.NoMatch);
  });
});

describe("the order the list comes out in", () => {
  it("stops a course beginning with a digit outranking the obvious answer", () => {
    /**
     * The defect this module exists for. Alphabetically "1 At Ponkapoag" beats
     * "Ponkapoag Golf Club" for the query "ponkapoag", and it was doing so.
     */
    const ranked = rankCourseHits(
      [hit({ name: "1 At Ponkapoag Golf Club" }), hit({ name: "Ponkapoag Golf Club" })],
      "ponkapoag",
    );
    expect(ranked[0].name).toBe("Ponkapoag Golf Club");
  });

  it("puts the course you are typing above one that merely contains it", () => {
    const ranked = rankCourseHits(
      [hit({ name: "Old Pebble Beach Road Course" }), hit({ name: "Pebble Beach Golf Links" })],
      "pebble",
    );
    expect(ranked[0].name).toBe("Pebble Beach Golf Links");
  });

  it("prefers a course that arrives with a card", () => {
    // A cardless course is a second job — the club still has to enter one —
    // so within the same tier the one you can score on today comes first.
    const ranked = rankCourseHits(
      [hit({ name: "Green Crest B", par: 0 }), hit({ name: "Green Crest A", par: 71 })],
      "green",
    );
    expect(ranked[0].name).toBe("Green Crest A");
  });

  it("breaks a tie toward the shorter name", () => {
    const ranked = rankCourseHits(
      [hit({ name: "Pebble Beach Golf Links Practice Area" }), hit({ name: "Pebble Beach Golf Links" })],
      "pebble",
    );
    expect(ranked[0].name).toBe("Pebble Beach Golf Links");
  });

  it("gives the same answer twice, whatever order the rows arrived in", () => {
    // The list re-renders under the reader's fingers as they type. An order
    // that depended on what the database returned first would shuffle.
    const rows = [hit({ name: "Ballybunion Old" }), hit({ name: "Ballybunion Cashen" }), hit({ name: "Ballyliffin" })];
    const a = rankCourseHits(rows, "bally").map((h) => h.name);
    const b = rankCourseHits([...rows].reverse(), "bally").map((h) => h.name);
    expect(a).toEqual(b);
  });

  it("keeps a row the catalogue matched but this function cannot explain", () => {
    // The database found it for a reason not modelled here. Dropping it would
    // be this function overruling the search that produced it.
    const ranked = rankCourseHits([hit({ name: "Somewhere Else" })], "pebble");
    expect(ranked).toHaveLength(1);
  });

  it("does not lose or duplicate anything", () => {
    const rows = ["A Golf Club", "B Golf Club", "Golf Club C", "1 Golf"].map((n) => hit({ name: n }));
    const ranked = rankCourseHits(rows, "golf");
    expect(ranked).toHaveLength(4);
    expect(new Set(ranked.map((r) => r.name)).size).toBe(4);
  });

  it("survives an empty list", () => {
    expect(rankCourseHits([], "anything")).toEqual([]);
  });
});
