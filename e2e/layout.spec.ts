import { test, expect, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8"));

test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

/**
 * The bugs this file exists for, all of which shipped green:
 *
 *  - /registration scrolled sideways on a phone, because a grid item keeps
 *    `min-width: auto` however tightly you constrain its track.
 *  - the course card was 418px of table inside a 315px column with nothing
 *    scrolling it, so the last holes could not be reached at all.
 *  - /organization ran 4px wide behind a button that would not wrap.
 *
 * A page that scrolls sideways is never intended, so this asserts it for every
 * screen rather than the three that happened to be looked at.
 */

/**
 * Every console screen, read off the filesystem rather than listed by hand.
 *
 * The hand-written list held fourteen of the twenty-two routes that exist —
 * /bracket, /qualification, /grouping, /scoring, /series, /week, /scorecard
 * and /access had no layout assertion at all. That is the failure mode of a
 * curated list: it covers the screens somebody thought about, which are never
 * the ones that break.
 *
 * Deriving it means a new screen is swept the day it is added, without anyone
 * remembering to come back here.
 */
const SCREENS = readdirSync(join(process.cwd(), "src", "app", "(app)"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  // Route groups, private folders, and dynamic segments that need a param.
  .filter((e) => !e.name.startsWith("[") && !e.name.startsWith("_") && !e.name.startsWith("("))
  .filter((e) => existsSync(join(process.cwd(), "src", "app", "(app)", e.name, "page.tsx")))
  // Legacy redirect stubs — /scorecard sends you to /foursomes, /scoring to
  // /stages. They have a page.tsx and no page: asserting the URL afterwards
  // fails on the redirect, and there is no layout of their own to measure.
  // Detected rather than listed, so a route that stops being a stub rejoins
  // the sweep on its own.
  .filter((e) => {
    const src = readFileSync(join(process.cwd(), "src", "app", "(app)", e.name, "page.tsx"), "utf8");
    return !/^\s*redirect\(/m.test(src);
  })
  .map((e) => `/${e.name}`)
  .sort();

/** Elements sticking out past the viewport with nothing able to scroll them. */
async function overflowing(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: { cls: string; right: number; text: string }[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= vw + 1) return;
      // Inside something that scrolls horizontally is fine — that is a table
      // in its wrapper doing exactly what it should.
      let n = el.parentElement;
      let scrollable = false;
      while (n && n !== document.body) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === "auto" || ox === "scroll") { scrollable = true; break; }
        n = n.parentElement;
      }
      if (!scrollable) {
        out.push({
          cls: String((el as HTMLElement).className ?? "").slice(0, 40),
          right: Math.round(r.right),
          text: (el.textContent ?? "").trim().slice(0, 40),
        });
      }
    });
    return out;
  });
}

for (const path of SCREENS) {
  test(`${path} does not scroll sideways`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    // Prove we are ON the screen before asserting anything about it.
    //
    // Without this the whole file is worthless: the first run of this suite
    // could not authenticate at all, every route bounced to the landing page,
    // and fifteen specs "passed" having measured the landing page fifteen
    // times. A layout assertion that a redirect can satisfy is not a test.
    expect(new URL(page.url()).pathname, `${path} redirected away — not signed in?`).toBe(path);
    await expect(page.locator("#__next_error__")).toHaveCount(0);

    const width = page.viewportSize()?.width ?? 0;
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const offenders = await overflowing(page);

    expect(
      offenders,
      `${path}: ${offenders.length} element(s) past the right edge — ${JSON.stringify(offenders.slice(0, 3))}`,
    ).toEqual([]);
    expect(scrollWidth, `${path}: body is ${scrollWidth}px in a ${width}px viewport`).toBeLessThanOrEqual(
      width + 1,
    );
  });
}

test("the public leaderboard fits a phone too", async ({ page }) => {
  // Outside the app shell and outside the auth guard, so it has its own
  // layout and its own chance to be wrong.
  await page.goto(`/live/${data.shareToken}`);
  await page.waitForLoadState("networkidle");

  // Same trap as the redirect guard above: a 404 has no horizontal overflow,
  // so without proving the board rendered this asserts nothing.
  await expect(page.locator("ol li").first()).toBeVisible();

  const width = page.viewportSize()?.width ?? 0;
  expect(await overflowing(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
});
