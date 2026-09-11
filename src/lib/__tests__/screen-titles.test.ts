import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { allNavItems, screenName } from "../nav";

/**
 * EVERY CONSOLE SCREEN READ THE SAME THING IN THE BROWSER TAB.
 *
 * Twenty-one console screens and `/me`, all inheriting the root layout's
 * `title.default`: "TourneyHQ — Golf tournament management, from the draw to
 * the payout". The root metadata has carried a `template` — "%s · TourneyHQ" —
 * since `/play` was found replacing the product name outright, and its comment
 * says every page that names itself needs the suffix. These pages never named
 * themselves, so there was nothing for the template to fill.
 *
 * Walked on 2026-09-11 with the tee sheet, score entry and the leaderboard
 * open: three tabs, one sentence, truncated to "TourneyHQ — Golf tour…". Same
 * for the history menu and every bookmark.
 *
 * SWEPT FROM THE FILESYSTEM, for the reason `layout.spec` is: a hand-written
 * list covered 14 of 22 routes there and the eight it missed had no assertion
 * at all — silently, because a short list looks exactly like a complete one. A
 * console screen added next year is titled the day it is added, or this goes
 * red.
 */

const APP_DIR = join("src", "app", "(app)");

/** Every `src/app/(app)/<dir>/page.tsx` on disk, never a list kept here. */
function consoleScreens(): string[] {
  return readdirSync(join(process.cwd(), APP_DIR), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * `/scorecard`, `/scoring` and `/qualification` are one-line `redirect()`s kept
 * for old bookmarks — printing moved into the Tee sheet, Match Points into the
 * Round builder, qualification under the draw it seeds. A page that renders
 * nothing has no name to carry, and Next never resolves metadata for it.
 *
 * Detected rather than listed, so a screen that is LATER reduced to a redirect
 * stops being asked for a title without anyone editing this file — and, more
 * to the point, a screen that grows out of being one starts being asked.
 */
function isRedirectOnly(src: string): boolean {
  return /redirect\(["'][^"']+["']\);?\s*}\s*$/.test(src.trim());
}

describe("every console screen names itself", () => {
  const screens = consoleScreens();

  it("finds the screens on disk rather than trusting a list in here", () => {
    // A sweep that silently found nothing would pass every assertion below.
    expect(screens.length).toBeGreaterThanOrEqual(20);
    expect(screens).toContain("dashboard");
    expect(screens).toContain("leaderboard");
  });

  for (const dir of screens) {
    const src = readSource(APP_DIR, dir, "page.tsx");
    if (isRedirectOnly(src)) continue;

    it(`/${dir} exports a title taken from the sidebar`, () => {
      /**
       * Anchored on the leading space so `/grouping` cannot be matched by
       * `/group-games` — the same substring collision that made a
       * `hasTeeSheet` assertion pass off `x-hasTeeSheet` in #292, which is why
       * the href is pinned whole rather than searched for.
       */
      expect(src).toMatch(
        new RegExp(`screenMetadata(ForShape)?\\("/${dir}"\\)`),
      );
      expect(src).toMatch(/export const (metadata|generateMetadata) =/);
    });
  }

  it("the player's own screen names itself too", () => {
    const me = readSource("src", "app", "(player)", "me", "page.tsx");
    expect(me).toMatch(/screenMetadata\("\/me"\)/);
    expect(me).toMatch(/export const metadata =/);
  });

  it("keeps no second copy of a screen's name", () => {
    /**
     * Absence, which is the comment-proof direction under `readSource`.
     *
     * The name has to come from `NAV` through `screenName`, not be typed into
     * the page beside it. A literal `title:` in a console page is a second
     * source of truth for the one string the sidebar already owns, and the
     * sidebar is what the organizer clicked.
     */
    for (const dir of consoleScreens()) {
      const src = readSource(APP_DIR, dir, "page.tsx");
      if (isRedirectOnly(src)) continue;
      expect(src).not.toMatch(/export const metadata = \{/);
    }
  });
});

describe("the names themselves", () => {
  /**
   * `screenName` FALLS BACK TO THE HREF, on purpose — "falls back to the href,
   * which is at least true, rather than to a guess". That is right for a
   * cross-reference and useless as a browser tab: a bookmark reading
   * "/group-games · TourneyHQ" is worse than the marketing sentence it
   * replaced, because it looks deliberate.
   *
   * So every route this ships a title for has to resolve to a real label, and
   * the only way that is provable is to notice the fallback firing.
   */
  it("resolves every titled route to a label, never to the path", () => {
    const routes = allNavItems().map((i) => i.href);
    expect(routes.length).toBeGreaterThan(15);
    for (const href of routes) {
      const name = screenName(href);
      expect(name, `${href} fell through to the path`).not.toBe(href);
      expect(name.trim()).not.toBe("");
    }
  });

  it("gives the two screens a casual round renames their own name", () => {
    /**
     * `MATCH_ITEM_LABEL` relabels exactly these two, and they are the reason
     * `screenMetadataForShape` exists at all. If a third is added there and
     * this stays green, the tab and the sidebar have drifted — which is the
     * disagreement `screenName` was written to stop.
     */
    expect(screenName("/dashboard", true)).toBe("This round");
    expect(screenName("/reports", true)).toBe("Export this round");
    // And the tournament wording is genuinely different, so the pair above
    // cannot pass by the two readings happening to agree.
    expect(screenName("/dashboard", false)).toBe("Dashboard");
    expect(screenName("/reports", false)).toBe("Reports & export");
  });

  it("routes the shape-aware helper at exactly those two", () => {
    // The counterpart to the test above, on the other side of the boundary: a
    // third relabelled screen must also be wired to the shape-aware helper,
    // and a static title on one of these two is the bug this PR fixed.
    for (const dir of consoleScreens()) {
      const src = readSource(APP_DIR, dir, "page.tsx");
      if (isRedirectOnly(src)) continue;
      const shapeAware = /screenMetadataForShape\(/.test(src);
      const renamed = screenName(`/${dir}`, true) !== screenName(`/${dir}`, false);
      expect(shapeAware, `/${dir}`).toBe(renamed);
    }
  });
});

describe("the heading over each screen", () => {
  /**
   * THE DOOR AND THE ROOM AGREE.
   *
   * Eighteen of the twenty-one already headed themselves with the label on the
   * link that reaches them. `/access` read "Access control" over a sidebar
   * entry reading "Access & staff", and the tab was about to become a third
   * name for one screen — exactly what `screenName`'s own comment describes
   * going wrong with "Rounds & format" and "Prizes & Reports".
   *
   * Only this one is pinned. The others differ on purpose — `/rules` heads
   * itself "The rules this competition runs under", which is a sentence and a
   * good heading and a bad tab.
   */
  it("/access heads itself with the words on its own link", () => {
    const src = readSource(APP_DIR, "access", "page.tsx");
    expect(src).toMatch(/<h1[^>]*>Access &amp; staff<\/h1>/);
    expect(src).not.toMatch(/>Access control</);
    expect(screenName("/access")).toBe("Access & staff");
  });
});
