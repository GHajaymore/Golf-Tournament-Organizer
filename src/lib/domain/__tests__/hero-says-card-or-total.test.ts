import { describe, it, expect } from "vitest";
import { heroHeadline } from "../scoreboard";

/**
 * TODAY'S BIG NUMBER IS NAMED FOR WHAT IT COVERS.
 *
 * It is the player's standing — the number they are ranked on — and the panel
 * called it "YOUR CARD" whatever that covered. On the seeded league it read
 * "YOUR CARD · FINAL · 132" over a week-4 card worth 36 points; 132 was the
 * season. Walked as a member on 2026-09-26.
 */
describe("the Today headline", () => {
  it("is YOUR CARD when the standing is this one round (control)", () => {
    expect(heroHeadline({ scoreLabel: "Thru 11 · net", holesOwed: 18, roundHoles: 18 })).toBe("YOUR CARD · THRU 11 · NET");
    expect(heroHeadline({ scoreLabel: "Final", holesOwed: 9, roundHoles: 9 })).toBe("YOUR CARD · FINAL");
  });

  it("is YOUR TOTAL, with the holes, when the standing covers more than this round", () => {
    expect(
      heroHeadline({ scoreLabel: "Final", holesOwed: 72, thru: 72, roundHoles: 18, tournamentOver: true }),
    ).toBe("YOUR TOTAL · 72 HOLES · FINAL");
    expect(
      heroHeadline({ scoreLabel: "Final · gross", holesOwed: 36, thru: 36, roundHoles: 18, tournamentOver: true }),
    ).toBe("YOUR TOTAL · 36 HOLES · FINAL · GROSS");
  });

  /**
   * "FINAL" AFTER "YOUR TOTAL" IS A CLAIM ABOUT THE TOURNAMENT. The seeded
   * league read "YOUR TOTAL · 72 HOLES · FINAL · 132" four weeks into seven,
   * with "these standings will change" printed under it — the label meant his
   * returned cards were complete, and the headline made it mean the season.
   */
  it("says SO FAR, not FINAL, on a complete total while the tournament is still being played", () => {
    expect(
      heroHeadline({ scoreLabel: "Final", holesOwed: 72, thru: 72, roundHoles: 18, tournamentOver: false }),
    ).toBe("YOUR TOTAL · 72 HOLES · SO FAR");
    // What the number IS stays — only the how-far word changes.
    expect(
      heroHeadline({ scoreLabel: "Final · gross", holesOwed: 36, thru: 36, roundHoles: 18 }),
    ).toBe("YOUR TOTAL · 36 HOLES · SO FAR · GROSS");
  });

  it("leaves a total still being played as far as it has got", () => {
    expect(
      heroHeadline({ scoreLabel: "Thru 29", holesOwed: 36, thru: 29, roundHoles: 18, tournamentOver: false }),
    ).toBe("YOUR TOTAL · 36 HOLES · THRU 29");
  });

  it("keeps YOUR CARD · FINAL on one round, where FINAL is true of the card (control)", () => {
    expect(
      heroHeadline({ scoreLabel: "Final", holesOwed: 18, thru: 18, roundHoles: 18, tournamentOver: false }),
    ).toBe("YOUR CARD · FINAL");
  });

  it("still says how far the card has got before there is a standing", () => {
    expect(heroHeadline({ scoreLabel: null, filled: 4, holesOwed: 0, roundHoles: 18 })).toBe("YOUR CARD · 4 IN");
    expect(heroHeadline({ holesOwed: 0, roundHoles: 18 })).toBe("YOUR CARD · NOT STARTED");
  });
});
