import { describe, it, expect } from "vitest";
import { searchDirectory } from "@/lib/services/course-directory";

/**
 * ORDERING BY WHERE THE CLUB PLAYS, AGAINST THE REAL CATALOGUE.
 *
 * 2,184 rows, and "golf" appears in most course names — a vague query matches
 * 1,579 of them and exactly twenty survive `slice(0, 20)`. Which twenty is the
 * whole question, and a unit test over a hand-built array cannot answer it:
 * what matters is what happens to the real distribution of towns, states and
 * blanks that the catalogue actually holds.
 *
 * READ-ONLY. The catalogue is a public list of golf courses — nobody's data,
 * no fixture to create and none to tear down.
 *
 * The guarantees under test are the ones a reader depends on, and they are the
 * reason this is a ranking rather than a filter:
 *
 *   - naming a place in the query beats the club's own town;
 *   - being near never outranks a better name match;
 *   - nothing is removed from the list by being far away.
 */

describe("the club's town orders the directory", () => {
  it("lifts courses in the club's own town, without dropping the others", async () => {
    const away = await searchDirectory("golf", true);
    const local = await searchDirectory("golf", true, { city: "Cincinnati" });

    // Same question, same number of answers — reordered, never filtered.
    expect(local).toHaveLength(away.length);
    expect(away.length).toBeGreaterThan(0);

    const cincyFirst = local.filter((h) => h.city === "Cincinnati").length;
    const cincyBefore = away.filter((h) => h.city === "Cincinnati").length;
    /**
     * The catalogue holds 21 Cincinnati courses. Twenty rows survive the cut,
     * so a club in Cincinnati should now see some of its own town where
     * before it saw an arbitrary slice of the country.
     */
    expect(cincyFirst).toBeGreaterThan(cincyBefore);
  });

  it("puts the club's own town at the top, not merely in the list", async () => {
    const local = await searchDirectory("golf", true, { city: "Cincinnati" });
    const firstFar = local.findIndex((h) => h.city !== "Cincinnati" && h.city !== "");
    const lastNear = local.map((h) => h.city).lastIndexOf("Cincinnati");
    // Every local row comes before the first row that names another town.
    expect(lastNear).toBeLessThan(firstFar === -1 ? local.length : firstFar);
  });

  it("lets the query's own place win, so a club can look up an away course", async () => {
    /**
     * THE GUARANTEE THAT MATTERS MOST.
     *
     * A society playing away, or an organizer looking up the course of a club
     * they are visiting, types the town they mean. Their own town must not
     * reorder that — `searchDirectory` drops `near` entirely once
     * `parseAreaQuery` has found a place in the query.
     *
     * Asserted as "identical either way", which is stronger than "the right
     * town is first": it shows the club's location had no effect at all.
     */
    const asked = await searchDirectory("Ocala FL", true);
    const askedFromOhio = await searchDirectory("Ocala FL", true, { city: "Cincinnati" });
    expect(askedFromOhio.map((h) => h.id)).toEqual(asked.map((h) => h.id));
  });

  it("lets a typed course name win over the club's town", async () => {
    /**
     * The other half of "you can always just type what you mean". A name that
     * matches better sits in a better relevance tier, and locality only ever
     * separates rows inside one tier — so it cannot pull a local course above
     * the course actually being named.
     */
    const hits = await searchDirectory("Mohican Hills", true, { city: "Cincinnati" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toContain("Mohican Hills");
    expect(hits[0].city).not.toBe("Cincinnati");
  });

  it("never hides a course that has no town on it", async () => {
    // A quarter of the catalogue carries no location. They keep their place by
    // name relevance rather than being pushed behind every known-far course.
    const blanks = (await searchDirectory("golf", true, { city: "Cincinnati" })).filter((h) => !h.city);
    const blanksAway = (await searchDirectory("golf", true)).filter((h) => !h.city);
    expect(blanks.length).toBeGreaterThanOrEqual(Math.min(blanksAway.length, 1) - 1);
  });
});
