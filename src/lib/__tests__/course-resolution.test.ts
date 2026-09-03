import { describe, it, expect } from "vitest";
import {
  courseForMatch,
  courseForRound,
  applyNine, cardForStage,
  cardForMatch,
  nineForMatch,
  type StoredCourse,
  type EventCourseFields,
} from "../services/course-resolution";
import { holeStrokesReceived, allocationHoles } from "../domain/stroke";
import { hasCourseData } from "../courses";

const arr = (n: number) => JSON.stringify(new Array(18).fill(n));

const stored = (name: string, par = 4): StoredCourse => ({
  id: `c-${name}`,
  name,
  city: "Somewhere",
  pars: arr(par),
  yards: arr(400),
  strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
});

const blankEvent: EventCourseFields = {
  course: "",
  city: "",
  customPars: "",
  customYards: "",
  customStrokeIndex: "",
};

// A club course with its own card — which is now the only way an event has
// real hole data. The bundled "presets" this used to name were invented
// layouts, and scoring a tournament against them was the bug they caused.
const presetEvent: EventCourseFields = {
  ...blankEvent,
  course: "Bushwood",
  customPars: JSON.stringify(Array(18).fill(4)),
  customYards: JSON.stringify(Array(18).fill(400)),
  customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
};

/**
 * Which half a MATCH is played over.
 *
 * `Match.nine` is written by two actions and was read in one place, and there
 * only when the match ALSO named its own course. So a pairing that played the
 * round's course on the other nine had its choice ignored: the match was
 * scored on the round's half, counting a 4 on the par-5 11th as nothing and a
 * 4 on the par-3 13th as a birdie, and allocating strokes off the wrong
 * indexes. The board and the stored result then disagreed.
 */
