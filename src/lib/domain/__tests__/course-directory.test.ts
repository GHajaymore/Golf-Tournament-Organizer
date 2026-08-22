import { describe, it, expect } from "vitest";
import {
  cardFrom,
  hitsFrom,
  courseFrom,
  cardDifferences,
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

  it("refuses a course with no card at all, and says so plainly", () => {
    const none = cardFrom([]);
    expect(none.usable).toBe(false);
    if (none.usable) return;
    expect(none.reason).toContain("no hole-by-hole card");
  });

  it("refuses a nine-hole listing rather than padding it to eighteen", () => {
    // Guessing the back nine from the front is how a nine-hole club ends up
    // scoring eighteen holes it never played.
    const card = cardFrom(holes(PEBBLE_PARS.slice(0, 9), PEBBLE_SI.slice(0, 9)));
    expect(card.usable).toBe(false);
    if (card.usable) return;
    expect(card.reason).toContain("9 holes");
  });

  it("refuses rubbish without throwing", () => {
    for (const junk of [null, undefined, "nope", 42, {}]) {
      expect(cardFrom(junk).usable).toBe(false);
    }
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

describe("the licence", () => {
  it("names OpenStreetMap and ODbL, because that is the condition of use", () => {
    // ODbL 1.0 permits commercial use WITH attribution. This is an obligation,
    // not a courtesy, so it lives in one constant rather than in a component.
    expect(DIRECTORY_ATTRIBUTION).toContain("OpenStreetMap");
    expect(DIRECTORY_ATTRIBUTION).toContain("ODbL");
  });
});
