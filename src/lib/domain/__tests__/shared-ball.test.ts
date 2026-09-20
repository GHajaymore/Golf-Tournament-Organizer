import { describe, it, expect } from "vitest";
import { sharedBallRound, perPlayerPotRefusal } from "../shared-ball";
import { GOLF_FORMATS } from "../../formats";

/**
 * A POT DECIDED BETWEEN PLAYERS CANNOT RUN ON A ROUND WITH ONE BALL PER SIDE.
 *
 * Found on 2026-09-20 by putting a real £5 skins pot on a seeded foursomes and
 * opening the money screen: "Nothing settled yet" over eight complete cards,
 * and it would have said that for ever. No per-player cards exist for a
 * shared-ball round — `round-cards.ts` keeps them out deliberately, because
 * "inventing an individual score would pay a skin to a player who never hit
 * the shot" — so there are no standings to settle and the stake never comes
 * back to anybody.
 *
 * The rule is about golf, not storage: partners playing alternate shot have
 * one score between them, and skins asks who won the hole ALONE.
 */

describe("a round where the side plays one ball", () => {
  it("is every alternate-shot family format", () => {
    for (const name of ["Foursomes", "Alternate Shot", "Greensomes", "Chapman / Pinehurst", "Scramble", "Texas Scramble"]) {
      expect(sharedBallRound(name), name).toBe(true);
    }
  });

  it("is not a four-ball, where everybody plays their own", () => {
    // The distinction that makes the rule narrow enough to be right: a
    // four-ball is a TEAM format and still has a card per player, so its pot
    // settles exactly as an individual round's does.
    for (const name of ["Four-Ball", "Best Ball", "Stroke Play", "Stableford", "Match Play"]) {
      expect(sharedBallRound(name), name).toBe(false);
    }
  });

  it("agrees with the format catalogue rather than a second list", () => {
    // The control: whatever the catalogue calls single-ball is what this says,
    // so a format added later is covered the day it is added.
    for (const f of GOLF_FORMATS) {
      expect(sharedBallRound(f.name), f.name).toBe(f.ball === "single");
    }
  });

  it("refuses a per-player pot, and names the format", () => {
    const refusal = perPlayerPotRefusal("Foursomes");
    expect(refusal).toContain("Foursomes");
    expect(refusal).toContain("one ball per side");
    // And says what to do instead, which every refusal in this app owes.
    expect(refusal).toContain("everyone plays their own ball");
  });

  it("allows one everywhere else", () => {
    expect(perPlayerPotRefusal("Four-Ball")).toBeNull();
    expect(perPlayerPotRefusal("Stroke Play")).toBeNull();
    // An unknown format falls back to the catalogue's default rather than
    // refusing: a guard that refuses what it does not recognise would block a
    // real round the day a format is added.
    expect(perPlayerPotRefusal("zz-not-a-format")).toBeNull();
  });
});
