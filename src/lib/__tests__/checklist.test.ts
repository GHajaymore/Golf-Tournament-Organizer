import { describe, it, expect } from "vitest";
import { setupChecklist, isUnstarted, clubBrandingState, type ChecklistState } from "../services/checklist";
import { NAV, screenName } from "../nav";
import { DEFAULT_THEME, DEFAULT_SECONDARY } from "../themes";
import { readVerbatim, readSource } from "./source";

/**
 * The setup checklist, and the question it answers on the dashboard: is this
 * tournament built yet?
 *
 * It matters because a brand-new organizer lands on the dashboard straight
 * after creating a tournament. Before this existed they were shown a wall of
 * zeroes — "0 players", "0/0 matches complete", "0 of 0 advancing" — every one
 * of them true and none of them useful.
 */

const empty: ChecklistState = {
  confirmed: [],
  waitlist: [],
  stages: [],
  groups: [],
  matches: [],
  accounts: [{}], // the organizer's own account always exists
};

const ready: ChecklistState = {
  confirmed: new Array(24).fill({}),
  waitlist: [],
  stages: new Array(2).fill({}),
  groups: new Array(4).fill({}),
  matches: new Array(12).fill({}),
  accounts: [{}, {}],
};

describe("is this tournament built yet", () => {
  it("calls a tournament with no field unstarted", () => {
    expect(isUnstarted(empty)).toBe(true);
  });

  it("stops calling it unstarted the moment a field exists", () => {
    // The field is the first real step: rounds, flights and scores all need
    // it, so it is the honest test for "there is something to show".
    expect(isUnstarted({ ...empty, confirmed: [{}] })).toBe(false);
  });

  it("does not treat a configured-but-empty tournament as started", () => {
    // Rounds exist from creation — the create action makes the opening one —
    // so rounds alone must not count as progress.
    expect(isUnstarted({ ...empty, stages: [{}] })).toBe(true);
  });
});

describe("what the checklist says", () => {
  it("marks nothing done on a fresh tournament, and says what to do", () => {
    const items = setupChecklist(empty);
    expect(items.map((i) => i.done)).toEqual([false, false, false, false]);
    expect(items[1].detail).toContain("No players yet");
    expect(items[0].detail).toContain("No rounds yet");
    expect(items[2].detail).toContain("No flights yet");
  });

  it("marks the work done once it is", () => {
    const items = setupChecklist(ready);
    expect(items[1].done).toBe(true);
    expect(items[1].detail).toContain("24 confirmed");
    expect(items[0].detail).toContain("2 rounds");
    expect(items[2].done).toBe(true);
    expect(items[2].detail).toContain("schedule generated");
  });

  it("does not count flights done until the schedule is generated", () => {
    // Flights without a draw are a list of names, not a playable round — the
    // step is only finished when there are matches to play.
    const items = setupChecklist({ ...ready, matches: [] });
    expect(items[2].done).toBe(false);
    expect(items[2].detail).toContain("schedule not generated yet");
  });

  it("mentions the waitlist only when someone is on it", () => {
    expect(setupChecklist(ready)[1].detail).not.toContain("waitlisted");
    expect(setupChecklist({ ...ready, waitlist: [{}, {}] })[1].detail).toContain("2 waitlisted");
  });

  it("keeps staff optional — one person can run a tournament", () => {
    const staff = setupChecklist(empty).find((i) => i.label === "Access & staff");
    expect(staff?.optional).toBe(true);
    expect(staff?.detail).toContain("Just you so far");
  });

  it("points every step at the screen that completes it", () => {
    expect(setupChecklist(empty).map((i) => i.href)).toEqual([
      // Rounds before the field, which is `SETUP_ORDER` — the same sequence
      // the rail and the "Recommended flow" card state. This list used to run
      // field first and disagree with both.
      "/stages",
      "/registration",
      "/grouping",
      "/access",
    ]);
  });
});

describe("the branding nudge", () => {
  it("is absent when the caller passes no branding — existing callers unchanged", () => {
    expect(setupChecklist(empty).some((i) => i.href === "/organization")).toBe(false);
  });

  it("appears, optional, only while the club has set neither logo nor colours", () => {
    const items = setupChecklist({ ...empty, branding: { hasLogo: false, hasColours: false } });
    const brand = items.find((i) => i.href === "/organization");
    expect(brand).toBeDefined();
    expect(brand?.optional).toBe(true);
    expect(brand?.done).toBe(false);
    expect(brand?.label).toContain("logo");
  });

  it("drops off once a logo or colours are set", () => {
    expect(
      setupChecklist({ ...empty, branding: { hasLogo: true, hasColours: false } }).some((i) => i.href === "/organization"),
    ).toBe(false);
    expect(
      setupChecklist({ ...empty, branding: { hasLogo: false, hasColours: true } }).some((i) => i.href === "/organization"),
    ).toBe(false);
  });

  it("never blocks: it is the last item and the required steps come first", () => {
    const items = setupChecklist({ ...empty, branding: { hasLogo: false, hasColours: false } });
    // The four setup steps still lead; the nudge is appended after them.
    expect(items[items.length - 1].href).toBe("/organization");
    expect(items.slice(0, 4).map((i) => i.href)).toEqual([
      // Rounds before the field, which is `SETUP_ORDER` — the same sequence
      // the rail and the "Recommended flow" card state. This list used to run
      // field first and disagree with both.
      "/stages",
      "/registration",
      "/grouping",
      "/access",
    ]);
  });
});

