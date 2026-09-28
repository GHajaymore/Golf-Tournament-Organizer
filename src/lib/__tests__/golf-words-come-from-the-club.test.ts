import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * A SCREEN THAT HAS BEEN CONVERTED TO THE CLUB'S GOLF WORDS STAYS CONVERTED.
 *
 * The club picks its register on /organization ("Golf words") and the picker
 * previews what screens will say. That preview is only true on the screens
 * that read `golfTermsFor` — so this pins those screens: each must reach the
 * club's terms, and none may print the word the terms replace.
 *
 * Scoped to the files converted so far, deliberately. `docs/country-terms.md`
 * lists what is still to come; a file joins this list the day it is converted,
 * which is what stops a later edit quietly re-typing "organizer" into it.
 *
 * Words are searched in STRINGS AND JSX only as far as `readSource` allows —
 * comments are stripped, so prose explaining a rule cannot trip the guard.
 * Identifiers are excluded by matching the word as the reader sees it.
 */
const CONVERTED: ReadonlyArray<{ file: string; banned: readonly RegExp[] }> = [
  {
    file: "src/app/(player)/me/board/page.tsx",
    banned: [/your organi[sz]er/i, /The organi[sz]er /],
  },
  {
    file: "src/app/(player)/me/card/page.tsx",
    banned: [/your organi[sz]er/i, /by the organi[sz]er/i, /The organi[sz]er /],
  },
  {
    file: "src/components/MoneyClient.tsx",
    banned: [/The organi[sz]ers /, /Cart fees/, /buggies/i, /carts with/i, /a cart fee/i],
  },
  {
    file: "src/app/(app)/group-games/page.tsx",
    banned: [/a fourball&rsquo;s/, /a foursome&rsquo;s/],
  },
  {
    file: "src/app/actions/expenses.ts",
    banned: [/The organi[sz]ers add/],
  },
  {
    file: "src/app/(player)/me/page.tsx",
    banned: [/the organi[sz]er will confirm/i, /organi[sz]er adds you/i],
  },
  // Client components take the word as a prop from a page that read the club.
  {
    file: "src/components/EnterButton.tsx",
    banned: [/The organi[sz]er will/, /the organi[sz]er to approve/],
  },
  {
    file: "src/components/MessagesClient.tsx",
    banned: [/your organi[sz]er/i],
  },
  {
    file: "src/components/DeniedNotice.tsx",
    banned: [/tournament&rsquo;s organi[sz]er/],
  },
];

/**
 * A CLIENT COMPONENT'S DEFAULT IS THE US WORD, so a caller that forgets the
 * prop does not fail — it quietly tells a Scottish club "organizer". Every
 * place that renders one of these must hand it the club's word.
 */
const CALLERS: ReadonlyArray<{ file: string; tag: string }> = [
  { file: "src/components/ClubEventsList.tsx", tag: "EnterButton" },
  { file: "src/app/(player)/me/page.tsx", tag: "EnterButton" },
  { file: "src/app/(player)/me/messages/page.tsx", tag: "MessagesClient" },
  { file: "src/app/(app)/messages/page.tsx", tag: "MessagesClient" },
  { file: "src/app/(player)/layout.tsx", tag: "DeniedNotice" },
  { file: "src/app/(app)/layout.tsx", tag: "DeniedNotice" },
];

describe("every caller hands a converted component the club's word", () => {
  for (const { file, tag } of CALLERS) {
    it(`${file} passes organizer to <${tag}>`, () => {
      const src = readSource(file);
      const uses = src.split(`<${tag}`).slice(1).map((rest) => rest.slice(0, rest.indexOf("/>")));
      expect(uses.length, `no <${tag}> in ${file}`).toBeGreaterThan(0);
      for (const use of uses) expect(use).toContain("organizer=");
    });
  }
});

describe("screens converted to the club's golf words", () => {
  for (const { file, banned } of CONVERTED) {
    const src = readSource(file);

    it(`${file} reads the club's terms`, () => {
      expect(src).toMatch(/golfTermsForEvent\(|golfTermsFor\(|terms\.(organizer|organizers|cart|carts|group)|\{organizer\}/);
    });

    for (const word of banned) {
      it(`${file} does not hard-code ${word}`, () => {
        expect(src).not.toMatch(word);
      });
    }
  }
});
