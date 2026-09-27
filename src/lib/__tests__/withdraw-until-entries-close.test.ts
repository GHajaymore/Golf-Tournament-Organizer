import { describe, it, expect } from "vitest";
import { ownWithdrawalOpen, registrationStatus, type RegistrationInput } from "../registration";

/**
 * A MEMBER MAY TAKE THEIR OWN NAME OFF UNTIL ENTRIES CLOSE — Ajay, 2026-09-26.
 *
 * Enumerated over EVERY registration state rather than two or three, because
 * the rule is "the same door that let them in", and a state added later must
 * be decided rather than fall through. `now` is fixed so the dates below mean
 * the same thing on any day this runs.
 */
const NOW = new Date("2026-06-15T12:00:00Z");
const base: RegistrationInput & { registrationOpen: boolean } = {
  registrationOpen: true,
  eventStatus: "registration",
  deadline: "",
  opens: "",
  capacity: 0,
  confirmedCount: 0,
  override: null,
  now: NOW,
};

const cases: [string, Partial<typeof base>, boolean][] = [
  ["open", {}, true],
  ["full (entries go to the waiting list)", { capacity: 4, confirmedCount: 4 }, true],
  ["not open yet (somebody entered early can still pull out)", { opens: "2026-07-01" }, true],
  ["kept open past the deadline by the organizer", { deadline: "2026-06-01", override: false }, true],
  ["past the deadline", { deadline: "2026-06-01" }, false],
  ["closed by the organizer", { override: true }, false],
  ["finished", { eventStatus: "completed" }, false],
];

describe("withdrawing yourself follows the entry door", () => {
  it.each(cases)("%s", (_label, over, expected) => {
    expect(ownWithdrawalOpen({ ...base, ...over })).toBe(expected);
  });

  it("covers every state registrationStatus can return (so a new one is decided, not guessed)", () => {
    const seen = new Set(cases.map(([, over]) => registrationStatus({ ...base, ...over }).state));
    expect([...seen].sort()).toEqual(
      ["closed-deadline", "closed-finished", "closed-manual", "full", "not-open-yet", "open", "open-extended"].sort(),
    );
  });

  it("is shut when the club does not take entries from members at all (the control)", () => {
    // Otherwise "open" above could pass on a rule that ignores the switch.
    expect(ownWithdrawalOpen({ ...base, registrationOpen: false })).toBe(false);
  });
});
