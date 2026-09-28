import { describe, expect, it } from "vitest";
import { readSource } from "./source";
import { roleName } from "@/lib/roles";
import { golfTermsFor } from "@/lib/domain/golf-terms";

describe("a role is named in the club's words", () => {
  it("the top role follows the register; the stored value never changes", () => {
    expect(roleName("admin", golfTermsFor("us").organizer)).toBe("Organizer");
    expect(roleName("admin", golfTermsFor("uk").organizer)).toBe("Organiser");
    // CONTROL: the other roles have one spelling, and an unknown value is shown as stored.
    expect(roleName("assistant", "organiser")).toBe("Assistant");
    expect(roleName("player", "organiser")).toBe("Player");
    expect(roleName("owner-ish", "organiser")).toBe("owner-ish");
  });

  it("defaults to the US word for a caller with no club", () => {
    expect(roleName("admin")).toBe("Organizer");
  });
});

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
  // THE ROLE NAME. One label in every place a role is shown, spelled through
  // `roleName` — a half-converted set would show a club both spellings.
  { file: "src/components/Sidebar.tsx", banned: [/"Organi[sz]er"/, />Organi[sz]er</] },
  { file: "src/components/MobileTabBar.tsx", banned: [/"Organi[sz]er"/, />Organi[sz]er</] },
  { file: "src/components/AccessClient.tsx", banned: [/only Organi[sz]er/, /<b>Organi[sz]er<\/b>/] },
  { file: "src/components/OrganizationAccess.tsx", banned: [/admin: "Organi[sz]er"/] },
  { file: "src/lib/access-roles.ts", banned: [/"Organi[sz]er"/] },
  { file: "src/app/(player)/layout.tsx", banned: [/\/> Organi[sz]er/] },
  { file: "src/app/(app)/access/page.tsx", banned: [/Organi[sz]ers get full/] },
  { file: "src/components/PlanPanel.tsx", banned: [/"organi[sz]er", "organi[sz]ers"/] },
  // THE PUBLIC ENTRY FORM — the first page a stranger reads in the club's voice.
  { file: "src/app/register/[token]/page.tsx", banned: [/The organi[sz]er uses/] },
  {
    file: "src/components/RegisterClient.tsx",
    banned: [/The organi[sz]er needs/, /by the organi[sz]er,/, /with the organi[sz]er for/],
  },
  // The Events card's own status line, built on the server beside the button's word.
  { file: "src/lib/services/club-events.ts", banned: [/the organi[sz]er will confirm/] },
  // THE GROUP WORDS. A tee sheet's summary and the casual-round clash notice.
  { file: "src/components/FoursomeMaker.tsx", banned: [/"twosome"/, /"threesome"/, /"foursome"/] },
  { file: "src/components/TournamentClashNotice.tsx", banned: [/your fourball/, /your foursome/] },
];

/**
 * A CLIENT COMPONENT'S DEFAULT IS THE US WORD, so a caller that forgets the
 * prop does not fail — it quietly tells a Scottish club "organizer". Every
 * place that renders one of these must hand it the club's word.
 */
const CALLERS: ReadonlyArray<{ file: string; tag: string; prop?: string }> = [
  { file: "src/app/(app)/foursomes/page.tsx", tag: "FoursomeMaker", prop: "terms=" },
  { file: "src/app/match/new/page.tsx", tag: "TournamentClashNotice", prop: "group=" },
  { file: "src/app/register/[token]/page.tsx", tag: "RegisterClient" },
  { file: "src/components/ClubEventsList.tsx", tag: "EnterButton" },
  { file: "src/app/(player)/me/page.tsx", tag: "EnterButton" },
  { file: "src/app/(player)/me/messages/page.tsx", tag: "MessagesClient" },
  { file: "src/app/(app)/messages/page.tsx", tag: "MessagesClient" },
  { file: "src/app/(player)/layout.tsx", tag: "DeniedNotice" },
  { file: "src/app/(app)/layout.tsx", tag: "DeniedNotice" },
  { file: "src/app/(app)/layout.tsx", tag: "Sidebar" },
  { file: "src/app/(app)/layout.tsx", tag: "MobileTabBar" },
  { file: "src/app/(app)/access/page.tsx", tag: "AccessClient" },
  { file: "src/app/(app)/organization/page.tsx", tag: "OrganizationAccess" },
];

describe("every caller hands a converted component the club's word", () => {
  for (const { file, tag, prop = "organizer=" } of CALLERS) {
    it(`${file} passes ${prop.slice(0, -1)} to <${tag}>`, () => {
      const src = readSource(file);
      const uses = src.split(`<${tag}`).slice(1).map((rest) => rest.slice(0, rest.indexOf("/>")));
      expect(uses.length, `no <${tag}> in ${file}`).toBeGreaterThan(0);
      for (const use of uses) expect(use).toContain(prop);
    });
  }
});

describe("screens converted to the club's golf words", () => {
  for (const { file, banned } of CONVERTED) {
    const src = readSource(file);

    it(`${file} reads the club's terms`, () => {
      expect(src).toMatch(/golfTermsForEvent\(|golfTermsFor\(|terms\.(organizer|organizers|cart|carts|group)|\{organizer\}|\{group\}|\.organizer\}|roleName\(/);
    });

    for (const word of banned) {
      it(`${file} does not hard-code ${word}`, () => {
        expect(src).not.toMatch(word);
      });
    }
  }
});
