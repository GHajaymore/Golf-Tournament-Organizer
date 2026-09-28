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
];

describe("screens converted to the club's golf words", () => {
  for (const { file, banned } of CONVERTED) {
    const src = readSource(file);

    it(`${file} reads the club's terms`, () => {
      expect(src).toMatch(/golfTermsForEvent\(|golfTermsFor\(|terms\.(organizer|organizers|cart|carts|group)/);
    });

    for (const word of banned) {
      it(`${file} does not hard-code ${word}`, () => {
        expect(src).not.toMatch(word);
      });
    }
  }
});
