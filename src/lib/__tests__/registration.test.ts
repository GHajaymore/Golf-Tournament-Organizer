import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registrationStatus,
  deadlinePassed,
  isIsoDate,
  parseDeadlineIso,
  formatDeadline,
  type RegistrationInput,
} from "../registration";

/**
 * Whether entries are still open.
 *
 * The screen answered this from capacity alone, so a tournament whose deadline
 * passed a week ago still read "Open · unlimited" — the app stating something
 * false about the organizer's own event, on the page they hand to members.
 */

const at = (iso: string) => new Date(`${iso}T12:00:00`);

const input = (over: Partial<RegistrationInput> = {}): RegistrationInput => ({
  eventStatus: "registration",
  deadline: "2026-06-14",
  capacity: 0,
  confirmedCount: 0,
  override: null,
  now: at("2026-06-01"),
  ...over,
});

describe("the deadline", () => {
  it("is inclusive of its own day", () => {
    // A deadline of the 14th means entries close at the END of the 14th. Every
    // member assumes that, and closing at midnight as it begins loses a day of
    // entries and generates a phone call.
    expect(deadlinePassed("2026-06-14", at("2026-06-14"))).toBe(false);
    expect(deadlinePassed("2026-06-14", at("2026-06-15"))).toBe(true);
    expect(deadlinePassed("2026-06-14", at("2026-06-13"))).toBe(false);
  });

  it("ignores a deadline it cannot read", () => {
    // Deadlines were free text before the date picker, so older tournaments
    // hold things like "Sat 14 Jun". Guessing at those would close entries on
    // a date nobody set.
    expect(deadlinePassed("Sat 14 Jun", at("2027-01-01"))).toBe(false);
    expect(deadlinePassed("", at("2027-01-01"))).toBe(false);
    expect(isIsoDate("2026-06-14")).toBe(true);
    expect(isIsoDate("Sat 14 Jun")).toBe(false);
  });

  it("closes entries once it has passed", () => {
    const s = registrationStatus(input({ now: at("2026-06-20") }));
    expect(s.state).toBe("closed-deadline");
    expect(s.acceptingEntries).toBe(false);
    expect(s.label).toBe("Closed");
    // Said the way a person writes a date, not the way a column stores one.
    expect(s.detail).toContain("Jun 14, 2026");
  });

  /**
   * D1. The defect was not in this function — it was that nothing ever handed
   * it a date. The setup screen ran the picker's ISO value through
   * `toLocaleDateString` before saving, so every deadline set through the UI
   * was stored as "Jun 1, 2026", which `deadlinePassed` read as "not a date"
   * and therefore "not passed". Registration stayed open indefinitely while
   * the page printed the deadline it was ignoring.
   *
   * This file passed throughout, because it only ever fed the pure function
   * ISO strings. So the test that matters is the round trip: whatever this app
   * writes into the column, it must be able to read back.
   */
  it("reads back every date this app is capable of writing", () => {
    const dates = [
      "2026-06-14", // ordinary
      "2026-06-01", // single-digit day
      "2026-01-31", // month edge
      "2026-12-31", // year edge
      "2027-03-09",
    ];
    for (const iso of dates) {
      expect(parseDeadlineIso(formatDeadline(iso)), iso).toBe(iso);
      // And the thing the bug actually cost: enforcement.
      expect(deadlinePassed(formatDeadline(iso), at("2027-06-01")), iso).toBe(true);
      expect(deadlinePassed(formatDeadline(iso), at("2025-01-01")), iso).toBe(false);
    }
  });

  it("enforces the display string an existing tournament already holds", () => {
    // Every event set up before this fix has "Jun 14, 2026" in the column.
    // Recognising the app's own output is what fixes those without a migration
    // — and without it, a club's existing deadlines would stay decorative
    // until someone re-picked the date.
    expect(deadlinePassed("Jun 14, 2026", at("2026-06-15"))).toBe(true);
    expect(deadlinePassed("Jun 14, 2026", at("2026-06-14"))).toBe(false);
    const s = registrationStatus(input({ deadline: "Jun 14, 2026", now: at("2026-06-20") }));
    expect(s.acceptingEntries).toBe(false);
  });

  it("still refuses to guess at anything else", () => {
    // The line stays where it was: an unambiguous string this app generated is
    // read; a human's shorthand is not. "Sat 14 Jun" names no year, and
    // closing entries on a date nobody set is worse than leaving them open.
    for (const text of ["Sat 14 Jun", "end of the month", "June", "14/06/2026", "2026-13-45"]) {
      expect(deadlinePassed(text, at("2027-01-01")), text).toBe(false);
      expect(parseDeadlineIso(text), text).toBe("");
      // Free text is shown to the organizer exactly as they typed it.
      expect(formatDeadline(text), text).toBe(text);
    }
  });

  it("does not shift a date by a timezone it does not have", () => {
    // A deadline is a day, not an instant. Parsing "Jun 1, 2026" through Date
    // applies the server's offset — and on Vercel (UTC) that is how a club's
    // deadline lands on the 31st.
    expect(parseDeadlineIso("Jun 1, 2026")).toBe("2026-06-01");
    expect(formatDeadline("2026-06-01")).toBe("Jun 1, 2026");
  });

  it("stays open before it", () => {
    const s = registrationStatus(input());
    expect(s.state).toBe("open");
    expect(s.acceptingEntries).toBe(true);
    expect(s.label).toBe("Open · unlimited");
  });
});

