import { describe, it, expect } from "vitest";
import { setupChecklist, isUnstarted, clubBrandingState, type ChecklistState } from "../services/checklist";
import { NAV, screenName } from "../nav";

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
    expect(items[0].detail).toContain("No players yet");
    expect(items[1].detail).toContain("No rounds yet");
    expect(items[2].detail).toContain("No flights yet");
  });

  it("marks the work done once it is", () => {
    const items = setupChecklist(ready);
    expect(items[0].done).toBe(true);
    expect(items[0].detail).toContain("24 confirmed");
    expect(items[1].detail).toContain("2 rounds");
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
    expect(setupChecklist(ready)[0].detail).not.toContain("waitlisted");
    expect(setupChecklist({ ...ready, waitlist: [{}, {}] })[0].detail).toContain("2 waitlisted");
  });

  it("keeps staff optional — one person can run a tournament", () => {
    const staff = setupChecklist(empty).find((i) => i.label === "Access & staff");
    expect(staff?.optional).toBe(true);
    expect(staff?.detail).toContain("Just you so far");
  });

  it("points every step at the screen that completes it", () => {
    expect(setupChecklist(empty).map((i) => i.href)).toEqual([
      "/registration",
      "/stages",
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
      "/registration",
      "/stages",
      "/grouping",
      "/access",
    ]);
  });
});

describe("clubBrandingState", () => {
  it("treats a fresh organization (default preset, no hex, no logo) as unbranded", () => {
    // A new org carries themeKey = the default preset and an empty hex.
    expect(clubBrandingState({ logoUrl: "", themeKey: "sunset", themeHex: "" })).toEqual({
      hasLogo: false,
      hasColours: false,
    });
  });

  it("counts a logo, a custom hex, or a non-default preset as set", () => {
    expect(clubBrandingState({ logoUrl: "/x.png", themeKey: "sunset", themeHex: "" }).hasLogo).toBe(true);
    expect(clubBrandingState({ logoUrl: "", themeKey: "sunset", themeHex: "#0a5" }).hasColours).toBe(true);
    expect(clubBrandingState({ logoUrl: "", themeKey: "ocean", themeHex: "" }).hasColours).toBe(true);
  });

  it("is unbranded for a missing organization", () => {
    expect(clubBrandingState(null)).toEqual({ hasLogo: false, hasColours: false });
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

  it("falls back to the path rather than guessing for an unknown href", () => {
    expect(screenName("/nowhere")).toBe("/nowhere");
    // The query is not part of which screen this is.
    expect(screenName("/registration?x=1")).toBe("Registration & field");
  });
});
