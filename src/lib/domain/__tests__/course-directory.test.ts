import { describe, it, expect } from "vitest";
import {
  cardFrom,
  hitsFrom,
  courseFrom,
  cardDifferences,
  countryCode,
  DIRECTORY_ATTRIBUTION,
} from "../course-directory";

/**
 * Reading a card out of a public course directory.
 *
 * The fixtures below are the real shapes the directory returned on
 * 2026-08-21, not invented ones — including Green Crest, which is the reason
 * this module exists. Its card passes every arithmetic check and is wrong on
 * every hole, and nothing already in the app would have caught it.
 */

/** Pebble Beach, as the directory actually returns it. Pars in playing order. */
const PEBBLE_PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const PEBBLE_SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const PEBBLE_YARDS = [378, 509, 397, 333, 189, 498, 107, 416, 483, 444, 370, 202, 401, 559, 393, 400, 182, 541];

const holes = (pars: number[], si: number[], yards: number[] = []) =>
  pars.map((par, i) => ({
    number: i + 1,
    par,
    handicap_index: si[i],
    yardages: yards.length ? { blue: yards[i], white: Math.round(yards[i] * 0.9) } : {},
  }));

describe("a card the directory can be trusted for", () => {
  it("reads Pebble Beach's card straight through", () => {
    const card = cardFrom(holes(PEBBLE_PARS, PEBBLE_SI, PEBBLE_YARDS));
    expect(card.usable).toBe(true);
    if (!card.usable) return;
    expect(card.pars).toEqual(PEBBLE_PARS);
    expect(card.strokeIndex).toEqual(PEBBLE_SI);
    // Longest set on the card — the reference row a printed scorecard carries.
    expect(card.yards).toEqual(PEBBLE_YARDS);
  });

  it("puts the holes in the order the source numbers them, not array order", () => {
    // A directory that returns holes out of order is exactly the failure this
    // module exists to catch, and the hole's own number is the only ordering
    // the source actually asserts.
    const shuffled = [...holes(PEBBLE_PARS, PEBBLE_SI, PEBBLE_YARDS)].reverse();
    const card = cardFrom(shuffled);
    expect(card.usable).toBe(true);
    if (!card.usable) return;
    expect(card.pars).toEqual(PEBBLE_PARS);
  });

describe("a card that must be refused", () => {
  it("refuses Green Crest, whose pars come back sorted rather than routed", () => {
    // The real response: five par 5s, then six par 4s, then seven par 3s.
    // Par total 70 matches the course's own par and the stroke index is a
    // clean 1–18 permutation, so every arithmetic check passes — and the card
    // is wrong on every hole. No golf course is routed in descending par.
    const pars = [5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3];
    const si = [18, 14, 2, 3, 15, 5, 7, 9, 6, 17, 1, 8, 10, 12, 4, 13, 16, 11];
    expect(pars.reduce((a, b) => a + b, 0)).toBe(70);
    expect([...si].sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));

    const card = cardFrom(holes(pars, si));
    expect(card.usable).toBe(false);
    if (card.usable) return;
    expect(card.reason).toContain("sorted order");
  });

  it("refuses an ascending card for the same reason", () => {
    const pars = [3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5];
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    const card = cardFrom(holes(pars, si));
    expect(card.usable).toBe(false);
  });

  it("does not mistake a flat card for a scrambled one", () => {
    // Every hole par 4 is technically both ascending and descending. It is a
    // placeholder, not a shuffled routing, and calling it "sorted" would give
    // the wrong reason for the right refusal.
    const card = cardFrom(holes(new Array(18).fill(4), Array.from({ length: 18 }, (_, i) => i + 1)));
    expect(card.usable).toBe(true);
  });

  it("refuses a stroke index that is not a permutation of 1–18", () => {
    // A duplicate index means one hole gets two shots and another none, for
    // the life of the course, and nothing on screen would ever show it.
    const si = [...PEBBLE_SI];
    si[3] = si[2];
    const card = cardFrom(holes(PEBBLE_PARS, si));
    expect(card.usable).toBe(false);
    if (card.usable) return;
    expect(card.reason).toContain("exactly once");
  });

  it("refuses a par total no eighteen-hole course plays", () => {
    // Found in the catalogue after importing Ohio: "Beaver Creek Meadows Golf
    // Course, par 79". Every other check passes — pars in range, a clean
    // stroke index, a plausible routing — and the card is still not this
    // course's. Real eighteens run 66 to 74.
    const pars = [5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 4, 4, 4, 4];
    expect(pars.reduce((a, b) => a + b, 0)).toBe(79);
    const card = cardFrom(holes(pars, PEBBLE_SI));
    expect(card.usable).toBe(false);
    if (card.usable) return;
    // The wording comes from the shared check in scorecard-parse.ts now, so
    // this asserts the number and the refusal rather than the sentence.
    expect(card.reason).toContain("79");
    expect(card.reason).toContain("no 18-hole course plays");
  });

  it("accepts the pars real courses actually play", () => {
    // 70, 71, 72 are the ordinary ones and must not be caught by the check
    // above — a guard that refuses real cards is worse than no guard.
    for (const last of [3, 4, 5]) {
      const pars = [...PEBBLE_PARS.slice(0, 17), last];
      const total = pars.reduce((a, b) => a + b, 0);
      expect(cardFrom(holes(pars, PEBBLE_SI)).usable, `par ${total}`).toBe(true);
    }
  });

  it("refuses a course with no card at all, and says so plainly", () => {
    const none = cardFrom([]);
    expect(none.usable).toBe(false);
    if (none.usable) return;
    expect(none.reason).toContain("no hole-by-hole card");
  });

  it("takes a nine-hole course as nine holes, and pads nothing", () => {
    /**
     * This used to refuse nine holes outright, and threw away 119 real
     * nine-hole courses out of the 724 US ones catalogued — a quarter of
     * them — while the app has scored nine-hole rounds all along.
     *
     * The old reasoning was about PADDING: guessing a back nine from a front
     * nine is how a club ends up scoring eighteen holes it never played.
     * That is still true and still enforced — the assertion below is that the
     * card comes back NINE long, not eighteen.
     */
    const si9 = [5, 1, 7, 3, 9, 2, 8, 4, 6];
    const card = cardFrom(holes(PEBBLE_PARS.slice(0, 9), si9));
    expect(card.usable).toBe(true);
    if (!card.usable) return;
    expect(card.pars).toHaveLength(9);
    expect(card.strokeIndex).toEqual(si9);
  });

  it("holds a nine-hole card to a nine-hole stroke index", () => {
    // An eighteen-hole index sliced in half is not a nine-hole index: it has
    // gaps and duplicates against 1..9, and would allocate shots to the wrong
    // holes exactly as a bad eighteen would.
    const card = cardFrom(holes(PEBBLE_PARS.slice(0, 9), PEBBLE_SI.slice(0, 9)));
    expect(card.usable).toBe(false);
  });

  it("still refuses a hole count that is neither nine nor eighteen", () => {
    const card = cardFrom(holes(PEBBLE_PARS.slice(0, 10), PEBBLE_SI.slice(0, 10)));
    expect(card.usable).toBe(false);
    if (card.usable) return;
    expect(card.reason).toContain("neither 9 nor 18");
  });

  it("refuses rubbish without throwing", () => {
    for (const junk of [null, undefined, "nope", 42, {}]) {
      expect(cardFrom(junk).usable).toBe(false);
    }
  });
});

describe("what the directory says its par is", () => {
  /**
   * Deliberately NOT used to judge a card, and this is the record of why.
   *
   * It looked like a strong signal: 25 catalogued courses sampled, 24 with
   * the stated par matching the par their own holes add up to. The single
   * disagreement was "Links at Gateway" — stated par 36, holes adding to 72.
   *
   * That looked like a nine-hole course listed twice, and a check was written
   * to refuse it. It is neither: its two nines are DIFFERENT, under a clean
   * 1-18 stroke index. It is a real par-72 course whose `par` field describes
   * one nine. The check would have thrown away a good card on the word of the
   * weaker field, so it was removed.
   */
  it("is ignored: a card is judged on its own holes", () => {
    // Par 72 of holes, whatever any metadata field claims elsewhere.
    const card = cardFrom(holes(PEBBLE_PARS, PEBBLE_SI));
    expect(card.usable).toBe(true);
    if (!card.usable) return;
    expect(card.pars.reduce((a, b) => a + b, 0)).toBe(72);
  });

  it("keeps two different nines under one stroke index", () => {
    // The Links at Gateway shape, which a stated-par check refused: two nines
    // of par 36 that are not each other, indexed 1-18 across the eighteen.
    const front = [5, 4, 4, 4, 3, 5, 4, 3, 4];
    const back = [4, 3, 4, 4, 3, 5, 4, 4, 5];
    expect(front.reduce((a, b) => a + b, 0)).toBe(36);
    expect(back.reduce((a, b) => a + b, 0)).toBe(36);
    expect(front.join()).not.toBe(back.join());
    const card = cardFrom(holes([...front, ...back], PEBBLE_SI));
    expect(card.usable).toBe(true);
  });
});
});