describe("capacity", () => {
  it("waitlists once the field is full", () => {
    const s = registrationStatus(input({ capacity: 32, confirmedCount: 32 }));
    expect(s.state).toBe("full");
    // Still accepting — they just go on the waitlist rather than the field.
    expect(s.acceptingEntries).toBe(true);
    expect(s.waitlisting).toBe(true);
    expect(s.label).toContain("waitlist");
  });

  it("treats zero or less as no limit", () => {
    expect(registrationStatus(input({ capacity: 0, confirmedCount: 99 })).state).toBe("open");
    expect(registrationStatus(input({ capacity: -1, confirmedCount: 99 })).state).toBe("open");
  });

  it("says Open without 'unlimited' when there is a limit", () => {
    expect(registrationStatus(input({ capacity: 32, confirmedCount: 4 })).label).toBe("Open");
  });

  it("lets the deadline beat a half-empty field", () => {
    const s = registrationStatus(input({ capacity: 32, confirmedCount: 4, now: at("2026-07-01") }));
    expect(s.state).toBe("closed-deadline");
  });
});

describe("the organizer's own decision", () => {
  it("closes early, before the deadline", () => {
    const s = registrationStatus(input({ override: true }));
    expect(s.state).toBe("closed-manual");
    expect(s.acceptingEntries).toBe(false);
    expect(s.detail).toContain("Reopen");
  });

  it("beats capacity too — a closed event is closed", () => {
    const s = registrationStatus(input({ override: true, capacity: 32, confirmedCount: 1 }));
    expect(s.acceptingEntries).toBe(false);
  });

  it("reopens past the deadline, and says that is what happened", () => {
    // Deadlines get extended by a word at the bar far more often than they get
    // edited in software. The next person to read this screen should be able
    // to see the extension was a decision, not a stale date.
    const s = registrationStatus(input({ override: false, now: at("2026-07-01") }));
    expect(s.state).toBe("open-extended");
    expect(s.acceptingEntries).toBe(true);
    expect(s.label).toBe("Extended");
    expect(s.detail).toContain("kept open by the organizer");
  });

  it("an extension still waitlists a full field", () => {
    const s = registrationStatus(
      input({ override: false, now: at("2026-07-01"), capacity: 8, confirmedCount: 8 }),
    );
    expect(s.state).toBe("open-extended");
    expect(s.waitlisting).toBe(true);
    expect(s.label).toContain("waitlist");
  });

  it("does nothing when the deadline has not passed anyway", () => {
    // "Keep open" before the deadline is a no-op, not a second kind of open.
    const s = registrationStatus(input({ override: false }));
    expect(s.state).toBe("open");
  });
});