describe("which nine a match is played over", () => {
  it("takes the match's own half when it has one", () => {
    expect(nineForMatch({ nine: "back" }, { nine: "front" })).toBe("back");
    expect(nineForMatch({ nine: "front" }, { nine: "back" })).toBe("front");
  });

  it("takes the match's half even when it names no course of its own", () => {
    // The whole fault in one line: this is a pairing playing the round's
    // course on the other nine, which is the ordinary way it happens.
    expect(nineForMatch({ nine: "back" }, { nine: "front" })).toBe("back");
  });

  it("falls back to the round when the match says nothing", () => {
    expect(nineForMatch({ nine: "full" }, { nine: "back" })).toBe("back");
    expect(nineForMatch({ nine: "" }, { nine: "back" })).toBe("back");
    expect(nineForMatch({}, { nine: "back" })).toBe("back");
    expect(nineForMatch(null, { nine: "back" })).toBe("back");
  });

  it("treats 'full' as no answer rather than as the whole card", () => {
    /**
     * "full" is the default on every match nobody has touched, and it is a
     * real option in the picker ("Not fixed"). Letting it override would mean
     * every untouched match silently cancelled its round's nine.
     */
    expect(nineForMatch({ nine: "full" }, { nine: "front" })).toBe("front");
    expect(nineForMatch({ nine: "full" }, { nine: "full" })).toBe("full");
  });

  it("reads anything unrecognised as no answer", () => {
    expect(nineForMatch({ nine: "middle" }, { nine: "back" })).toBe("back");
  });

  it("scores the back nine's pars when the match says back and the round says front", () => {
    // End to end, on a card whose two halves differ: par 3s on the front, par
    // 5s on the back, so the wrong half is unmissable.
    const course = {
      name: "Split",
      pars: [...new Array(9).fill(3), ...new Array(9).fill(5)],
      yards: new Array(18).fill(400),
      strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    };
    const card = cardForMatch(course, { nine: "back" }, { holes: 9, nine: "front" });

    expect(card.pars).toEqual(new Array(9).fill(5));
    // And its indexes are re-ranked 1..9, not left as the back nine's 10..18.
    expect([...card.strokeIndex].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("leaves an eighteen-hole match on the whole card whatever it says", () => {
    const course = {
      name: "Full",
      pars: [...new Array(9).fill(3), ...new Array(9).fill(5)],
      yards: new Array(18).fill(400),
      strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    };
    expect(cardForMatch(course, { nine: "back" }, { holes: 18, nine: "front" }).pars).toHaveLength(18);
  });
});

/**
 * Eighteen holes on a nine-hole course, which is how nine-hole clubs run one.
 *
 * The catalogue holds 54 genuine nine-hole cards — `parseHoleArray` accepts
 * them precisely so those clubs can score — and nothing lengthened one for an
 * eighteen-hole round. The card was handed on at nine and every reader indexed
 * off the end of it.
 */
describe("an eighteen-hole round on a nine-hole card", () => {
  /** A real nine: par 35, indexes 1..9, and a distinctive yardage per hole. */
  const nineHole = {
    name: "Short Nine",
    pars: [4, 3, 5, 4, 4, 3, 4, 4, 4],
    yards: [300, 310, 320, 330, 340, 350, 360, 370, 380],
    strokeIndex: [5, 9, 1, 3, 7, 8, 2, 4, 6],
  };

  it("plays the nine twice", () => {
    const card = cardForStage(nineHole, { holes: 18, nine: "full" });
    expect(card.pars).toHaveLength(18);
    expect(card.pars.slice(0, 9)).toEqual(nineHole.pars);
    expect(card.pars.slice(9)).toEqual(nineHole.pars);
    expect(card.yards.slice(9)).toEqual(nineHole.yards);
  });

  it("scores the second nine against real pars, not zero", () => {
    /**
     * `pars[i] ?? 0` for holes 10-18 scored those nine against a par of ZERO.
     * A level round read +54 rather than level, and Stableford paid nothing
     * for the whole back half.
     */
    const card = cardForStage(nineHole, { holes: 18, nine: "full" });
    const par = card.pars.reduce((a, b) => a + b, 0);
    expect(par).toBe(70); // 35 twice
    expect(card.pars.every((p) => p > 0)).toBe(true);
  });

  it("allocates on a base of eighteen, so a 10 gets ten strokes and not nineteen", () => {
    /**
     * The money half. `allocationHoles` reads the index length, so a
     * nine-length array put an eighteen-hole round on a base of NINE: one
     * stroke a hole plus a second on SI 1, nineteen in total for a Course
     * Handicap of 10.
     */
    const card = cardForStage(nineHole, { holes: 18, nine: "full" });
    // Counted the way a consumer counts it: eighteen holes, reading the card
    // with `?? 18` for anything past its end. Summing the card's own array
    // instead would hide the fault, because a short array is short in the
    // total too — the nineteen strokes come from the nine holes that fall off
    // the end and are allocated on a base of nine.
    const base = allocationHoles(card.strokeIndex.length);
    const total = Array.from({ length: 18 }, (_, i) =>
      holeStrokesReceived(10, card.strokeIndex[i] ?? 18, base),
    ).reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
  });

  it("gives the second lap of a hole the same difficulty order, nine later", () => {
    // The standard doubled-nine allocation: the hardest hole is SI 1 the first
    // time round and SI 10 the second.
    const card = cardForStage(nineHole, { holes: 18, nine: "full" });
    expect([...card.strokeIndex].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
    for (let h = 0; h < 9; h += 1) {
      expect(card.strokeIndex[h + 9]).toBe(card.strokeIndex[h] + 9);
    }
  });

  it("re-ranks a nine stored with eighteen-hole numbers before doubling", () => {
    /**
     * A stored "nine" can carry one half of an eighteen-hole card's indexes —
     * 1,3,5,...,17. Adding nine to those would run past eighteen and allocate
     * nothing at all on the second lap.
     */
    const oddNine = { ...nineHole, strokeIndex: [1, 3, 5, 7, 9, 11, 13, 15, 17] };
    const card = cardForStage(oddNine, { holes: 18, nine: "full" });
    expect([...card.strokeIndex].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
  });

  it("leaves a nine-hole ROUND on a nine-hole card exactly as it was", () => {
    // The case that already worked: nine holes on a nine-hole course is the
    // card itself, and must not be doubled or narrowed.
    const card = cardForStage(nineHole, { holes: 9, nine: "full" });
    expect(card.pars).toEqual(nineHole.pars);
    expect(card.strokeIndex).toEqual(nineHole.strokeIndex);
  });

  it("leaves an eighteen-hole card alone", () => {
    const full = {
      name: "Regulation",
      pars: new Array(18).fill(4),
      yards: new Array(18).fill(400),
      strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    };
    expect(cardForStage(full, { holes: 18, nine: "full" })).toEqual(full);
  });
});

describe("course resolution hierarchy", () => {
  it("prefers the match's own course", () => {
    const r = courseForMatch(stored("Match Venue"), stored("Round Venue"), presetEvent);
    expect(r?.name).toBe("Match Venue");
    expect(r?.source).toBe("match");
  });

  it("falls back to the round when the match has none", () => {
    // Multi-day event: the organizer booked a venue per day.
    const r = courseForMatch(null, stored("Round Venue"), presetEvent);
    expect(r?.name).toBe("Round Venue");
    expect(r?.source).toBe("round");
  });

  it("falls back to the event when neither is set", () => {
    // The ordinary single-venue tournament — nobody is ever asked.
    const r = courseForMatch(null, null, presetEvent);
    expect(r?.name).toBe("Bushwood");
    expect(r?.source).toBe("event");
  });

  it("returns null when nothing anywhere has course data", () => {
    // A community league with no venue. Callers decide whether that's fatal:
    // it is for net/stroke scoring, it isn't for gross match play.
    expect(courseForMatch(null, null, blankEvent)).toBeNull();
  });

  it("resolves a round without consulting any match", () => {
    expect(courseForRound(stored("Round Venue"), presetEvent)?.source).toBe("round");
    expect(courseForRound(null, presetEvent)?.source).toBe("event");
    expect(courseForRound(null, blankEvent)).toBeNull();
  });

  it("skips a level whose stored data is corrupt rather than failing outright", () => {
    const broken: StoredCourse = { ...stored("Broken"), pars: "not json" };
    const r = courseForMatch(broken, stored("Round Venue"), presetEvent);
    expect(r?.name).toBe("Round Venue");
  });

  it("reads an event's saved custom card when it isn't a preset", () => {
    const custom: EventCourseFields = {
      course: "Hidden Valley",
      city: "Elsewhere",
      customPars: arr(5),
      customYards: arr(500),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    };
    const r = courseForMatch(null, null, custom);
    expect(r?.name).toBe("Hidden Valley");
    expect(r?.pars[0]).toBe(5);
  });
});

describe("nine selection", () => {
  const full = courseForRound(stored("Eighteen"), blankEvent)!;
  const indexed = {
    ...full,
    pars: [4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    strokeIndex: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  };

  it("leaves an 18-hole round untouched", () => {
    expect(applyNine(indexed, "full", 18).pars).toHaveLength(18);
    expect(applyNine(indexed, "front", 18).pars).toHaveLength(18);
  });

  it("takes the front nine", () => {
    const r = applyNine(indexed, "front", 9);
    expect(r.pars).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(r.strokeIndex).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.name).toMatch(/front nine/);
  });

  it("takes the back nine, and re-ranks its indexes to 1..9", () => {
    // CHANGED, deliberately. This used to expect [10..18] — the raw slice —
    // and that expectation was the bug: every consumer allocates strokes on a
    // base of nine, so nine holes numbered 10..18 put a five-stroke player's
    // shots on no holes at all. A nine is ranked 1..9 within itself.
    const r = applyNine(indexed, "back", 9);
    expect(r.pars).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(r.strokeIndex).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.name).toMatch(/back nine/);
  });

  it("keeps each nine's own order of difficulty", () => {
    // A real card, where the stroke index does NOT ascend with hole number.
    // This is what "the back nine allocates differently from the front"
    // actually means — and the property the old sequential fixture could not
    // express, because on it both nines genuinely do rank 1..9 in hole order.
    const real = {
      ...full,
      pars: [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4],
      strokeIndex: [5, 11, 1, 15, 3, 17, 7, 13, 9, 10, 2, 16, 6, 12, 4, 18, 8, 14],
    };
    const front = applyNine(real, "front", 9);
    const back = applyNine(real, "back", 9);

    // Relative difficulty preserved: SI 1 on the front was hole 3, and it is
    // still the hardest of that nine.
    expect(front.strokeIndex).toEqual([3, 6, 1, 8, 2, 9, 4, 7, 5]);
    // The back's hardest is its second hole (SI 2 of the eighteen).
    expect(back.strokeIndex).toEqual([5, 1, 8, 3, 6, 2, 9, 4, 7]);
    expect(front.strokeIndex).not.toEqual(back.strokeIndex);

    // Both are a genuine 1..9 — nine holes, nine ranks, no gaps or repeats.
    for (const nine of [front, back]) {
      expect([...nine.strokeIndex].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
  });
});


describe("the tournament's own course, by id", () => {
  /**
   * Event.courseId is what the organizer picked; Event.course is the name
   * kept beside it. Until this, only the name was ever read — so a club with
   * two courses of the same name, or a course renamed after the tournament
   * was set up, resolved to whichever row the name happened to hit.
   *
   * Reading it is opt-in per query, so these tests pin both halves: what a
   * caller that loaded the row gets, and that a caller which did not is
   * completely unaffected.
   */
  const withRef = (over: Partial<EventCourseFields> = {}): EventCourseFields => ({
    ...blankEvent,
    courseRef: stored("Blue Ash", 5),
    ...over,
  });

  it("scores against the course the organizer picked", () => {
    const c = courseForRound(null, withRef());
    expect(c?.name).toBe("Blue Ash");
    expect(c?.pars[0]).toBe(5);
    expect(c?.source).toBe("event");
  });

  it("beats the name beside it, because the id is what was chosen", () => {
    // The event's own custom card must not win over the row that was picked.
    const c = courseForRound(null, withRef({
      course: "Typed By Hand",
      customPars: arr(3),
      customYards: arr(300),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    }));
    expect(c?.name).toBe("Blue Ash");
  });

  it("still loses to a round venue, which is more specific", () => {
    // The hierarchy is unchanged: match beats round beats event.
    const c = courseForRound(stored("Royal Crest", 3), withRef());
    expect(c?.name).toBe("Royal Crest");
    expect(c?.source).toBe("round");
  });

  it("and to a match venue", () => {
    const c = courseForMatch(stored("Hillcrest", 3), stored("Royal Crest", 4), withRef());
    expect(c?.name).toBe("Hillcrest");
    expect(c?.source).toBe("match");
  });

  it("falls through to the event's own card when the row will not parse", () => {
    // A broken row must not take a working card away. COURSES is empty — the
    // bundled presets were removed as invented layouts — so the event's own
    // custom card is what "the old path" actually means here.
    const broken = { ...stored("Blue Ash"), pars: "not json" };
    const c = courseForRound(null, {
      ...blankEvent,
      course: "Typed By Hand",
      customPars: arr(4),
      customYards: arr(400),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      courseRef: broken,
    });
    expect(c?.name).toBe("Typed By Hand");
    expect(c?.pars[0]).toBe(4);
  });

  it("changes nothing for a caller that did not load the row", () => {
    // The whole migration rests on this: an unchanged query is unchanged
    // behaviour, so the readers can be moved one at a time.
    const base = { ...blankEvent, course: "Typed By Hand", customPars: arr(4), customYards: arr(400), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)) };
    const before = courseForRound(null, base);
    const after = courseForRound(null, { ...base, courseRef: null });
    expect(after).toEqual(before);
  });
});

describe("whether a tournament has course data at all", () => {
  /**
   * This gates score entry, and it nearly blocked the ordinary case.
   *
   * saveEvent clears the event's own card when the venue changes, so a club
   * that picks a course from their library has a courseId and NO custom card.
   * Reading only the custom fields, that is "no course data" — and the entry
   * screen refuses a tournament whose venue is perfectly well known.
   */
  const blank = { course: "", customPars: "", customYards: "", customStrokeIndex: "" };

  it("counts a course picked from the library, with no custom card", () => {
    expect(hasCourseData({ ...blank, courseRef: stored("Blue Ash") })).toBe(true);
  });

  it("still counts a card typed onto the event itself", () => {
    const si = JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(
      hasCourseData({ ...blank, customPars: arr(4), customYards: arr(400), customStrokeIndex: si }),
    ).toBe(true);
  });

  it("is false when there is genuinely nothing", () => {
    expect(hasCourseData({ ...blank, courseRef: null })).toBe(false);
  });

  it("does not count a picked course whose card will not parse", () => {
    // Pointing at a row is not the same as that row having numbers on it.
    const broken = { ...stored("Blue Ash"), pars: "not json" };
    expect(hasCourseData({ ...blank, courseRef: broken })).toBe(false);
  });
});
/**
 * The card a round is actually played on.
 *
 * `applyNine` was always right; calling it was optional, and thirteen scoring
 * and money call sites did the obvious thing instead — take the first `holes`
 * values off the card. That takes the right NUMBER of holes and the wrong
 * VALUES, because an eighteen-hole stroke index is ranked across eighteen
 * holes: the front nine of an ordinary card carries 1,3,5,...,17.
 *
 * The arithmetic below is the one from the audit report, asserted rather than
 * described.
 */
describe("cardForStage — the nine actually played", () => {
  // An ordinary club card: odds out, evens back.
  const SI = [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18];
  // A par-5 11th and a par-3 13th, so the back nine's pars are distinguishable
  // from the front's.
  const PARS = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 4, 3, 4, 4, 4, 4, 4];
  const CARD = { name: "Test links", pars: PARS, yards: new Array(18).fill(400), strokeIndex: SI };

  const strokesOver = (si: number[], courseHandicap: number) =>
    si.reduce((sum, i) => sum + holeStrokesReceived(courseHandicap, i, si.length), 0);

  it("re-ranks the front nine to 1..9", () => {
    const card = cardForStage(CARD, { holes: 9, nine: "front" });
    expect(card.strokeIndex).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("re-ranks the back nine to 1..9 as well", () => {
    const card = cardForStage(CARD, { holes: 9, nine: "back" });
    expect(card.strokeIndex).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("gives a player the strokes they are actually owed", () => {
    // The report's case: a nine-hole course handicap of 8 off 85% is a playing
    // handicap of 7. Raw, only 1,3,5,7 satisfy `si <= 7 % 9` — four strokes.
    expect(strokesOver(SI.slice(0, 9), 7)).toBe(4); // what the call sites did
    expect(strokesOver(cardForStage(CARD, { holes: 9, nine: "front" }).strokeIndex, 7)).toBe(7);
  });

  it("is wrong by a different amount for every handicap, so it never cancels out", () => {
    // Why this could not be spotted as a constant offset on a board.
    const raw = [3, 5, 7].map((h) => strokesOver(SI.slice(0, 9), h));
    const fixed = [3, 5, 7].map((h) =>
      strokesOver(cardForStage(CARD, { holes: 9, nine: "front" }).strokeIndex, h),
    );
    expect(raw).toEqual([2, 3, 4]);
    expect(fixed).toEqual([3, 5, 7]);
  });

  it("takes the back nine's pars for a back-nine round", () => {
    const card = cardForStage(CARD, { holes: 9, nine: "back" });
    // The 11th is a par 5 and the 13th a par 3. Scored off the front nine's
    // pars, a 4 on the 11th counted as nothing and a 4 on the 13th as a birdie.
    expect(card.pars).toEqual([4, 5, 4, 3, 4, 4, 4, 4, 4]);
    expect(card.pars).not.toEqual(PARS.slice(0, 9));
  });

  it("narrows a nine-hole round that never said which nine", () => {
    // `Stage.nine` defaults to "full", which is the state of every nine-hole
    // round nobody touched the dropdown on — the majority of them.
    const card = cardForStage(CARD, { holes: 9, nine: "full" });
    expect(card.strokeIndex).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(card.pars).toEqual(PARS.slice(0, 9));
  });

  it("leaves an eighteen-hole round completely alone", () => {
    const card = cardForStage(CARD, { holes: 18, nine: "full" });
    expect(card.strokeIndex).toEqual(SI);
    expect(card.pars).toEqual(PARS);
  });

  it("leaves a card that is already nine holes long alone", () => {
    // A real nine-hole course stores nine values with its own 1..9 index.
    const nine = {
      name: "Nine",
      pars: [4, 3, 5, 4, 4, 3, 4, 5, 4],
      yards: new Array(9).fill(300),
      strokeIndex: [5, 9, 1, 3, 7, 8, 2, 4, 6],
    };
    expect(cardForStage(nine, { holes: 9, nine: "front" }).strokeIndex).toEqual(nine.strokeIndex);
  });

  it("treats a missing stage as eighteen holes rather than guessing a half", () => {
    expect(cardForStage(CARD, null).strokeIndex).toEqual(SI);
    expect(cardForStage(CARD, undefined).pars).toEqual(PARS);
  });
});