/**
 * WHY THIS BLOCK NO LONGER MENTIONS A COLOUR.
 *
 * It used to, and the version it replaces recorded the bug in its own comment
 * without treating it as one: "a club created BEFORE the move has 'sunset'
 * stored, so it now reads as having chosen colours … the branding row of their
 * checklist ticks without them doing anything."
 *
 * That is the entire defect, written down and shipped. `hasColours` was
 * `themeKey !== DEFAULT_THEME`, so the answer depended on a constant declared
 * in another file for another purpose — and when the default moved from
 * "sunset" to "verdigris" the whole existing customer base flipped to "already
 * branded" and stopped being offered the nudge. Nothing went red, because the
 * test had been rewritten to use `DEFAULT_THEME` rather than a literal, which
 * made it follow the constant instead of checking it.
 *
 * `themeSetAt` records the act. There is no colour in these assertions now,
 * and that absence is the fix — a test that names no preset cannot be
 * invalidated by a preset changing.
 */
describe("clubBrandingState", () => {
  it("treats a fresh organization — never saved, no logo — as unbranded", () => {
    expect(clubBrandingState({ logoUrl: "", themeSetAt: null })).toEqual({
      hasLogo: false,
      hasColours: false,
    });
  });

  it("counts a saved theme or a logo as set", () => {
    expect(clubBrandingState({ logoUrl: "/x.png", themeSetAt: null }).hasLogo).toBe(true);
    expect(clubBrandingState({ logoUrl: "", themeSetAt: new Date() }).hasColours).toBe(true);
  });

  /**
   * THE CASE THE OLD RULE COULD NOT EXPRESS, in both directions.
   *
   * A club that opens the picker and deliberately keeps the stock colours has
   * chosen; a club that has never opened it has not. Under `themeKey !==
   * DEFAULT_THEME` those two are the same row and both answer "not chosen".
   * Under a timestamp they are different rows, which is the only reason this
   * assertion can exist at all.
   *
   * Note there is no `themeKey` here to set — that is deliberate. If this test
   * had to name a preset to express the case, the preset would be load-bearing
   * again.
   */
  it("distinguishes choosing the default from never choosing", () => {
    const chose = clubBrandingState({ logoUrl: "", themeSetAt: new Date("2026-01-01") });
    const never = clubBrandingState({ logoUrl: "", themeSetAt: null });
    expect(chose.hasColours).toBe(true);
    expect(never.hasColours).toBe(false);
  });

  it("is unbranded for a missing organization", () => {
    expect(clubBrandingState(null)).toEqual({ hasLogo: false, hasColours: false });
  });
});

/**
 * The backfill in migration 64 is the one place the historical defaults are
 * still named, and it has to name BOTH — the pair every row created before
 * 2026-09-06 carries, and the pair every row after it carries. Naming only the
 * current pair would mark the entire pre-move customer base as "chose their
 * colours", which is the bug this whole change exists to remove.
 *
 * Asserted against the migration SQL because that is where the claim lives.
 * `readVerbatim` rather than `readSource`: this is .sql, and its `--` lines are
 * SQL comments that the TypeScript comment stripper does not understand.
 */
describe("the themeSetAt backfill knows both historical defaults", () => {
  const SQL = readVerbatim("prisma/migrations/64_organization_theme_set_at/migration.sql");

  it("adds the column", () => {
    expect(SQL).toMatch(/ADD COLUMN\s+"themeSetAt"/);
  });

  it("treats the old pair and the new pair alike as unchosen", () => {
    // The statement, with its comment prose removed, so a default named only
    // in the explanation cannot satisfy this.
    const code = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    for (const preset of ["sunset", "verdigris"]) {
      expect(code, `the backfill does not know "${preset}" was ever the default accent`).toContain(
        `'${preset}'`,
      );
    }
    for (const preset of ["fairway", "optic"]) {
      expect(code, `the backfill does not know "${preset}" was ever the default secondary`).toContain(
        `'${preset}'`,
      );
    }
    // And it must be marking the ones that DID choose, not the ones that did not.
    expect(code).toMatch(/SET\s+"themeSetAt"\s*=\s*"updatedAt"/);
    expect(code).toMatch(/NOT IN \('sunset', 'verdigris'\)/);
  });

  /**
   * The current default has to be in that list, or the backfill silently stops
   * covering rows created from today onward. Read from `themes.ts` rather than
   * spelled again, so the next default move fails HERE — loudly, at the one
   * place that still has to know — instead of going quiet in production.
   */
  it("covers whatever the default is today", () => {
    const code = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(code, `the default accent is now "${DEFAULT_THEME}" and the backfill does not list it`).toContain(
      `'${DEFAULT_THEME}'`,
    );
    expect(
      code,
      `the default secondary is now "${DEFAULT_SECONDARY}" and the backfill does not list it`,
    ).toContain(`'${DEFAULT_SECONDARY}'`);
  });
});