describe("a tournament that has finished takes no more entries", () => {
  // D2. `registerForEvent` never consulted event.status, and the two actions
  // that could have closed the door by hand both called assertUnlocked, which
  // throws for live|completed — so a finished tournament kept taking public
  // entries and the only escape was unlocking the whole configuration.
  it("refuses once the event is completed", () => {
    const s = registrationStatus(input({ eventStatus: "completed" }));
    expect(s.state).toBe("closed-finished");
    expect(s.acceptingEntries).toBe(false);
    expect(s.waitlisting).toBe(false);
  });

  it("beats the organizer's own override, in both directions", () => {
    // "Keep it open" is a decision about a tournament still being played. An
    // entry added after the result exists can only corrupt the record.
    for (const override of [true, false, null]) {
      const s = registrationStatus(input({ eventStatus: "completed", override, now: at("2026-06-01") }));
      expect(s.acceptingEntries, `override ${String(override)}`).toBe(false);
    }
  });

  it("beats an empty field and an open deadline", () => {
    const s = registrationStatus(
      input({ eventStatus: "completed", capacity: 32, confirmedCount: 0, deadline: "2030-01-01" }),
    );
    expect(s.acceptingEntries).toBe(false);
  });

  it("leaves every other lifecycle state alone", () => {
    // Only `completed` closes the door. A LIVE tournament may still be taking
    // entries — a club league runs for weeks and members join mid-season — and
    // deciding that is the organizer's switch, not this rule's.
    for (const eventStatus of ["draft", "registration", "ready", "live"]) {
      expect(registrationStatus(input({ eventStatus })).acceptingEntries, eventStatus).toBe(true);
    }
  });
});

describe("the organizer can always reach the switch", () => {
  // The other half of D2, and only assertable at the source: both actions ran
  // assertUnlocked, which throws for a live or completed event. Closing
  // registration is not a structural change — it decides whether the door is
  // open — and requiring the tournament to be unlocked took the control away
  // at exactly the moment it was needed.
  const src = readFileSync(join(process.cwd(), "src/app/actions/tournament.ts"), "utf8");
  const fn = (name: string) => {
    const start = src.indexOf(`export async function ${name}`);
    const next = src.indexOf("\nexport ", start + 1);
    return src.slice(start, next === -1 ? undefined : next);
  };

  for (const name of ["setRegistrationOpen", "setRegistrationOverride"]) {
    it(`${name} is staff-gated but not lock-gated`, () => {
      expect(fn(name).length, `${name} not found`).toBeGreaterThan(100);
      expect(fn(name)).toMatch(/requireStaffEvent\(\)/);
      expect(fn(name)).not.toMatch(/await assertUnlocked/);
    });
  }
});

describe("the deadline the picker writes is the deadline the rule reads", () => {
  // The write side, which is where D1 lived. A round trip through the pure
  // functions cannot see a screen that formats before it stores, so this reads
  // the screen.
  it("stores the picker's ISO value, not a display string", () => {
    const src = readFileSync(join(process.cwd(), "src/components/EventSetupClient.tsx"), "utf8");
    const onDeadline = src.slice(src.indexOf("const onDeadlineDate"), src.indexOf("const onSelectCourse"));
    expect(onDeadline).toMatch(/set\("regDeadline", v\)/);
    expect(onDeadline, "fmtDate here is the whole defect").not.toMatch(/set\("regDeadline", fmtDate/);
  });
});

describe("the case that started this", () => {
  it("never says 'Open · unlimited' after the deadline", () => {
    for (const capacity of [0, 32]) {
      const s = registrationStatus(input({ capacity, now: at("2026-06-20") }));
      expect(s.label, `capacity ${capacity}`).not.toContain("Open");
      expect(s.acceptingEntries, `capacity ${capacity}`).toBe(false);
    }
  });
});
