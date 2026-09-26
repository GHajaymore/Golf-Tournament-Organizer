import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A TOURNAMENT THAT HOLDS ITS COURSE ONLY AS A VENUE STILL NAMES IT.
 *
 * Tournaments created before #626 have their club's home course attached as a
 * venue and nothing in `Event.course`/`courseId`. #626 made the SCORING read
 * the sole venue; walking a newcomer's Stableford on 2026-09-26 found three
 * places still printing the empty name while the dashboard header, reading
 * `event.course || attachedVenues`, named the course:
 *
 *   the launch confirmation   "Course —"
 *   the Tournaments list      "—" in the Course column
 *   Tournament details        an empty "Golf course" box
 *
 * Each now takes the venue when the event names none. Pinned at source
 * because all three are server pages; each assertion has been watched fail.
 */
describe("the course name falls back to the venue", () => {
  it("on the launch confirmation, from the dashboard header's own sources", () => {
    const src = readSource("src/app/(app)/dashboard/page.tsx");
    expect(src).toMatch(/course: event\.course \|\| attachedVenues\.join\(" · "\)/);
  });

  it("on the Tournaments list", () => {
    const src = readSource("src/app/(app)/tournaments/page.tsx");
    expect(src).toMatch(/course: ev\.course \|\| ev\.courses\.map\(\(c\) => c\.course\.name\)/);
  });

  it("in the Tournament details form, only where the event names no course and has no card", () => {
    const src = readSource("src/app/(app)/event/page.tsx");
    expect(src).toMatch(/!e\.courseId && !e\.course\.trim\(\) && !e\.customPars\.trim\(\) \? soleVenueCourse\(e\)/);
    expect(src).toMatch(/courseId: e\.courseId \?\? inheritedVenue\?\.id/);
  });
});

describe("the unsaved dates say they are unsaved", () => {
  it("does not tell a newcomer their dates save on their own", () => {
    // Found the same walk: "Dates save on their own" beside a Save button,
    // read as automatic — the date was lost on leaving the screen.
    const src = readSource("src/components/EventSetupClient.tsx");
    const at = src.indexOf('"Save dates"');
    const note = src.slice(at, at + 1200);
    expect(note).toMatch(/Not saved yet/);
  });
});
