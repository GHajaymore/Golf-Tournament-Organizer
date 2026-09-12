import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { screenName } from "../nav";
import { ALL_PLAYER_SCREENS, PLAYER_TABS } from "../player-nav";
import { readSource } from "./source";

/**
 * EVERY PLAYER SCREEN NAMES ITSELF IN THE BROWSER TAB.
 *
 * Five of the six did not. `/me` named itself and the board, the card, the
 * money, the rules and messages inherited the root layout's `title.default` —
 * "TourneyHQ — Golf tournament management, from the draw to the payout" — so
 * every one of them read the same marketing sentence. Walked as a player on
 * 2026-09-11, on the surface the whole player app lives on.
 *
 * `screen-metadata.ts` was written for exactly this and fixed it for the
 * twenty-one console screens and `/me`. It stopped there because the player's
 * names lived inside a `"use client"` tab bar, where no server component could
 * read them — so the fix was not "add five strings", it was moving the list
 * somewhere both readers can see it.
 *
 * SWEPT FROM THE FILESYSTEM, not from a list. The hand-written list is what
 * missed five screens in the first place, and `e2e/layout.spec.ts` already
 * records the same lesson: "the hand-written list covered 14 of 22 routes; the
 * eight it missed had no layout assertion at all."
 */

const PLAYER_DIR = join(process.cwd(), "src", "app", "(player)").split("/").join(sep);

/** Every `/me…` route that exists on disk, found rather than listed. */
function playerRoutes(dir = join(PLAYER_DIR, "me"), href = "/me"): string[] {
  const out: string[] = [];
  if (existsSync(join(dir, "page.tsx"))) out.push(href);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Route groups and dynamic segments are not screens a player navigates to
    // by name, and neither has a tab.
    if (!entry.isDirectory() || entry.name.startsWith("(") || entry.name.startsWith("[")) continue;
    out.push(...playerRoutes(join(dir, entry.name), `${href}/${entry.name}`));
  }
  return out;
}

const ROUTES = playerRoutes();

describe("the player's screens are named", () => {
  it("found them at all, so an empty sweep cannot pass this vacuously", () => {
    // The failure mode of every filesystem-driven test.
    expect(ROUTES.length).toBeGreaterThan(4);
    expect(ROUTES).toContain("/me");
    expect(ROUTES).toContain("/me/card");
  });

  it("gives every one of them a title of its own", () => {
    /**
     * THE ASSERTION THE DEFECT WOULD HAVE FAILED. A page with no `metadata`
     * export silently inherits the root's, and nothing anywhere said so —
     * which is why five screens shipped like that.
     */
    for (const href of ROUTES) {
      const src = readSource("src", "app", "(player)", ...href.slice(1).split("/"), "page.tsx");
      expect(src, `${href} has no metadata, so its tab reads the marketing sentence`).toMatch(
        /export const metadata/,
      );
    }
  });

  it("titles them from the same list the tab bar renders", () => {
    /**
     * NOT A SECOND SET OF STRINGS. `screen-metadata.ts` states the rule for the
     * console — "the name comes from the sidebar, not from a second list" — and
     * the player app now has one list to be the sidebar's equivalent. A screen
     * renamed on the tab bar is renamed in the tab on the same line.
     */
    for (const href of ROUTES) {
      const src = readSource("src", "app", "(player)", ...href.slice(1).split("/"), "page.tsx");
      expect(src, `${href} titles itself with a literal instead of screenMetadata`).toMatch(
        /screenMetadata\(/,
      );
    }
  });

  it("resolves a real name for every one, never the raw path", () => {
    /**
     * `screenName` falls back to returning the path when it recognises
     * nothing, which is not an error and IS a browser tab reading "/me/board".
     * So the sweep has to check the answer, not just that a call was made —
     * this is what catches a route added on disk and never added to the list.
     */
    for (const href of ROUTES) {
      const name = screenName(href);
      expect(name, `${href} has no entry in player-nav.ts`).not.toBe(href);
      expect(name.trim(), href).not.toBe("");
      expect(name, `${href} is titled with a path`).not.toMatch(/^\//);
    }
  });

  it("never titles a screen with the marketing sentence", () => {
    // The absence that names the actual defect, rather than a proxy for it.
    for (const href of ROUTES) {
      expect(screenName(href), href).not.toMatch(/from the draw to the payout/i);
      expect(screenName(href), href).not.toMatch(/^TourneyHQ/);
    }
  });
});

describe("the one list, read by both", () => {
  it("has an entry for every route on disk", () => {
    // The other direction: a screen added to the filesystem and forgotten here
    // fails, rather than quietly titling itself with its own path.
    const known = new Set(ALL_PLAYER_SCREENS.map((s) => s.href));
    for (const href of ROUTES) {
      expect(known.has(href), `${href} exists on disk but is not in player-nav.ts`).toBe(true);
    }
  });

  it("has no entry for a route that does not exist", () => {
    // And the reverse, which is how a dead tab gets shipped — the fault the
    // org setup checklist was fixed for, where all five of its hrefs were
    // routes this app does not serve.
    for (const s of ALL_PLAYER_SCREENS) {
      expect(ROUTES, `${s.href} is in player-nav.ts but has no page`).toContain(s.href);
    }
  });

  it("keeps the tab bar to four, which is the whole point of it", () => {
    /**
     * A player does four things, and every extra tab is something to read past
     * while standing on a tee. Money is the conditional fifth and is
     * deliberately not in this list. If a fifth is ever wanted, something here
     * should have to leave — and this is what makes that a decision rather
     * than a drift.
     */
    expect(PLAYER_TABS).toHaveLength(4);
    expect(PLAYER_TABS.map((t) => t.href)).toEqual(["/me", "/me/board", "/me/card", "/me/rules"]);
  });

  it("gives the console's name to /me, where the two navs disagree", () => {
    /**
     * `/me` is "My round" in the console sidebar and "Today" on the player's
     * tab bar, and the browser tab keeps "My round". A tab is read as "which
     * of my windows is this", and "Today" answers that far less well than the
     * words an organizer who also plays clicked to get here — while "Today" is
     * exactly right on a bar at the bottom of a phone, where the context is
     * obvious and the space is 80px.
     *
     * Asserted so the resolution order in `screenName` is a decision somebody
     * made rather than an accident of which list is searched first.
     */
    expect(screenName("/me")).toBe("My round");
    expect(PLAYER_TABS[0].label).toBe("Today");
  });
});
