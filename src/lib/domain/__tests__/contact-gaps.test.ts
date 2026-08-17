import { describe, it, expect } from "vitest";
import { contactGaps } from "@/lib/domain/contact-gaps";

const p = (email: string, phone = "") => ({ email, phone });
const full = p("rita@example.invalid", "555 0147 231");

describe("what the field is missing", () => {
  it("says nothing when everyone can be reached", () => {
    expect(contactGaps([full, full], true).lines).toEqual([]);
  });

  it("reports a missing email whether or not a phone is wanted", () => {
    // Email is not conditional on anything: it is how a player signs in, so a
    // blank one is a problem on every plan and every tournament.
    for (const phoneRequired of [true, false]) {
      const gaps = contactGaps([p(""), full], phoneRequired);
      expect(gaps.missingEmail).toBe(1);
      expect(gaps.lines[0]).toMatch(/1 player has no email on file/);
      expect(gaps.lines[0]).toMatch(/can’t sign in/);
    }
  });

  it("stays quiet about a missing phone when the tournament never asked", () => {
    // A blank phone on a tournament that does not want one is not a gap, and
    // a banner about it would be the app inventing a problem.
    const gaps = contactGaps([p("rita@example.invalid"), p("sam@example.invalid")], false);
    expect(gaps.missingPhone).toBe(2);
    expect(gaps.lines).toEqual([]);
  });

  it("reports a missing phone once the tournament requires one", () => {
    const gaps = contactGaps([p("rita@example.invalid"), full], true);
    expect(gaps.lines).toHaveLength(1);
    expect(gaps.lines[0]).toMatch(/1 player has no mobile on file/);
  });

  it("says the existing entries are not a mistake", () => {
    // The point of the sentence. An organizer who reads "a mobile is required"
    // and then counts thirty-two blanks will otherwise assume something broke —
    // the rule applies when somebody is entered, and nobody is removed for it.
    const gaps = contactGaps([p("rita@example.invalid")], true);
    expect(gaps.lines[0]).toMatch(/entered before that applied/);
    expect(gaps.lines[0]).toMatch(/nothing has been removed/);
  });

  it("reports both gaps as separate sentences, email first", () => {
    // Email leads because it is the more serious of the two: no email means no
    // access at all, where no mobile means only that you cannot ring them.
    const gaps = contactGaps([p("", ""), p("sam@example.invalid", "")], true);
    expect(gaps.lines).toHaveLength(2);
    expect(gaps.lines[0]).toMatch(/email/);
    expect(gaps.lines[1]).toMatch(/mobile/);
  });

  it("counts a phone the same way the rule enforces it", () => {
    // Both read through looksLikePhone, so the banner and the refusal can never
    // disagree about what counts as a number.
    expect(contactGaps([p("a@b.test", "12345")], true).missingPhone).toBe(1);
    expect(contactGaps([p("a@b.test", "(555) 014-7231")], true).missingPhone).toBe(0);
  });

  it("reads properly in the singular and the plural", () => {
    expect(contactGaps([p("")], true).lines[0]).toMatch(/^1 player has/);
    expect(contactGaps([p(""), p("")], true).lines[0]).toMatch(/^2 players have/);
  });
});
