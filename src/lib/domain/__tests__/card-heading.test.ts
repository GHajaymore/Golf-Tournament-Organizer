import { describe, it, expect } from "vitest";
import { cardHeading } from "../card-heading";

/**
 * Whose name goes at the top of a scorecard.
 *
 * A scorecard is the COURSE's card. The club's mark heading one is right for a
 * club playing its own course and a claim over somebody else's everywhere
 * else.
 */

const CLUB = { clubName: "Cinci Desi Golf", clubLogoUrl: "https://x.test/l.png" };

describe("a card played somewhere that is not the club's course", () => {
  it("leads with the course and names the club beneath it", () => {
    // A society's outing at Pebble Beach came out headed "Cinci Desi Golf"
    // above Pebble Beach's holes, which reads as though the society owns the
    // course. On paper that card says Pebble Beach.
    const h = cardHeading({ ...CLUB, courseName: "Pebble Beach Golf Links" })!;
    expect(h.primary).toBe("Pebble Beach Golf Links");
    expect(h.secondary).toBe("Cinci Desi Golf");
    expect(h.leadIsCourse).toBe(true);
  });

  it("keeps the club's logo, because there are no course logos to have", () => {
    const h = cardHeading({ ...CLUB, courseName: "Pebble Beach Golf Links" })!;
    expect(h.logoUrl).toBe("https://x.test/l.png");
  });
});

describe("a card played at the club's own course", () => {
  it("carries the club's mark alone", () => {
    // Not a claim over somebody else's venue — it is their card.
    const h = cardHeading({ ...CLUB, courseName: "CDG Home Course", venueIsHome: true })!;
    expect(h.primary).toBe("Cinci Desi Golf");
    expect(h.leadIsCourse).toBe(false);
  });

  it("carries the club's second line when it has one", () => {
    const h = cardHeading({ ...CLUB, clubSecondary: "Est. 1974", venueIsHome: true })!;
    expect(h.secondary).toBe("Est. 1974");
  });
});

describe("the club and the course being the same place", () => {
  it("says it once, even when the two names are not typed identically", () => {
    // Clubs enter their own course under their own name and rarely spell it
    // the same way twice. `venueIsHome` does not catch this: a club that never
    // set a home course still plays its own course.
    for (const course of ["Bushwood Golf Club", "Bushwood GC", "The Bushwood Club", "bushwood"]) {
      const h = cardHeading({ clubName: "Bushwood", courseName: course })!;
      expect(h.primary, course).toBe("Bushwood");
      expect(h.secondary, course).toBe("");
      expect(h.leadIsCourse, course).toBe(false);
    }
  });

  it("still names both when they are genuinely different places", () => {
    const h = cardHeading({ clubName: "Bushwood", courseName: "Ridgeline National" })!;
    expect(h.primary).toBe("Ridgeline National");
    expect(h.secondary).toBe("Bushwood");
  });
});

describe("cards with nothing to head them", () => {
  it("returns nothing at all when there is neither club nor course", () => {
    // Absent rather than a TourneyHQ fallback: an unbranded card should look
    // like plain paper, not like it belongs to us.
    expect(cardHeading({})).toBeNull();
    expect(cardHeading({ clubName: "  ", courseName: "" })).toBeNull();
  });

  it("leads with the club when the course is unknown", () => {
    const h = cardHeading({ ...CLUB })!;
    expect(h.primary).toBe("Cinci Desi Golf");
    expect(h.leadIsCourse).toBe(false);
  });

  it("leads with the course when the club has no name, and carries no logo", () => {
    // A club with no mark set gets no mark — never ours in its place.
    const h = cardHeading({ courseName: "Pebble Beach Golf Links" })!;
    expect(h.primary).toBe("Pebble Beach Golf Links");
    expect(h.secondary).toBe("");
    expect(h.logoUrl).toBe("");
  });
});
