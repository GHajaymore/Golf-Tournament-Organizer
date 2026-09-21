import { describe, it, expect } from "vitest";
import { roundsLabelOf } from "../services/registration";

/**
 * THE PUBLIC ENTRY FORM NAMES WHAT WILL BE PLAYED.
 *
 * It read `event.format` — one coarse value for a whole tournament — and told
 * four of the seeded club's seven tournaments with rounds something their own
 * rounds contradict. Measured against the development database on 2026-09-20,
 * and two of the four contradict their own NAME:
 *
 *   Thursday Evening League             said "Stroke play"  is 7 x Stableford
 *   Twilight Nine — Midweek Stableford  said "Stroke play"  is Stableford
 *   Four-Ball & Foursomes Invitational  said "Stroke play"  is Four-Ball + 2 x Foursomes
 *   Festival of Formats                 said "Stroke play"  is 11 formats
 *
 * This is the screen somebody reads BEFORE deciding to enter. A member who
 * signs up for "stroke play" and arrives to play foursomes with a partner has
 * been told the wrong thing by their club.
 *
 * The cases below are those four tournaments and the two edges around them,
 * rather than invented shapes — each one is a row that was wrong in the
 * database this was measured against.
 */

const r = (format: string, type = "Stroke Play Round") => ({ type, format });

describe("the entry form names the rounds, not the event", () => {
  it("names the one format when there is one round", () => {
    // Twilight Nine — a Stableford round that read "Stroke play".
    expect(roundsLabelOf([r("Stableford")])).toBe("Stableford");
  });

  it("counts the rounds when they are all the same", () => {
    // Thursday Evening League — seven Stableford nights.
    expect(roundsLabelOf(Array.from({ length: 7 }, () => r("Stableford")))).toBe(
      "7 rounds · Stableford",
    );
  });

  it("lists the distinct formats, in play order", () => {
    // The Invitational: Four-Ball then two Foursomes. Order is the claim — a
    // member reads the first named as the first round.
    expect(roundsLabelOf([r("Four-Ball"), r("Foursomes"), r("Foursomes")])).toBe(
      "3 rounds · Four-Ball, Foursomes",
    );
  });

  it("caps a long list rather than printing a paragraph", () => {
    // Festival of Formats — eleven rounds, every one different.
    const eleven = [
      "Modified Stableford", "Skins", "Nassau", "Best Ball", "Shamble",
      "Alternate Shot", "Chapman", "Scramble", "Yellowball", "Six-Six-Six", "Flag",
    ].map((f) => r(f));
    expect(roundsLabelOf(eleven)).toBe(
      "11 rounds · Modified Stableford, Skins, Nassau and 8 more",
    );
  });

  it("says the format is not decided rather than inventing one", () => {
    /**
     * THE CASE THE OLD CODE COULD NOT EXPRESS, and the club really does this:
     * entries open before the format is settled. The seeded club has a
     * tournament called "Format To Follow" whose entry form said "Stroke play".
     * Claiming a format nobody has chosen is worse than admitting none.
     */
    expect(roundsLabelOf([])).toBe("Format to be confirmed");
  });

  it("ignores a stage the field does not play", () => {
    /**
     * A cut is not a round of golf — nobody tees off in it and nobody returns a
     * card for it, which is the rule `roundLabel` keeps for numbering. A
     * tournament holding only a cut has nothing to name.
     */
    expect(roundsLabelOf([r("", "Qualification Stage")])).toBe("Format to be confirmed");
    expect(roundsLabelOf([r("Stableford"), r("", "Qualification Stage")])).toBe("Stableford");
  });

  it("falls back to the stage type when a round has no format yet", () => {
    // A round added but not yet configured still says something true.
    expect(roundsLabelOf([r("", "Stroke Play Round")])).toBe("Stroke Play Round");
  });
});

describe("the control", () => {
  /**
   * Without this the assertions above are satisfied by a function that returns
   * its input unexamined. The point of the change is that the EVENT's coarse
   * word never reaches this screen, so no output of it may be that word.
   */
  it("never produces the event-level wording it replaced", () => {
    const cases = [
      [] as { type: string; format: string }[],
      [r("Stableford")],
      [r("Match Play", "Single Match Stage")],
      [r("Four-Ball"), r("Foursomes")],
    ];
    for (const c of cases) {
      const out = roundsLabelOf(c);
      expect(out, JSON.stringify(c)).not.toBe("Stroke play");
      expect(out, JSON.stringify(c)).not.toBe("Match play");
    }
  });
});
