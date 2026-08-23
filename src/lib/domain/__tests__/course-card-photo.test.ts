import { describe, it, expect } from "vitest";
import { courseCardPrompt, parseCourseCardReading } from "../course-card-photo";
import { parseCard } from "../scorecard-parse";

/**
 * Photographing the club's own card — the blank one, with par, stroke index
 * and yardage on it.
 *
 * The tests that matter here are the ones at the bottom: a photographed card
 * must be judged by `validateCard`, exactly as a pasted or typed one is. This
 * module's only job is deciding what could be READ. If it ever starts deciding
 * what is VALID, the photo path and the paste path can disagree about the same
 * card, and the photo path is the one nobody would notice drifting.
 */

/** Pebble Beach, in playing order. A real routing, so nothing here trips the
 *  shape checks and the tests are about the reading rather than the card. */
const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const YARDS = [378, 509, 397, 333, 189, 498, 107, 416, 483, 444, 370, 202, 401, 559, 393, 400, 182, 541];

const reply = (over: Record<string, unknown> = {}) => ({
  pars: PARS,
  strokeIndex: SI,
  yards: YARDS,
  ...over,
});

describe("a card that reads cleanly", () => {
  it("gives back the three rows the review screen already takes", () => {
    const r = parseCourseCardReading(reply(), 18);
    expect(r.pars).toBe(PARS.join(" "));
    expect(r.strokeIndex).toBe(SI.join(" "));
    expect(r.yards).toBe(YARDS.join(" "));
    expect(r.empty).toBe(false);
    expect(r.unreadable.pars).toEqual([]);
  });

  it("reads a nine-hole card as nine holes rather than padding it", () => {
    const r = parseCourseCardReading(
      { pars: PARS.slice(0, 9), strokeIndex: SI.slice(0, 9), yards: YARDS.slice(0, 9) },
      9,
    );
    expect(r.pars.split(" ")).toHaveLength(9);
  });

  it("accepts the string form of a number, which a model sometimes returns", () => {
    const r = parseCourseCardReading(reply({ pars: PARS.map(String) }), 18);
    expect(r.pars).toBe(PARS.join(" "));
  });

  it("takes the row whatever the model called it", () => {
    // Asked for strokeIndex, models variously answer si or stroke_index.
    const r = parseCourseCardReading({ par: PARS, si: SI, yardage: YARDS }, 18);
    expect(r.pars).toBe(PARS.join(" "));
    expect(r.strokeIndex).toBe(SI.join(" "));
  });
});

describe("a hole it could not read", () => {
  it("holds the hole's place instead of closing the gap", () => {
    // The failure this prevents: seventeen numbers for eighteen holes silently
    // re-indexes every hole after the gap, so the back nine scores off the
    // wrong stroke indexes forever.
    const pars: unknown[] = [...PARS];
    pars[6] = null;
    const r = parseCourseCardReading(reply({ pars }), 18);
    expect(r.pars.split(" ")).toHaveLength(18);
    expect(r.pars.split(" ")[6]).toBe("0");
    expect(r.unreadable.pars).toEqual([7]);
  });

  it("names every blank hole on the scoring rows", () => {
    const pars: unknown[] = [...PARS];
    pars[0] = "?";
    const si: unknown[] = [...SI];
    si[4] = null;
    si[17] = "";
    const r = parseCourseCardReading(reply({ pars, strokeIndex: si }), 18);
    expect(r.unreadable.pars).toEqual([1]);
    expect(r.unreadable.strokeIndex).toEqual([5, 18]);
  });

  it("does not quietly judge a value it could read", () => {
    // A par of 9 is wrong, and saying so is validateCard's job — one rule, one
    // reader. Swallowing it here would leave the organizer with a blank and no
    // idea the card said 9.
    const pars: unknown[] = [...PARS];
    pars[3] = 9;
    const r = parseCourseCardReading(reply({ pars }), 18);
    expect(r.pars.split(" ")[3]).toBe("9");
    expect(r.unreadable.pars).toEqual([]);
  });
});

describe("the yardage row, which is allowed to fail", () => {
  it("keeps a row with a couple of gaps", () => {
    const yards: unknown[] = [...YARDS];
    yards[2] = null;
    const r = parseCourseCardReading(reply({ yards }), 18);
    expect(r.yardsDropped).toBe(false);
    expect(r.unreadable.yards).toEqual([3]);
  });

  it("drops a row that is mostly unreadable rather than filling it with zeroes", () => {
    // Nothing scores off yardage, and eighteen "that yardage looks wrong"
    // complaints would bury the two par problems that actually matter.
    const yards: unknown[] = YARDS.map((y, i) => (i < 10 ? null : y));
    const r = parseCourseCardReading(reply({ yards }), 18);
    expect(r.yardsDropped).toBe(true);
    expect(r.yards).toBe("");
    // Not also reported hole by hole — the row is gone, so there is nothing to
    // go and look at.
    expect(r.unreadable.yards).toEqual([]);
  });

  it("drops a card with no yardage row at all, without complaining", () => {
    const r = parseCourseCardReading({ pars: PARS, strokeIndex: SI }, 18);
    expect(r.yardsDropped).toBe(true);
    expect(r.empty).toBe(false);
    expect(r.pars).toBe(PARS.join(" "));
  });
});

