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
    expect(heroHeadline({ scoreLabel: "Final", holesOwed: 72, roundHoles: 18 })).toBe("YOUR TOTAL · 72 HOLES · FINAL");
    expect(heroHeadline({ scoreLabel: "Final · gross", holesOwed: 36, roundHoles: 18 })).toBe(
      "YOUR TOTAL · 36 HOLES · FINAL · GROSS",
    );
  });

  it("still says how far the card has got before there is a standing", () => {
    expect(heroHeadline({ scoreLabel: null, filled: 4, holesOwed: 0, roundHoles: 18 })).toBe("YOUR CARD · 4 IN");
    expect(heroHeadline({ holesOwed: 0, roundHoles: 18 })).toBe("YOUR CARD · NOT STARTED");
  });
});
