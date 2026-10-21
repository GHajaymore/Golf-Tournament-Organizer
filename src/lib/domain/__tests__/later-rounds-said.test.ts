import { describe, expect, it } from "vitest";
import { laterRoundsSaid } from "../later-rounds-said";
import { datedSaid } from "../round-dates";

/**
 * "USE IN LATER ROUNDS" SAYS THE TRUE REASON A ROUND WAS LEFT (2026-10-21).
 *
 * It said a nine at the same club "has cards in or is on other tees", and "There are no later rounds"
 * when every later round had been left. Each case below is the UI/UX designer's and the golf
 * professional's sentence, typed by hand; the reasons are a course handicap's three parts (Rules of
 * Handicapping 6.1) and a frozen round.
 */
describe("what Use in later rounds did", () => {
  it("says each case in its own words", () => {
    expect(laterRoundsSaid(3, 0, 0)).toBe("Set on 3 later rounds.");
    expect(laterRoundsSaid(1, 0, 0)).toBe("Set on 1 later round.");
    expect(laterRoundsSaid(2, 1, 0)).toBe("Set on 2 later rounds; 1 already has cards in, so its handicaps are fixed.");
    expect(laterRoundsSaid(2, 0, 1)).toBe("Set on 2 later rounds; 1 is on another course, other tees or a different number of holes, where these strokes mean something else.");
    expect(laterRoundsSaid(2, 1, 1)).toBe("Set on 2 later rounds; 1 already has cards in and 1 is on another course, other tees or a different number of holes, so both keep their own.");
    expect(laterRoundsSaid(0, 2, 0)).toBe("Not set on any later round: all 2 already have cards in, so their handicaps are fixed.");
    expect(laterRoundsSaid(0, 1, 0)).toBe("Not set on any later round: the only one already has cards in, so its handicaps are fixed.");
    expect(laterRoundsSaid(0, 0, 2)).toBe("Not set on any later round: all 2 are on another course, other tees or a different number of holes, where these strokes mean something else.");
    expect(laterRoundsSaid(0, 1, 1)).toBe("Not set on any later round: 1 already has cards in and 1 is on another course, other tees or a different number of holes.");
    expect(laterRoundsSaid(0, 0, 0)).toBe("There are no later rounds to use it in.");
  });

  it("never says there are no later rounds when there were, and never blames tees for a nine", () => {
    for (let w = 0; w <= 3; w++) {
      for (let c = 0; c <= 3; c++) {
        for (let o = 0; o <= 3; o++) {
          const said = laterRoundsSaid(w, c, o);
          if (c + o > 0 || w > 0) expect(said, `${w}/${c}/${o}`).not.toContain("no later rounds");
          if (o > 0) expect(said, `${w}/${c}/${o}`).toContain("a different number of holes");
          if (c > 0) expect(said, `${w}/${c}/${o}`).toContain("cards in");
        }
      }
    }
  });
});

describe("what dating the rounds says", () => {
  it("names the first day, in the words it is given", () => {
    expect(datedSaid(3, "Sat 7 Nov")).toBe("3 rounds dated, the first on Sat 7 Nov. Players now see them on their calendar.");
    expect(datedSaid(1, "Sat 7 Nov")).toBe("1 round dated, on Sat 7 Nov. Players now see it on their calendar.");
  });
});
