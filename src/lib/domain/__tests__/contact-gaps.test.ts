import { describe, it, expect } from "vitest";
import { contactGaps } from "@/lib/domain/contact-gaps";
import { readSource } from "../../__tests__/source";

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

/**
 * WHAT IT SAYS WHEN AN ADDRESS IS NOT THE WAY IN.
 *
 * This line asserted "access is email-based" about every tournament, and was
 * false on the ones that sign players in by Round Code — which is the whole of
 * what #296 made possible, and what the society and charity templates ship.
 *
 * MEASURED ON THE SEEDED DEMO, 2026-09-15. Demo Cup has `playerAccess: "code"`
 * and 31 entrants with no address, and its Registration screen told the
 * organizer those 31 "can't sign in until one's added". They could: the Round
 * Code is how they get in, and `createPlaySession` never reads an address.
 *
 * Found by rendering the screen against real rows, not by reading the source.
 */
describe("when the Round Code is the way in", () => {
  const field = [{ email: "" }, { email: "" }, { email: "someone@example.invalid" }];

  it("does not claim they cannot sign in", () => {
    const line = contactGaps(field, false, false).lines[0];
    expect(line, "still says access is email-based").not.toMatch(/email-based/);
    expect(line, "still says they cannot sign in").not.toMatch(/can.t sign in/);
  });

  it("says what a missing address DOES cost — messages, not announcements", () => {
    /**
     * Not silence: `messageableField` selects on `email: { not: "" }`, so a
     * player without one cannot be messaged. But this used to go further and
     * say announcements were lost too ("announcements and messages go by
     * email, so those players won't receive any") — false, and the old
     * assertion here pinned the false half. Announcements are loaded by
     * tournament alone and shown to every entrant in the app. See the next
     * test, which ties this sentence to that fact.
     */
    const line = contactGaps(field, false, false).lines[0];
    expect(line).toMatch(/Round Code/);
    expect(line).toMatch(/can.t be messaged/i);
    expect(line).not.toMatch(/won.t receive any/i);
    expect(line).toContain("2 players");
  });

  it("is right that announcements reach a player with no email", () => {
    // The sentence above says they "see every announcement in the app". That is
    // only true while announcements are loaded by tournament and NOT filtered on
    // email; if that ever changes, this goes red and the sentence must too.
    const src = readSource("src", "lib", "services", "announcements.ts");
    const at = src.indexOf("announcement.findMany(");
    expect(at, "announcements are no longer listed where this test looks").toBeGreaterThan(-1);
    const query = src.slice(at, src.indexOf("});", at));
    expect(query).toMatch(/where:\s*\{\s*eventId\s*\}/);
    expect(query).not.toMatch(/email/);
    const line = contactGaps(field, false, false).lines[0];
    expect(line).toMatch(/see every announcement/);
  });

  it("still says the plain thing when email IS the way in", () => {
    // The control on the pair: if both branches read the same, neither is
    // being chosen and this file asserts nothing about the distinction.
    const codeOff = contactGaps(field, false, true).lines[0];
    const codeOn = contactGaps(field, false, false).lines[0];
    expect(codeOff).toMatch(/email-based/);
    expect(codeOff).not.toBe(codeOn);
  });

  it("says nothing at all when every entrant has an address", () => {
    // The ordinary case, either way round.
    expect(contactGaps([{ email: "a@example.invalid" }], false, false).lines).toEqual([]);
    expect(contactGaps([{ email: "a@example.invalid" }], false, true).lines).toEqual([]);
  });
});
