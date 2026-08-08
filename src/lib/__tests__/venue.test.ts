import { describe, it, expect } from "vitest";
import {
  courseModeOf,
  needsVenue,
  needsNine,
  normalizeCourseName,
  matchCourse,
  defaultTeeFor,
  teeProblems,
  cardProblems,
  libraryProvider,
  findCard,
  type TeeLike,
} from "../domain/venue";

/**
 * Tournaments with no fixed course.
 *
 * Everything here protects one thing: a card is never invented and never
 * silently attached to the wrong course. Par and stroke index decide net
 * scores and where handicap strokes fall, so a wrong card is not a rough
 * answer — it is a wrong result that looks entirely normal on the screen.
 */

describe("how a tournament decides where it is played", () => {
  it("treats anything other than open as a fixed venue", () => {
    // The safe default: an unrecognised or missing value must not turn a club
    // medal into a tournament that asks every player where they played.
    expect(courseModeOf("open")).toBe("open");
    for (const v of ["fixed", "", null, undefined, "nonsense"]) {
      expect(courseModeOf(v)).toBe("fixed");
    }
  });

  it("never asks a fixed-course tournament where it was played", () => {
    expect(needsVenue("fixed", {})).toBe(false);
  });

  it("asks an open tournament only when nothing up the chain has answered", () => {
    expect(needsVenue("open", {})).toBe(true);
    expect(needsVenue("open", { matchCourseId: "c1" })).toBe(false);
    expect(needsVenue("open", { roundCourseId: "c1" })).toBe(false);
    expect(needsVenue("open", { eventCourse: "Maketewah" })).toBe(false);
  });

  it("does not count a blank event course as an answer", () => {
    expect(needsVenue("open", { eventCourse: "   " })).toBe(true);
  });
});

describe("which nine", () => {
  it("asks on a nine-hole round that hasn't said", () => {
    // Front and back have different pars and a different stroke index, so
    // scoring nine holes against the wrong half puts shots on holes nobody
    // played.
    expect(needsNine(9, null)).toBe(true);
    expect(needsNine(9, "full")).toBe(true);
  });

  it("stops asking once it knows", () => {
    expect(needsNine(9, "front")).toBe(false);
    expect(needsNine(9, "back")).toBe(false);
  });

  it("never asks on eighteen", () => {
    expect(needsNine(18, null)).toBe(false);
  });
});

describe("matching a typed course name to the club's list", () => {
  const library = [
    { id: "a", name: "Maketewah Country Club" },
    { id: "b", name: "Hyde Park Golf & Country Club" },
    { id: "c", name: "The Links at Stonebridge" },
  ];

  it("folds the suffixes and punctuation a club name is written with", () => {
    // These are the same course typed by four different people.
    const forms = ["Maketewah Country Club", "Maketewah CC", "maketewah c.c.", "  MAKETEWAH  "];
    for (const f of forms) {
      const m = matchCourse(f, library);
      expect(m.kind, f).toBe("exact");
      expect(m.kind === "exact" && m.course.id, f).toBe("a");
    }
  });

  it("ignores words that carry no identity", () => {
    expect(normalizeCourseName("The Links at Stonebridge")).toBe("stonebridge");
    const m = matchCourse("Stonebridge", library);
    expect(m.kind === "exact" && m.course.id).toBe("c");
  });

  it("treats an apostrophe as noise", () => {
    expect(normalizeCourseName("St. Andrew's")).toBe(normalizeCourseName("St Andrews"));
  });

  it("offers a choice rather than guessing between two real candidates", () => {
    // Attaching a round to the wrong course scores it against the wrong
    // stroke index, so an ambiguous name must reach a human.
    const twoOaks = [
      { id: "x", name: "Oak Hill Country Club" },
      { id: "y", name: "Oak Hill Golf Club" },
    ];
    const m = matchCourse("Oak Hill", twoOaks);
    expect(m.kind).toBe("suggest");
    expect(m.kind === "suggest" && m.candidates).toHaveLength(2);
  });

  it("refuses to merge two different clubs with a shared prefix", () => {
    const near = [{ id: "x", name: "Oak Ridge Country Club" }];
    const m = matchCourse("Oak Hill", near);
    // May suggest, must never claim they are the same course.
    expect(m.kind).not.toBe("exact");
  });

  it("reports a genuinely new course as new, keeping what was typed", () => {
    const m = matchCourse("Shaker Run", library);
    expect(m.kind).toBe("new");
    expect(m.kind === "new" && m.name).toBe("Shaker Run");
  });

  it("treats an empty name as new rather than matching everything", () => {
    expect(matchCourse("   ", library).kind).toBe("new");
  });
});

