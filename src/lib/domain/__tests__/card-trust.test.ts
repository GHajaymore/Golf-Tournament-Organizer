import { describe, it, expect } from "vitest";
import { cardTrustNote, RECHECK_AFTER_DAYS } from "../card-trust";

/**
 * A CARD NOBODY HAS CHECKED SAYS SO, WHEREVER IT IS SCORED AGAINST.
 *
 * Ajay, 2026-09-19: "always give a warning to check the card" — "accuracy or
 * recent". The course library already marked unverified cards; every screen
 * that scores against one said nothing.
 *
 * The stakes are in the schema's own comment: "a wrong par is obvious the
 * first time someone plays the hole; a wrong stroke index is invisible, and it
 * silently allocates handicap shots to the wrong holes for the life of the
 * course."
 */

const TODAY = new Date("2026-09-19T00:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("what to say about a course card", () => {
  it("warns when nobody has checked an imported card", () => {
    const note = cardTrustNote({ source: "imported", verifiedAt: null, verifiedBy: "" }, TODAY);
    expect(note?.level).toBe("unchecked");
    expect(note?.warn).toBe(true);
    expect(note?.text).toContain("imported");
    // Names the risk in the words that make it matter, not "unverified".
    expect(note?.text).toContain("stroke index");
  });

  it("warns about an unchecked card the club typed in, too", () => {
    // Typed by hand is not thereby right: a transposed stroke index is exactly
    // as invisible as an imported one.
    const note = cardTrustNote({ source: "manual", verifiedAt: null, verifiedBy: "" }, TODAY);
    expect(note?.level).toBe("unchecked");
    expect(note?.text).toContain("typed in");
  });

  it("says who checked it and when, once somebody has", () => {
    const note = cardTrustNote(
      { source: "imported", verifiedAt: day("2026-04-03"), verifiedBy: "R. Ganizer" },
      TODAY,
    );
    expect(note?.level).toBe("checked");
    expect(note?.warn).toBe(false);
    expect(note?.text).toContain("2026-04-03");
    expect(note?.text).toContain("R. Ganizer");
  });

  it("warns again once a checked card is over a year old", () => {
    /**
     * THE SECOND RISK. A card checked correctly in 2024 is still wrong if the
     * course rebuilt the 7th and moved two stroke indexes since. Checked is
     * not a permanent state.
     */
    const stale = cardTrustNote(
      { source: "manual", verifiedAt: day("2025-01-01"), verifiedBy: "R. Ganizer" },
      TODAY,
    );
    expect(stale?.level).toBe("stale");
    expect(stale?.warn).toBe(true);
    expect(stale?.text).toContain("over a year ago");
  });

  it("turns over exactly at the threshold, not around it", () => {
    const verifiedAt = new Date(TODAY.getTime() - RECHECK_AFTER_DAYS * 86400000);
    expect(cardTrustNote({ source: "manual", verifiedAt, verifiedBy: "" }, TODAY)?.level).toBe("checked");
    const older = new Date(verifiedAt.getTime() - 86400000);
    expect(cardTrustNote({ source: "manual", verifiedAt: older, verifiedBy: "" }, TODAY)?.level).toBe("stale");
  });

  it("reads a stored date string as well as a Date", () => {
    // Prisma hands back a Date; a serialized prop arrives as a string, and the
    // screens that pass one must not silently become "unchecked".
    const note = cardTrustNote({ source: "manual", verifiedAt: "2026-04-03T09:00:00.000Z", verifiedBy: "" }, TODAY);
    expect(note?.level).toBe("checked");
  });

  it("treats an unreadable date as unchecked rather than as recent", () => {
    // The safe direction: a value nothing can parse is not evidence that
    // somebody checked the card.
    const note = cardTrustNote({ source: "imported", verifiedAt: "not a date", verifiedBy: "" }, TODAY);
    expect(note?.level).toBe("unchecked");
  });

  it("warns first about a card with no stroke index at all", () => {
    /**
     * A STATE THAT NOW EXISTS. Until 2026-09-19 the directory importer refused
     * a card whose stroke index was missing and stored nothing — throwing away
     * every hole's par with it. It keeps them now, so a card that can score
     * gross and cannot allocate a single handicap stroke is a real card in the
     * database.
     *
     * The danger is the invisible one: `holeStrokesReceived` reads an index
     * per hole and a missing one falls back to 18, so every shot lands on the
     * same hole and a net leaderboard is quietly wrong all day. That outranks
     * "nobody has checked this", which is only a doubt.
     */
    const checked = { source: "imported", verifiedAt: day("2026-09-01"), verifiedBy: "R. Ganizer" };
    const note = cardTrustNote(checked, TODAY, undefined, []);
    expect(note?.warn).toBe(true);
    expect(note?.text).toContain("no stroke index");
    expect(note?.text).toContain("net scores will be wrong");
    // And it says what still works, so the club is not told the card is useless.
    expect(note?.text).toContain("Gross scoring is unaffected");
  });

  it("reads an all-zero index as no index, which is how a directory sends one", () => {
    const checked = { source: "imported", verifiedAt: day("2026-09-01"), verifiedBy: "" };
    expect(cardTrustNote(checked, TODAY, undefined, new Array(18).fill(0))?.text).toContain(
      "no stroke index",
    );
    // A real index says nothing about itself and lets the ordinary note through.
    const si = Array.from({ length: 18 }, (_, i) => i + 1);
    expect(cardTrustNote(checked, TODAY, undefined, si)?.level).toBe("checked");
  });

  it("says nothing about the index when the caller does not know it", () => {
    // `undefined` is "I did not look", which must not read as "there is none".
    const note = cardTrustNote(
      { source: "manual", verifiedAt: day("2026-09-01"), verifiedBy: "" },
      TODAY,
    );
    expect(note?.level).toBe("checked");
  });

  it("says nothing when there is no card at all", () => {
    // A round with no course card has a different problem, and the screens
    // that have one already say so. Two messages would be noise.
    expect(cardTrustNote(null, TODAY)).toBeNull();
    expect(cardTrustNote(undefined, TODAY)).toBeNull();
  });

  it("formats the date the way the caller asks", () => {
    // The club's own date order — the same rule every other date obeys.
    const note = cardTrustNote(
      { source: "manual", verifiedAt: day("2026-04-03"), verifiedBy: "" },
      TODAY,
      () => "3 April 2026",
    );
    expect(note?.text).toContain("3 April 2026");
  });
});
