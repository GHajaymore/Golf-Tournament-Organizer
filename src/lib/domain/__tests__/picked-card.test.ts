import { describe, it, expect } from "vitest";
import { pickedCardNote, NO_CARD_YET, IMPORTED_UNCHECKED, type StoredCard } from "../picked-card";

/**
 * WHAT A COURSE PICKER SAYS ABOUT THE CARD IT JUST PICKED (Ajay, 2026-10-03:
 * "warn them if the scorecard is not complete or verified").
 *
 * One cell per state a stored card can be in, each built so the wrong
 * sentence looks different from the right one — a card that is complete but
 * unchecked must not read as "incomplete", and a checked card must not warn.
 */
const TODAY = new Date("2026-10-03T12:00:00Z");
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const SI = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 16, 2, 10, 4, 12, 18, 6, 14];

const card = (over: Partial<StoredCard> = {}): StoredCard => ({
  pars: JSON.stringify(PARS),
  strokeIndex: JSON.stringify(SI),
  source: "imported",
  verifiedAt: null,
  verifiedBy: "",
  ...over,
});

describe("pickedCardNote", () => {
  it("says nothing when the caller has no card row at all", () => {
    expect(pickedCardNote(null, TODAY)).toBeNull();
    expect(pickedCardNote(undefined, TODAY)).toBeNull();
  });

  it("warns that there is no scorecard when the pars are empty", () => {
    for (const pars of ["", "[]", "not json", JSON.stringify(new Array(18).fill(0))]) {
      expect(pickedCardNote(card({ pars }), TODAY), pars).toEqual({ warn: true, text: NO_CARD_YET });
    }
  });

  it("warns that net scores will be wrong when the stroke index is missing", () => {
    const note = pickedCardNote(card({ strokeIndex: "" }), TODAY);
    expect(note?.warn).toBe(true);
    expect(note?.text).toContain("no stroke index");
    // Pars ARE there, so this must not claim the whole card is missing.
    expect(note?.text).not.toBe(NO_CARD_YET);
  });

  it("warns that a card which does not add up is incomplete, and names the fault", () => {
    const dupe = [...SI];
    dupe[1] = 7; // hole 2 now shares stroke index 7 with hole 1, and 3 is gone
    const note = pickedCardNote(card({ strokeIndex: JSON.stringify(dupe) }), TODAY);
    expect(note?.warn).toBe(true);
    expect(note?.text).toContain("doesn't look right");
    expect(note?.text).toContain("Stroke index 7 used more than once");

    const short = pickedCardNote(card({ pars: JSON.stringify(PARS.slice(0, 12)) }), TODAY);
    expect(short?.text).toContain("doesn't look right");
    expect(short?.text).toContain("12 holes");

    // Andalusia, walked on 2026-10-04: nearly sorted, eight par 5s in a row.
    const andalusia = [5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3, 3, 4];
    const sorted = pickedCardNote(card({ pars: JSON.stringify(andalusia) }), TODAY);
    expect(sorted?.warn).toBe(true);
    expect(sorted?.text).toContain("par 5s in a row");
    // One instruction, not two stacked.
    expect(sorted?.text.match(/Check/g)?.length).toBe(1);
  });

  it("warns that a complete card nobody at the club has checked is unchecked — not incomplete", () => {
    const note = pickedCardNote(card(), TODAY);
    expect(note).toEqual({ warn: true, text: IMPORTED_UNCHECKED });
    expect(note?.text).toContain("nobody at the club has checked it");
    expect(note?.text).not.toContain("doesn't look right");
    expect(pickedCardNote(card({ source: "manual" }), TODAY)?.text).toContain("was typed in");
  });

  it("warns again when the check is over a year old", () => {
    const note = pickedCardNote(card({ verifiedAt: "2025-06-01T00:00:00Z", verifiedBy: "ZZ Secretary" }), TODAY);
    expect(note?.warn).toBe(true);
    expect(note?.text).toContain("2025-06-01 by ZZ Secretary");
    expect(note?.text).toContain("over a year ago");
  });

  it("says, without warning, when a complete card was checked recently", () => {
    const note = pickedCardNote(card({ verifiedAt: new Date("2026-09-20T00:00:00Z"), verifiedBy: "ZZ Secretary" }), TODAY);
    expect(note).toEqual({ warn: false, text: "Card checked on 2026-09-20 by ZZ Secretary." });
  });

  it("treats a complete nine-hole card as complete", () => {
    const nine = card({
      pars: JSON.stringify([4, 3, 5, 4, 4, 3, 4, 5, 4]),
      strokeIndex: JSON.stringify([5, 9, 1, 3, 7, 8, 2, 4, 6]),
      verifiedAt: "2026-09-01T00:00:00Z",
    });
    expect(pickedCardNote(nine, TODAY)?.warn).toBe(false);
  });
});