describe("search results", () => {
  it("reads the real search shape", () => {
    const hits = hitsFrom({
      courses: [
        {
          id: "40977ee8", name: "Pebble Beach Golf Links", course_name: "Pebble Beach Golf Links",
          state: "CA", city: "Pebble Beach", par: 72, website: "http://pebblebeach.com/",
        },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: "40977ee8", city: "Pebble Beach", state: "CA", par: 72 });
  });

  it("drops rows with no id or no name rather than offering a dead result", () => {
    expect(hitsFrom({ courses: [{ id: "", name: "X" }, { id: "y", name: "" }] })).toEqual([]);
  });

  it("returns nothing for a payload of the wrong shape", () => {
    for (const junk of [null, undefined, {}, { courses: "no" }, []]) {
      expect(hitsFrom(junk)).toEqual([]);
    }
  });
});

describe("a course in full", () => {
  const payload = {
    id: "40977ee8",
    course_name: "Pebble Beach Golf Links",
    city: "Pebble Beach",
    state: "CA",
    website: "http://pebblebeach.com/",
    address: "1700 17 Mile Dr, Pebble Beach, CA 93953, USA",
    holes_data: holes(PEBBLE_PARS, PEBBLE_SI, PEBBLE_YARDS),
    tees: [
      { tee_name: "Blue", gender: "Male", course_rating: 74.9, slope: 144, par: 72, yardage: 6802 },
      { tee_name: "Gold", gender: "Female", course_rating: 78.2, slope: 146, par: 72, yardage: 6472 },
      { tee_name: "White", gender: "", course_rating: 71.7, slope: 135, par: 72, yardage: 6083 },
    ],
  };

  it("carries the tees, which is the part free sources usually drop", () => {
    const c = courseFrom(payload);
    expect(c).not.toBeNull();
    expect(c!.tees).toHaveLength(3);
    expect(c!.tees[0]).toMatchObject({ name: "Blue", gender: "men", courseRating: 74.9, slopeRating: 144 });
  });

  it("keeps the two genders of the same tee apart", () => {
    // WHS rates identical yardage separately by gender — Pebble's Gold tees
    // are 73.4/137 for men and 78.2/146 for women. Collapsing them shifts
    // every course handicap played off that tee.
    const c = courseFrom(payload)!;
    expect(c.tees[1].gender).toBe("women");
    expect(c.tees[2].gender).toBe("any");
  });

  it("returns a course even when its card is refused", () => {
    // The name, the city and the rated tees are still worth having — they are
    // the tedious part — and the card is reported separately so the club knows
    // it still has to enter one.
    const c = courseFrom({ ...payload, holes_data: [] })!;
    expect(c.name).toBe("Pebble Beach Golf Links");
    expect(c.tees).toHaveLength(3);
    expect(c.card.usable).toBe(false);
  });

  it("is null for a payload with no id or no name", () => {
    expect(courseFrom({ id: "x" })).toBeNull();
    expect(courseFrom({ course_name: "X" })).toBeNull();
    expect(courseFrom(null)).toBeNull();
  });
});

describe("re-checking a course against the source", () => {
  const ours = { pars: PEBBLE_PARS, strokeIndex: PEBBLE_SI };

  it("finds nothing when the two agree", () => {
    expect(cardDifferences(ours, { pars: [...PEBBLE_PARS], strokeIndex: [...PEBBLE_SI] })).toEqual([]);
  });

  it("names the hole and the field that changed", () => {
    const theirs = { pars: [...PEBBLE_PARS], strokeIndex: [...PEBBLE_SI] };
    theirs.pars[6] = 4;
    theirs.strokeIndex[0] = 7;
    const diffs = cardDifferences(ours, theirs);
    expect(diffs).toEqual([
      { hole: 1, field: "strokeIndex", ours: 6, theirs: 7 },
      { hole: 7, field: "par", ours: 3, theirs: 4 },
    ]);
  });

  it("ignores yardage, which is presentation rather than scoring", () => {
    // Eighteen yardage disagreements would bury the two that change how a
    // round is scored — and a directory's yardage depends on which tee it
    // happened to measure.
    const diffs = cardDifferences(ours, { pars: PEBBLE_PARS, strokeIndex: PEBBLE_SI });
    expect(diffs).toEqual([]);
  });
});

describe("where a course is in the world", () => {
  /**
   * The directory is global — it was walked state by state only because the
   * one listing endpoint that takes a place is per US state. A course outside
   * the US has no `state` at all, so without a country it is stored with two
   * blank location fields and cannot be told from any other course of the
   * same name.
   */
  it("reads the country off a search row", () => {
    const hits = hitsFrom({
      courses: [{ id: "x", name: "'t Kruisselt", city: "Ootmarsum", country_iso: "NL" }],
    });
    expect(hits[0].country).toBe("NL");
  });

  it("upper-cases it, because a filter that is case-sensitive is a filter that misses", () => {
    expect(hitsFrom({ courses: [{ id: "x", name: "Y", country_iso: "nl" }] })[0].country).toBe("NL");
  });

  it("is empty rather than guessed when the row does not say", () => {
    expect(hitsFrom({ courses: [{ id: "x", name: "Y" }] })[0].country).toBe("");
  });

  it("does NOT come from the course detail, which has no country at all", () => {
    /**
     * The bug this pins. `country_iso` exists only on a search row; the detail
     * payload has no country field of any kind. Reading it off the course
     * stored every course in the world with a blank country — 583 rows, every
     * one of them blank, and nothing failed to say so.
     *
     * So the importer carries the country from the LISTING into `store`, and
     * this test exists to stop anyone "tidying" that up.
     */
    const detail = courseFrom({
      id: "x", course_name: "Golf de Chantilly", city: "Chantilly", holes_data: [], tees: [],
    });
    expect(detail).not.toBeNull();
    expect(detail!.country).toBe("");
  });
});

describe("one country vocabulary across two providers", () => {
  /**
   * The catalogue held the same country twice: 187 rows of "GB" from
   * OpenGolfAPI beside 10 of "United Kingdom" from GolfCourseAPI, "KR" beside
   * "Republic of Korea", "CA" beside "Canada". Nothing failed — a country is
   * only ever displayed — but one country grouped as two, and the picker's
   * `country !== "US"` suppression missed every row spelling it out, so a
   * course in Ohio read "New Albany, United States" next to a plain
   * "New Albany".
   */
  it("turns the name a provider sends into the code the catalogue stores", () => {
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("Republic of Korea")).toBe("KR");
    expect(countryCode("United States")).toBe("US");
    expect(countryCode("Dominican Republic")).toBe("DO");
  });

  it("leaves a code that is already a code alone", () => {
    expect(countryCode("GB")).toBe("GB");
    expect(countryCode("nl")).toBe("NL");
  });

  it("is blank for absent and for 'Unknown', which this directory really sends", () => {
    // Coorg Golf Links and Japeri Golf Links both arrived this way. A course
    // with no known country is honest; one filed under a guess is not.
    expect(countryCode("Unknown")).toBe("");
    expect(countryCode("unknown")).toBe("");
    expect(countryCode("")).toBe("");
    expect(countryCode("   ")).toBe("");
  });

  /**
   * The point of the whole thing. A name nobody has mapped stays as it came:
   * a wrong two-letter code files a course under the wrong country and is
   * invisible once written, whereas an unmapped long name is merely untidy and
   * shows up the moment anyone looks at the column. Do not "improve" this into
   * a fuzzy match or a first-two-letters fallback — "Switzerland" would become
   * "SW", which is not a country, and "Slovakia" and "Slovenia" would collide.
   */
  it("returns an unrecognised name unchanged rather than guessing a code", () => {
    expect(countryCode("Kingdom of Far Far Away")).toBe("Kingdom of Far Far Away");
    expect(countryCode("Switzerland")).not.toBe("SW");
  });

  it("maps every long-form name the catalogue actually collected", () => {
    // The thirteen observed on 2026-08-25, so a re-run of the backfill is a
    // no-op rather than a second vocabulary. Every one must resolve to a code.
    const collected = [
      "Canada", "United Kingdom", "Republic of Korea", "Australia", "United States",
      "Ireland", "Costa Rica", "Papua New Guinea", "Dominican Republic", "Serbia",
      "Brunei Darussalam", "Sri Lanka", "Taiwan (Province of China)",
    ];
    for (const name of collected) {
      expect(countryCode(name), name).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("the licence", () => {
  it("names OpenStreetMap and ODbL, because that is the condition of use", () => {
    // ODbL 1.0 permits commercial use WITH attribution. This is an obligation,
    // not a courtesy, so it lives in one constant rather than in a component.
    expect(DIRECTORY_ATTRIBUTION).toContain("OpenStreetMap");
    expect(DIRECTORY_ATTRIBUTION).toContain("ODbL");
  });
});
