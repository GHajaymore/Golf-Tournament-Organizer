import { describe, it, expect } from "vitest";
import {
  registrationStatus,
  deadlinePassed,
  isIsoDate,
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
    expect(s.detail).toContain("2026-06-14");
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

describe("the case that started this", () => {
  it("never says 'Open · unlimited' after the deadline", () => {
    for (const capacity of [0, 32]) {
      const s = registrationStatus(input({ capacity, now: at("2026-06-20") }));
      expect(s.label, `capacity ${capacity}`).not.toContain("Open");
      expect(s.acceptingEntries, `capacity ${capacity}`).toBe(false);
    }
  });
});
