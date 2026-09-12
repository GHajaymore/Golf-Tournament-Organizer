import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { searchDirectory } from "@/lib/services/course-directory";

/**
 * ORDERING THE COURSE DIRECTORY BY THE TOWN THE CLUB PLAYS IN.
 *
 * The real catalogue is 2,184 rows and "golf" appears in most course names, so
 * a vague query matches 1,579 of them and exactly twenty survive. Which twenty
 * is the whole question.
 *
 * IT BUILDS ITS OWN CATALOGUE, and the first version did not — it searched
 * whatever the developer's machine happened to hold, passed there, and failed
 * in CI against a database built from migrations with no catalogue in it at
 * all. A test that reads ambient data is a test that asserts about one
 * machine. The fixture rule this repo already has for events and players
 * applies just as well to a catalogue: create what you need, mark it, delete
 * it in a `finally`.
 *
 * The fixture is shaped to reproduce the actual fault rather than to be small:
 * `searchDirectory` takes 100 rows from the database ORDERED BY NAME before
 * anything is ranked, so a query matching more than that gets an arbitrary
 * alphabetical slice. The home-town rows here are deliberately named so they
 * fall outside the first hundred — which is exactly why ranking alone changed
 * nothing, and why the club's town is now fetched in its own query.
 */

const MARK = "zzloc";
const HOME = "Zzhometown";
/** Comfortably past the 100-row cut the database applies before ranking. */
const FILLER = 130;
const LOCAL = 6;

beforeAll(async () => {
  await prisma.courseCatalog.deleteMany({ where: { name: { startsWith: MARK } } });
  const rows: { id: string; name: string; city: string; state: string; country: string; par: number }[] = [];
  /**
   * "Aaa" so every filler row sorts BEFORE the local ones by name, which is
   * the order the database cut uses. Without the home-town query none of the
   * local rows would reach the ranker at all.
   */
  for (let i = 0; i < FILLER; i += 1) {
    rows.push({
      id: `${MARK}-far-${i}`,
      name: `${MARK} Aaa Golf Club ${String(i).padStart(3, "0")}`,
      city: "Farborough",
      state: "ZZ",
      country: "US",
      par: 72,
    });
  }
  for (let i = 0; i < LOCAL; i += 1) {
    rows.push({
      id: `${MARK}-home-${i}`,
      name: `${MARK} Zzz Golf Club ${i}`,
      city: HOME,
      state: "ZZ",
      country: "US",
      par: 72,
    });
  }
  // One with no town at all — a quarter of the real catalogue is like this.
  rows.push({ id: `${MARK}-blank`, name: `${MARK} Zzz Golf Club nowhere`, city: "", state: "", country: "", par: 72 });
  // And one whose NAME is the thing somebody would type, far away.
  rows.push({ id: `${MARK}-named`, name: `${MARK} Mohican Ridge`, city: "Farborough", state: "ZZ", country: "US", par: 72 });
  await prisma.courseCatalog.createMany({ data: rows, skipDuplicates: true });
});

afterAll(async () => {
  await prisma.courseCatalog.deleteMany({ where: { name: { startsWith: MARK } } });
});

// Every fixture name begins with the mark, so this matches all of them and
// leaves locality as the only thing separating them.
const q = MARK;

describe("the club's town orders the directory", () => {
  it("lifts the club's own town into the twenty, where the cut had excluded it", async () => {
    const away = await searchDirectory(q, true);
    const local = await searchDirectory(q, true, { city: HOME });

    expect(away.length).toBeGreaterThan(0);
    expect(local).toHaveLength(away.length);

    const homeAway = away.filter((h) => h.city === HOME).length;
    const homeNear = local.filter((h) => h.city === HOME).length;
    /**
     * The measurement that made this worth building. Ranking alone left this
     * at zero on both sides: the local rows never survived the database's
     * alphabetical cut to BE ranked.
     */
    expect(homeAway).toBe(0);
    expect(homeNear).toBeGreaterThan(0);
  });

  it("puts them at the top rather than merely in the list", async () => {
    const local = await searchDirectory(q, true, { city: HOME });
    const firstFar = local.findIndex((h) => h.city !== HOME && h.city !== "");
    const lastNear = local.map((h) => h.city).lastIndexOf(HOME);
    expect(lastNear).toBeLessThan(firstFar === -1 ? local.length : firstFar);
  });

  it("lets a typed course name win over the club's town", async () => {
    /**
     * "You can always just type what you mean." A better name match sits in a
     * better relevance tier, and locality only separates rows inside one tier,
     * so it cannot pull a local course above the course being named.
     */
    const hits = await searchDirectory(`${MARK} Mohican Ridge`, true, { city: HOME });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toContain("Mohican Ridge");
    expect(hits[0].city).not.toBe(HOME);
  });

  it("never hides a course that has no town on it", async () => {
    // Unplaced rows rank with "same country", never last — demoting them would
    // be filtering wearing a ranking's clothes.
    const local = await searchDirectory(`${MARK} Zzz Golf`, true, { city: HOME });
    expect(local.some((h) => h.id === `${MARK}-blank`)).toBe(true);
  });

  it("changes nothing at all when the club has no town", async () => {
    const a = await searchDirectory(q, true);
    const b = await searchDirectory(q, true, undefined);
    expect(b.map((h) => h.id)).toEqual(a.map((h) => h.id));
  });
});