describe("a checklist row calls a screen what the sidebar calls it", () => {
  /**
   * This row read "Rounds & format". The screen is "Rounds & formats" — the
   * same half-remembered name found the same day in the "Recommended flow"
   * card on Tournament details ("Rounds & format", "Prizes & Reports"). A name
   * typed a second time drifts once, so the labels are now read from `NAV`.
   *
   * Not every row is a screen name: the branding nudge deliberately reads "Add
   * your club's logo & colours" rather than "Club settings", because it names
   * a task. So this asserts the ROWS THAT DO name a screen, which is the ones
   * that come back from `screenName`.
   */
  const state: ChecklistState = {
    confirmed: [], waitlist: [], stages: [], groups: [], matches: [], accounts: [{}],
    branding: { hasLogo: false, hasColours: false },
  };
  const navLabels = new Set(NAV.flatMap((s) => s.items.map((i) => i.label)));

  it("uses the sidebar's own words for every row that names a screen", () => {
    const rows = setupChecklist(state);
    const named = rows.filter((r) => navLabels.has(r.label));
    // Four of the five: the branding nudge names a task, not a screen.
    expect(named).toHaveLength(4);
    for (const row of named) {
      expect(row.label, `${row.href} is called "${screenName(row.href)}"`).toBe(screenName(row.href));
    }
  });

  it("has no row whose label is a near-miss of the screen it links to", () => {
    // The failure mode this class of bug actually takes: not a wrong link, a
    // wrong NAME for the right link. Anything that is neither the screen's own
    // label nor a deliberate task description would land here.
    for (const row of setupChecklist(state)) {
      const real = screenName(row.href);
      if (row.label === real) continue;
      // The one deliberate exception, asserted by name so a second one has to
      // be added here on purpose.
      expect(row.label).toBe("Add your club's logo & colours");
    }
  });

  it("calls the outfit what it is, rather than calling everybody a club", () => {
    /**
     * A society secretary and a charity organizer were both told to brand a
     * club they have not got. The same defect `settingsLabel` exists for one
     * screen along — "a solo organizer came to be shown a screen about a club
     * they do not have" — and this row is the other half of it.
     *
     * `noun` rather than `label`, because `label` does not survive being
     * dropped into running text: "Add your Society or league's logo".
     */
    const forKind = (orgKind: string) =>
      setupChecklist({ ...state, orgKind }).find((r) => r.href === "/organization")!;

    expect(forKind("community").label).toBe("Add your society's logo & colours");
    expect(forKind("community").detail).toContain("your society's badge");
    expect(forKind("personal").label).toBe("Add your outing's logo & colours");
    // A CLUB still reads exactly as it did, which is the assertion that keeps
    // this from being a rewrite of the wording for everybody.
    expect(forKind("club").label).toBe("Add your club's logo & colours");
    // And so does a caller that has not been told — every one of them, before
    // the question existed.
    expect(setupChecklist(state).find((r) => r.href === "/organization")!.label).toBe(
      "Add your club's logo & colours",
    );
  });

  it("and both screens that show the list actually tell it which", () => {
    /**
     * READ FROM SOURCE, because a fallback is only safe if somebody uses the
     * real value. `CreateFirstTournament`'s `plan` prop was documented, tested
     * and defaulted — and never passed by its one caller, so the default WAS
     * the behaviour and every test of it was green. Same shape here: a society
     * that is still called a club because two pages forgot to say so is
     * exactly as broken as no fallback at all.
     *
     * Through `readSource`, so a comment mentioning `orgKind` cannot satisfy
     * an assertion about passing it.
     */
    for (const page of [["src", "app", "(app)", "dashboard", "page.tsx"], ["src", "app", "(app)", "event", "page.tsx"]]) {
      expect(readSource(...page), page.join("/")).toMatch(/orgKind: /);
    }
  });

  it("falls back to the path rather than guessing for an unknown href", () => {
    expect(screenName("/nowhere")).toBe("/nowhere");
    // The query is not part of which screen this is.
    expect(screenName("/registration?x=1")).toBe("Registration & field");
  });
});