describe("nothing usable", () => {
  it("says so rather than handing back thirty-six zeroes", () => {
    const r = parseCourseCardReading({ pars: [], strokeIndex: [], yards: [] }, 18);
    expect(r.empty).toBe(true);
    expect(r.pars).toBe("");
  });

  it("survives whatever the model actually returned", () => {
    for (const junk of [null, undefined, "nope", 42, [], { pars: "no" }]) {
      const r = parseCourseCardReading(junk, 18);
      expect(r.empty, String(junk)).toBe(true);
    }
  });

  it("is not empty when only the stroke index came back", () => {
    // Half a card is still worth putting in front of somebody — they have the
    // card in their hand and can type the other row.
    const r = parseCourseCardReading({ strokeIndex: SI }, 18);
    expect(r.empty).toBe(false);
    expect(r.unreadable.pars).toHaveLength(18);
  });
});

describe("held to the same standard as a card typed in by hand", () => {
  /**
   * The point of the whole module. A photographed card goes into the same
   * boxes and through the same `validateCard` as a pasted one — so the checks
   * that caught Green Crest catch it here too, without this file knowing what
   * a par is.
   */
  it("passes a real card", () => {
    const r = parseCourseCardReading(reply(), 18);
    const card = parseCard({ pars: r.pars, strokeIndex: r.strokeIndex, yards: r.yards }, 18);
    expect(card.problems).toEqual([]);
    expect(card.ok).toBe(true);
  });

  it("turns an unread hole into a problem against that exact hole", () => {
    const pars: unknown[] = [...PARS];
    pars[6] = null;
    const r = parseCourseCardReading(reply({ pars }), 18);
    const card = parseCard({ pars: r.pars, strokeIndex: r.strokeIndex, yards: r.yards }, 18);
    const parProblem = card.problems.find((p) => p.row === "pars" && p.holes.includes(7));
    expect(parProblem, "hole 7 should be flagged by name").toBeTruthy();
    expect(card.ok).toBe(false);
  });

  it("still refuses a scrambled card read off a photograph", () => {
    // Green Crest's shape: sorted by par rather than routed. Every hole is
    // individually fine and the total is a real par, so only the shared shape
    // check catches it — and it must catch it whatever produced the numbers.
    const sorted = [5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3];
    const r = parseCourseCardReading(reply({ pars: sorted }), 18);
    const card = parseCard({ pars: r.pars, strokeIndex: r.strokeIndex, yards: r.yards }, 18);
    expect(card.ok).toBe(false);
    expect(card.problems.some((p) => p.message.includes("sorted order"))).toBe(true);
  });

  it("still refuses a stroke index that repeats a hole", () => {
    const si = [...SI];
    si[3] = si[2];
    const r = parseCourseCardReading(reply({ strokeIndex: si }), 18);
    const card = parseCard({ pars: r.pars, strokeIndex: r.strokeIndex, yards: r.yards }, 18);
    expect(card.ok).toBe(false);
  });
});

describe("what is asked for", () => {
  it("rules out the columns that are sums rather than holes", () => {
    // OUT, IN and TOTAL are the commonest way a card comes back with 21
    // numbers for 18 holes.
    const p = courseCardPrompt(18);
    expect(p).toContain("OUT");
    expect(p).toContain("TOTAL");
  });

  it("says which row to take when a card prints several", () => {
    // A printed card has a yardage row per tee and often two par rows. Left
    // unsaid, which one gets read is a coin toss that nobody would notice.
    const p = courseCardPrompt(18);
    expect(p).toContain("LONGEST");
    expect(p).toContain("men's");
  });

  it("asks for a gap to be held open rather than closed", () => {
    expect(courseCardPrompt(18)).toContain("do not shift the rest up");
  });

  it("names the labels clubs actually print for the stroke index", () => {
    const p = courseCardPrompt(18);
    for (const label of ["S.I.", "Index", "HCP"]) expect(p, label).toContain(label);
  });

  it("asks for the hole count it was given", () => {
    expect(courseCardPrompt(9)).toContain("9");
  });
});
