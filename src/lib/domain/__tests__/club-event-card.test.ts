import { describe, it, expect } from "vitest";
import { eventBand, whenOf, entryWindowNote, entryProgress, placesNote, byBand } from "../club-event-card";

describe("the order of the list", () => {
  it("puts the member's own first and finished last, keeping order within a band", () => {
    const rows = [
      { band: "finished" as const, id: "a" },
      { band: "soon" as const, id: "b" },
      { band: "open" as const, id: "c" },
      { band: "live" as const, id: "d" },
      { band: "entered" as const, id: "e" },
      { band: "open" as const, id: "f" },
    ];
    expect(byBand(rows).map((r) => r.id)).toEqual(["e", "d", "c", "f", "b", "a"]);
  });

  it("puts what is being played before what has not started, within their own", () => {
    // The seeded member's list on medal day: a November tournament, created
    // last, led "You're in" above the round his card was open on.
    const rows = [
      { band: "entered" as const, when: "upcoming", id: "november" },
      { band: "entered" as const, when: "now", id: "league" },
      { band: "waiting" as const, when: "upcoming", id: "am-am" },
      { band: "entered" as const, when: "now", id: "medal" },
    ];
    expect(byBand(rows).map((r) => r.id)).toEqual(["league", "medal", "november", "am-am"]);
  });
});

const band = (over: Partial<Parameters<typeof eventBand>[0]> = {}) =>
  eventBand({ eventStatus: "registration", regState: "open", canEnter: false, entered: false, ...over });

describe("the band on a tournament card", () => {
  it("says Finished over everything, entered or not", () => {
    expect(band({ eventStatus: "completed", entered: true })).toBe("finished");
    expect(band({ eventStatus: "completed" })).toBe("finished");
  });

  it("puts the member's own entry before the tournament's state", () => {
    expect(band({ entered: true, eventStatus: "live" })).toBe("entered");
  });

  it("is On now while it is being played and they are not in it", () => {
    expect(band({ eventStatus: "live" })).toBe("live");
  });

  it("is Open only when this member could actually enter", () => {
    expect(band({ canEnter: true })).toBe("open");
    // Accepting entries but self entry switched off is not open TO THEM.
    expect(band({ canEnter: false, regState: "open" })).toBe("closed");
  });

  it("is Opens soon before the opening day", () => {
    expect(band({ regState: "not-open-yet" })).toBe("soon");
  });

  it("files each tournament under one When, by its own status", () => {
    expect(whenOf("completed")).toBe("finished");
    expect(whenOf("live")).toBe("now");
    for (const s of ["draft", "registration"]) expect(whenOf(s)).toBe("upcoming");
  });

  it("files a live tournament the member is IN under On now", () => {
    // The band puts the member's own place first — "entered" — and "when"
    // used to be read off the band, so "On now" never listed a tournament the
    // member was playing in. The two answer different questions.
    const status = "live";
    expect(band({ eventStatus: status, entered: true })).toBe("entered");
    expect(whenOf(status)).toBe("now");
  });
});

describe("the countdown under the dates", () => {
  const today = "2026-09-18";

  it("counts down to the close while open", () => {
    expect(entryWindowNote({ band: "open", opens: "", closes: "2026-09-27", today })).toBe("Closes in 9 days");
    expect(entryWindowNote({ band: "open", opens: "", closes: "2026-09-19", today })).toBe("Closes tomorrow");
    expect(entryWindowNote({ band: "open", opens: "", closes: "2026-09-18", today })).toBe("Closes today");
  });

  it("counts down to the opening while not open yet", () => {
    expect(entryWindowNote({ band: "soon", opens: "2026-10-01", closes: "", today })).toBe("Entries open in 13 days");
  });

  it("gives no countdown past the deadline when the organizer kept it open", () => {
    expect(entryWindowNote({ band: "open", opens: "", closes: "2026-09-01", today })).toBe("");
  });

  it("gives none for a date it cannot read, or a band it is not about", () => {
    expect(entryWindowNote({ band: "open", opens: "", closes: "end of the month", today })).toBe("");
    expect(entryWindowNote({ band: "closed", opens: "", closes: "2026-09-27", today })).toBe("");
  });

  it("does not shift across a month boundary", () => {
    expect(entryWindowNote({ band: "open", opens: "", closes: "2026-10-02", today: "2026-09-30" })).toBe(
      "Closes in 2 days",
    );
  });
});

describe("the bar through the entry window", () => {
  it("is how far through the window today is", () => {
    expect(entryProgress("2026-09-01", "2026-09-11", "2026-09-06")).toBeCloseTo(0.5);
  });

  it("clamps before and after", () => {
    expect(entryProgress("2026-09-10", "2026-09-20", "2026-09-01")).toBe(0);
    expect(entryProgress("2026-09-10", "2026-09-20", "2026-10-01")).toBe(1);
  });

  it("is null without two real ends", () => {
    expect(entryProgress("", "2026-09-20", "2026-09-10")).toBeNull();
    expect(entryProgress("2026-09-20", "2026-09-10", "2026-09-15")).toBeNull();
  });
});

describe("places left", () => {
  it("counts down the field", () => {
    expect(placesNote(32, 14, false)).toBe("18 of 32 places left");
  });

  it("says full when entries go to the waiting list", () => {
    expect(placesNote(32, 32, true)).toBe("Full — waiting list open");
  });

  it("says nothing for a field with no limit", () => {
    expect(placesNote(0, 99, false)).toBe("");
  });

  it("never counts below zero on an over-full field", () => {
    expect(placesNote(32, 35, false)).toBe("0 of 32 places left");
  });
});
