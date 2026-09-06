import { describe, it, expect } from "vitest";
import { navForRole, primaryTabs, NAV } from "@/lib/nav";
import { DEFAULT_SETTINGS, type TournamentSettings } from "@/lib/tournament-settings";
import { readSource } from "./source";

/**
 * The phone's tab bar offers the same doors the sidebar does.
 *
 * It rendered a static list of three — Dashboard, Board, Scores — while the
 * sidebar beside it was filtered by `navForRole`. So on a phone the app kept
 * offering screens it had already decided to hide, and both of them bounce:
 * `leaderboard/page.tsx` and `entry/page.tsx` each `redirect("/dashboard")`
 * when the setting forbids them.
 *
 * The sharpest case is the role preview, whose whole purpose is to show an
 * organizer what a PLAYER sees. Switch "Viewing as" to Player on a phone in a
 * blind event and the bar still showed Board after the sidebar had removed it.
 * A preview that lies is worse than no preview.
 *
 * Asserted against SETTINGS that actually differ rather than against a role
 * alone, because a role-only fixture cannot express this bug: staff may see a
 * blind leaderboard and may enter scores in an organizer-scored event, so
 * every tab stays visible for admin whatever the settings say. Only the player
 * view discriminates, which is exactly the view that was broken.
 */

const withSettings = (over: Partial<TournamentSettings>): TournamentSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
});

/** A player who may do everything the tournament allows by default. */
const OPEN = withSettings({ leaderboardVisibility: "participants", scoreEntryBy: "players" });
/** Blind: the standings are hidden from players. */
const BLIND = withSettings({ leaderboardVisibility: "staff", scoreEntryBy: "players" });
/** Organizer-scored: players do not enter their own scores. */
const STAFF_SCORED = withSettings({ leaderboardVisibility: "participants", scoreEntryBy: "staff" });

const tabsFor = (settings: TournamentSettings, role: "admin" | "player" = "player") =>
  primaryTabs(navForRole(role, settings, { isPlayerToo: true })).map((t) => t.label);

describe("the phone tab bar shows what the sidebar shows", () => {
  it("offers all three when the tournament allows all three", () => {
    // The control. Without it, a bar that returned [] would satisfy every
    // "does not offer" assertion below and look like a passing fix.
    expect(tabsFor(OPEN)).toEqual(["Dashboard", "Board", "Scores"]);
  });

  it("drops Board in a blind event, as the sidebar does", () => {
    const tabs = tabsFor(BLIND);
    expect(tabs).not.toContain("Board");
    // Still useful, rather than emptied out.
    expect(tabs).toContain("Dashboard");
    expect(tabs).toContain("Scores");
  });

  it("drops Scores when players do not enter their own", () => {
    const tabs = tabsFor(STAFF_SCORED);
    expect(tabs).not.toContain("Scores");
    expect(tabs).toContain("Board");
  });

  it("never offers a tab the sidebar has hidden, for any of these settings", () => {
    /**
     * The invariant behind the three cases above, stated once so a fourth
     * setting added later is covered without a fourth test.
     */
    for (const settings of [OPEN, BLIND, STAFF_SCORED]) {
      for (const role of ["admin", "player"] as const) {
        const sections = navForRole(role, settings, { isPlayerToo: true });
        const reachable = new Set(sections.flatMap((s) => s.items).map((i) => i.href));
        for (const tab of primaryTabs(sections)) {
          expect(reachable.has(tab.href), `${role}: tab ${tab.label} -> ${tab.href} is not in the sidebar`).toBe(true);
        }
      }
    }
  });
});

describe("the tab bar keeps no second copy of the nav", () => {
  it("takes each tab's href and icon from NAV", () => {
    /**
     * The other half of the same fault: the bar carried its own href AND its
     * own icon for all three screens. Two of those icons were changed in NAV
     * when the sidebar's duplicate glyphs were resolved, and a static copy
     * would have kept the old ones on the surface nobody checks on a desktop.
     */
    const items = new Map(NAV.flatMap((s) => s.items).map((i) => [i.key, i]));
    for (const tab of primaryTabs(NAV)) {
      const source = items.get(tab.key)!;
      expect(tab.href, tab.key).toBe(source.href);
      expect(tab.icon, tab.key).toBe(source.icon);
    }
  });

  it("does not rebuild the list inside the component", () => {
    // Read through readSource: the comment above the call names primaryTabs,
    // and an absence check that a comment can satisfy proves nothing.
    const src = readSource("src/components/MobileTabBar.tsx");
    expect(src).toMatch(/primaryTabs\(sections\)/);
    expect(src, "a hard-coded href is a second source of truth").not.toMatch(/href:\s*["']\//);
  });
});
