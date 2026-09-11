import { describe, it, expect } from "vitest";
import { rankCourses, localityOf, Locality, type Near } from "../course-ranking";

/**
 * NEARBY IS A RANKING, AND THE READER CAN ALWAYS IGNORE IT.
 *
 * The catalogue is 2,184 courses and "golf" is in most course names, so a
 * vague query matches 1,579 of them and the picker shows an arbitrary fifty.
 * Ordering by where the club plays fixes that — and the danger in fixing it is
 * that somebody typing the exact name of a course three counties away stops
 * being able to find it.
 *
 * So the guarantees are asserted here rather than promised in a comment:
 *
 *   1. NOTHING IS EVER REMOVED. The list is reordered, never filtered.
 *   2. A BETTER NAME MATCH ALWAYS WINS. Locality only separates rows that the
 *      query itself could not, so typing what you mean beats being near.
 *   3. A COURSE WITH NO TOWN IS NEVER SORTED LAST. A quarter of the catalogue
 *      has no location at all, and demoting those is filtering wearing a
 *      ranking's clothes.
 *   4. WITHOUT A LOCATION, NOTHING CHANGES AT ALL.
 */

const OHIO: Near = { city: "Cincinnati", state: "Ohio", country: "US" };

const course = (name: string, city = "", state = "", country = "") => ({ name, city, state, country });

describe("what counts as near", () => {
  it("reads the town first, then the state", () => {
    expect(localityOf(course("A", "Cincinnati", "Ohio", "US"), OHIO)).toBe(Locality.SameCity);
    expect(localityOf(course("A", "Columbus", "Ohio", "US"), OHIO)).toBe(Locality.SameState);
  });

  it("demotes only a row that says where it is, and says somewhere else", () => {
    expect(localityOf(course("A", "Perth", "WA", "AU"), OHIO)).toBe(Locality.Elsewhere);
  });

  it("never demotes a row that does not say where it is", () => {
    /**
     * THE ONE THAT MATTERS. 1,610 of 2,184 catalogue rows carry a town, so 574
     * carry nothing — and a ranking that pushed those below every known-far
     * course would hide a quarter of the catalogue behind a fifty-row cap
     * while looking tidier.
     */
    expect(localityOf(course("A"), OHIO)).toBe(Locality.Unplaced);
    expect(localityOf(course("A"), OHIO)).toBeLessThan(Locality.Elsewhere);
  });

  it("treats the same country as no evidence either way", () => {
    expect(localityOf(course("A", "Tulsa", "Oklahoma", "US"), { country: "US" })).toBe(Locality.Unplaced);
  });

  it("says nothing at all when the club's own location is unknown", () => {
    expect(localityOf(course("A", "Perth", "WA", "AU"))).toBe(Locality.Unplaced);
  });
});

describe("the guarantees a reader depends on", () => {
  const field = [
    course("Royal Melbourne Golf Club", "Melbourne", "VIC", "AU"),
    course("Cincinnati Country Club", "Cincinnati", "Ohio", "US"),
    course("Hillcrest Golf Course", "Cincinnati", "Ohio", "US"),
    course("Hillcrest Golf Club", "Perth", "WA", "AU"),
    course("Hillcrest Links"),
  ];

  it("never drops a course", () => {
    // Guarantee 1. Reordered, never filtered — for any query, near or not.
    for (const q of ["hill", "royal", "golf", "zzz"]) {
      expect(rankCourses(field, q, () => false, OHIO)).toHaveLength(field.length);
      expect(rankCourses(field, q)).toHaveLength(field.length);
    }
  });

  it("puts the exact name you typed first, however far away it is", () => {
    /**
     * Guarantee 2, and the whole answer to "can I still just type the course I
     * mean". Royal Melbourne is as far from Cincinnati as a golf course gets,
     * and it is an exact-name match, so it outranks every local course.
     */
    const ranked = rankCourses(field, "royal melbourne golf club", () => false, OHIO);
    expect(ranked[0].name).toBe("Royal Melbourne Golf Club");
  });

  it("only separates courses the query could not", () => {
    /**
     * Three "Hillcrest"es, all equally good answers to "hillcrest" by name.
     * THAT is where being local decides it — and the one with no town at all
     * sits between the local and the far one rather than at the bottom.
     */
    const ranked = rankCourses(field, "hillcrest", () => false, OHIO).map((c) => c.city);
    expect(ranked.slice(0, 3)).toEqual(["Cincinnati", "", "Perth"]);
  });

  it("changes nothing when the club's location is unknown", () => {
    // Guarantee 4: the parameter is optional and inert, so every existing
    // caller keeps the order it had.
    for (const q of ["hill", "golf", "royal"]) {
      expect(rankCourses(field, q)).toEqual(rankCourses(field, q, () => false, undefined));
    }
  });

  it("still prefers a course that can actually be scored on, once location is level", () => {
    // Locality outranks the card, but only between rows that are otherwise
    // equal — two courses in the same town still sort the scoreable one first.
    const two = [course("Hillcrest A", "Cincinnati", "Ohio", "US"), course("Hillcrest B", "Cincinnati", "Ohio", "US")];
    const ranked = rankCourses(two, "hillcrest", (c) => c.name.endsWith("B"), OHIO);
    expect(ranked[0].name).toBe("Hillcrest B");
  });
});
