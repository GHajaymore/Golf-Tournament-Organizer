import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE LAYOUT SWEEP IS ONLY AS GOOD AS THE NAMES IN THE FIXTURE.
 *
 * `e2e/layout.spec.ts` measures every screen at three viewports and asserts
 * nothing scrolls sideways. It cannot find an overflow that the data cannot
 * produce — and on 2026-09-18 that was not hypothetical. A full-width button
 * reading "Add to <tournament>" inherited `white-space: nowrap` from `.btn`,
 * put 368px of text in a 260px button, and pushed the document to 399px in a
 * 320px viewport. It had presumably always been broken. It went red the day the
 * fixture gained a roster, because until then that button never rendered.
 *
 * The names are what make it findable: a club, a course and a tournament each
 * long enough to overflow a phone column, carrying the characters real golf
 * clubs actually use — a curly apostrophe, an ampersand, an em dash, an
 * accented letter. Shorten them to "Blue Ash GC" and every layout assertion in
 * the suite still passes while measuring nothing, which is the failure mode
 * CLAUDE.md calls "a sweep that says the thing you hoped it would say".
 *
 * So this is a guard on the INSTRUMENT, not on the app. It exists so that
 * tidying the fixture is a decision somebody makes on purpose rather than a
 * tidy-up that quietly costs the suite its teeth.
 *
 * `fixture.mjs` ALREADY ARGUES ALL OF THIS, at length, above the three
 * constants — including the "seven characters" story where lengthening the
 * mark turned /roster red and found a `width: auto` select that had been wrong
 * the whole time. Nothing enforced it. A rule documented in a comment is a rule
 * the next person will edit straight past, which is the argument this codebase
 * makes about guards generally; this is that comment with a test under it.
 *
 * The awkward characters are written as CODEPOINTS on purpose. Spelling them
 * literally would make this file the first hit of any future mojibake sweep —
 * the same trap as a comment naming the call a source test is pinning.
 */

const FIXTURE = "e2e/fixture.mjs";
const src = readSource(FIXTURE);

/** A curly apostrophe, an ampersand, an em dash, or a letter with a diacritic. */
const AWKWARD = /[’&—À-ɏ]/;

function constant(name: string): string {
  const m = src.match(new RegExp(`const ${name} = "([^"]+)"`));
  return m ? m[1] : "";
}

describe("the e2e fixture can expose a layout fault", () => {
  it("reads the fixture at all", () => {
    // The control. Every assertion below is about a string pulled out of this
    // file; if the read or the match broke, each one would compare "" against
    // a rule and the interesting ones would fail loudly rather than pass — but
    // the length checks would not, so say it once, here.
    expect(src.length, `${FIXTURE} came back empty`).toBeGreaterThan(2000);
    expect(src).toContain("const CLUB_NAME");
  });

  // Long enough to overflow a column on a 320px phone, which is roughly where
  // the app's 13.5px type runs out of room. Not the current lengths — a floor
  // well under them, so an ordinary edit is free and a gutting is not.
  const NAMES: [string, number][] = [
    ["CLUB_NAME", 30],
    ["COURSE_NAME", 24],
    ["EVENT_NAME", 40],
  ];

  for (const [name, floor] of NAMES) {
    it(`${name} is long enough to overflow a phone column`, () => {
      const value = constant(name);
      expect(value, `${name} is not a plain string constant any more`).not.toBe("");
      expect(
        value.length,
        `${name} is ${value.length} characters. Under about ${floor} it fits every column in the app, ` +
          `and the layout sweep goes green without measuring anything.`,
      ).toBeGreaterThanOrEqual(floor);
    });

    it(`${name} carries a character real club names carry`, () => {
      expect(
        AWKWARD.test(constant(name)),
        `${name} has no apostrophe, ampersand, em dash or accented letter. Those are the ` +
          `characters that break encoding and wrapping, and a fixture of plain ASCII cannot find either fault.`,
      ).toBe(true);
    });
  }

  it("has a member whose name is long, hyphenated and accented", () => {
    /**
     * The roster is where a person's name is rendered in the narrowest
     * columns, and a double-barrelled name with a diacritic is the realistic
     * worst case rather than an invented one. It is also what made the
     * "Add to <tournament>" button render at all.
     */
    const names = [...src.matchAll(/name: "([^"]{12,})"/g)].map((m) => m[1]);
    const hard = names.filter((n) => n.includes("-") && AWKWARD.test(n) && n.length >= 25);
    expect(
      hard.length,
      `no fixture name is both long and hyphenated with an accent. Candidates seen: ${names.slice(0, 8).join(", ")}`,
    ).toBeGreaterThanOrEqual(1);
  });
});