describe("which tee a player is rated against", () => {
  const tees: TeeLike[] = [
    { id: "other-club", courseId: "zzz", name: "Championship", courseRating: 74.1, slopeRating: 140, par: 72 },
    { id: "white", courseId: "c1", name: "White", courseRating: 70.2, slopeRating: 124, par: 72, position: 1 },
    { id: "blue", courseId: "c1", name: "Blue", courseRating: 72.4, slopeRating: 133, par: 72, position: 0 },
    { id: "unrated", courseId: "c1", name: "Forward", courseRating: 0, slopeRating: 0, par: 72, position: -1 },
  ];

  it("only ever picks a tee belonging to the course being played", () => {
    // The bug this replaces: an unscoped query returned every club's tees and
    // the fallback took the first row, so a player with no tee set could be
    // rated off another organization's championship tees.
    const t = defaultTeeFor("c1", tees);
    expect(t?.courseId).toBe("c1");
    expect(t?.id).not.toBe("other-club");
  });

  it("prefers a rated tee, because an unrated one cannot produce a handicap", () => {
    // "Forward" sorts first by position but has no slope or rating, so
    // choosing it would silently zero every player's course handicap.
    expect(defaultTeeFor("c1", tees)?.id).toBe("blue");
  });

  it("falls back to an unrated tee only when nothing is rated", () => {
    const unratedOnly = tees.filter((t) => t.id === "unrated");
    expect(defaultTeeFor("c1", unratedOnly)?.id).toBe("unrated");
  });

  it("has no answer for a course with no tees, rather than borrowing one", () => {
    expect(defaultTeeFor("c-empty", tees)).toBeNull();
    expect(defaultTeeFor(null, tees)).toBeNull();
  });
});

describe("checking a tee before it rates anybody", () => {
  const good = { name: "Blue", courseRating: 72.4, slopeRating: 133, par: 72 };

  it("accepts a properly rated set of tees", () => {
    expect(teeProblems(good)).toEqual([]);
  });

  it("rejects a slope outside the range the USGA actually issues", () => {
    expect(teeProblems({ ...good, slopeRating: 0 })).toHaveLength(1);
    expect(teeProblems({ ...good, slopeRating: 200 })[0]).toContain("55 and 155");
  });

  it("rejects a course rating that is really a par", () => {
    // Someone typing 72 for both is the common slip, and it shifts every
    // course handicap by the difference.
    expect(teeProblems({ ...good, courseRating: 0 })).toHaveLength(1);
  });

  it("asks for the name printed on the card", () => {
    expect(teeProblems({ ...good, name: "  " })[0]).toContain("Blue");
  });
});

describe("checking a card before it scores anything", () => {
  const pars = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  const si = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];

  it("accepts a real eighteen-hole card", () => {
    expect(cardProblems({ pars, strokeIndex: si }, 18)).toEqual([]);
  });

  it("rejects a stroke index with a repeat", () => {
    // The defect that matters most: a duplicated index means one hole gets
    // two strokes and another gets none, and no total looks wrong.
    const dupe = [...si];
    dupe[5] = dupe[0];
    const problems = cardProblems({ pars, strokeIndex: dupe }, 18);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("exactly once");
  });

  it("rejects an incomplete card", () => {
    expect(cardProblems({ pars: pars.slice(0, 10), strokeIndex: si }, 18).length).toBeGreaterThan(0);
  });

  it("rejects a par nobody plays", () => {
    const silly = [...pars];
    silly[0] = 9;
    expect(cardProblems({ pars: silly, strokeIndex: si }, 18)[0]).toContain("between 3 and 6");
  });

  it("checks a nine-hole card against 1..9, not 1..18", () => {
    expect(cardProblems({ pars: pars.slice(0, 9), strokeIndex: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, 9)).toEqual([]);
    // The front nine of an 18-hole card has odd indexes only, which is a
    // perfectly normal card but not a valid standalone nine.
    expect(cardProblems({ pars: pars.slice(0, 9), strokeIndex: si.slice(0, 9) }, 9).length).toBe(1);
  });
});

describe("finding a card", () => {
  const library = [
    { id: "a", name: "Maketewah Country Club", city: "Cincinnati, OH", pars: [4], yards: [400], strokeIndex: [1] },
  ];

  it("answers from the club's own courses, marked confirmed", () => {
    // A card somebody at this club entered outranks anything found elsewhere,
    // and is the reason a league becomes quick after its first few weeks.
    return findCard([libraryProvider(library)], { name: "Maketewah CC" }).then((r) => {
      expect(r?.cards[0].name).toBe("Maketewah Country Club");
      expect(r?.cards[0].confidence).toBe("confirmed");
    });
  });

  it("returns nothing for a course the club has never played", async () => {
    expect(await findCard([libraryProvider(library)], { name: "Shaker Run" })).toBeNull();
  });

  it("keeps going when a provider throws", async () => {
    // A lookup service being down must never block entering a card by hand.
    const broken = { name: "Broken", find: async () => { throw new Error("offline"); } };
    const r = await findCard([broken, libraryProvider(library)], { name: "Maketewah" });
    expect(r?.from).toBe("This club's courses");
  });
});

describe("an event that holds a card but no course name", () => {
  it("is not asked where it was played", async () => {
    // An open tournament whose organizer pasted a card at setup already has
    // par and stroke index; asking for a venue would be a question the app
    // does not need the answer to.
    const { needsVenue } = await import("../domain/venue");
    expect(needsVenue("open", { eventCourse: "", eventHasCard: true })).toBe(false);
    expect(needsVenue("open", { eventCourse: "", eventHasCard: false })).toBe(true);
  });
});
