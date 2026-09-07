import { test, expect, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Relative, not the `@/` alias: Playwright compiles this file with its own
// tsconfig and does not resolve the app's path aliases.
import { readSource } from "../src/lib/__tests__/source";

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
    const src = readSource("src", "app", "(app)", e.name, "page.tsx");
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

/**
 * Every console screen has exactly one h1.
 *
 * None of them had ANY. The page title was a `<h2 style={{ fontSize: 27 }}>`
 * — the same lockup copied into twenty-three files — so every console screen
 * opened its heading outline at level 2 with nothing above it. Measured in a
 * browser on 2026-09-06: `/dashboard` reported `h1Count: 0`.
 *
 * What that costs is not the audit score. A screen reader's first move on an
 * unfamiliar page is to jump to the heading, and "skip to content" has nothing
 * to skip to; a document whose outline starts at h2 reads as a fragment of
 * some larger page that does not exist.
 *
 * SWEPT, not spot-checked, and asserted on the RENDERED page rather than in
 * source. Both halves matter. The title comes from a component on about half
 * these routes — PointsLeaderboard, TeamLeaderboard, RosterClient and others
 * each render their own — so a source assertion would have to know which
 * component each route mounts, and would silently stop covering a route that
 * changed component. And EXACTLY one is the assertion, not at-least-one:
 * several of those components can appear on the same route depending on
 * format, and two h1s is the failure that converting them all invites.
 */
for (const path of SCREENS) {
  test(`${path} has exactly one h1`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, `${path} redirected away — not signed in?`).toBe(path);

    const h1s = page.locator("h1");
    const count = await h1s.count();
    const texts = await h1s.allTextContents();
    expect(count, `${path} has ${count} h1s: ${JSON.stringify(texts)}`).toBe(1);
    await expect(h1s.first()).toBeVisible();
    expect((texts[0] ?? "").trim().length, `${path}'s h1 is empty`).toBeGreaterThan(0);
  });
}

/**
 * EVERY ICON ON THE PAGE ACTUALLY DRAWS.
 *
 * Icons are a generated sprite now, referenced with `<use href="#i-…">`. A
 * reference to a symbol that is not in the sprite renders NOTHING — no error,
 * no console warning, no failed request, no layout shift. The element keeps
 * its 1em box and draws empty space, so the build succeeds, the page renders,
 * and an icon is simply gone.
 *
 * `icon-sprite.test.ts` catches the version of this that is visible in source,
 * and bans the names that are assembled at runtime. This is the half that only
 * a rendered page can see: whether the id the component asked for is one the
 * document actually defines. Converting to the sprite produced four such
 * blanks, every one of them through a clean typecheck and a green unit suite.
 *
 * Hidden is not broken — the mobile tab bar is `display: none` on desktop and
 * its icons legitimately have no box.
 */
for (const path of SCREENS) {
  test(`${path} draws every icon it references`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, `${path} redirected away — not signed in?`).toBe(path);

    const broken = await page.evaluate(() => {
      const out: Array<{ href: string; reason: string }> = [];
      for (const svg of document.querySelectorAll("svg")) {
        const use = svg.querySelector("use");
        if (!use) continue;
        const cs = getComputedStyle(svg);
        if (cs.display === "none" || cs.visibility === "hidden" || !svg.getClientRects().length) continue;

        const href = use.getAttribute("href") ?? "";
        if (!document.getElementById(href.slice(1))) {
          out.push({ href, reason: "no such symbol in the sprite" });
          continue;
        }
        const box = svg.getBoundingClientRect();
        if (!box.width || !box.height) out.push({ href, reason: "zero-sized" });
      }
      return out;
    });

    expect(broken, `${path}: ${JSON.stringify(broken)}`).toEqual([]);

    // And nothing is still asking for the webfont that was removed.
    const legacy = await page.locator("i.ph").count();
    expect(legacy, `${path} still renders ${legacy} webfont icon(s)`).toBe(0);
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

/**
 * Signing out is reachable without scrolling the sidebar.
 *
 * The sidebar was one scrolling column with the footer pushed down by
 * `margin-top: auto`, which places it at the bottom only while the content
 * fits. It stopped fitting: measured against the seeded demo club at
 * scrollTop 0, 1440x900 hid 172px — Sign out at y=1020, "Viewing as" at
 * y=974 — and 1366x768 hid 304px, taking Messages, Reports & export and the
 * whole Money section with it. On the commonest laptop screen there was no
 * visible way to sign out.
 *
 * This is asserted end-to-end rather than in a unit test because nothing below
 * Playwright can see it: the markup was always present and correct, and every
 * one of those elements would pass `toBeVisible()`. The defect is entirely in
 * where the box landed relative to the viewport, which needs a real viewport
 * of a real height.
 *
 * Desktop runs 1280x900 here, which is inside the range that used to fail, so
 * this cell can express the bug. It is skipped on the phone projects, where
 * the sidebar is replaced by the tab bar and there is nothing to measure.
 */
test("sign out is on screen without scrolling the sidebar", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "no sidebar below the desktop breakpoint");

  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname, "redirected away — not signed in?").toBe("/dashboard");

  const sidebar = page.locator("aside.app-sidebar");
  await expect(sidebar).toBeVisible();
  const signOut = sidebar.locator('button[title="Sign out"]');
  await expect(signOut).toBeVisible();

  const height = page.viewportSize()?.height ?? 0;
  const box = await signOut.boundingBox();
  expect(box, "sign out has no box at all").not.toBeNull();
  expect(
    box!.y + box!.height,
    `sign out ends at ${Math.round(box!.y + box!.height)}px in a ${height}px viewport`,
  ).toBeLessThanOrEqual(height);

  // And the aside itself must not be what scrolls — if it is, the footer is
  // riding on the end of the content again and merely happens to fit today.
  const asideScrolls = await sidebar.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(asideScrolls, "the sidebar as a whole scrolls; only its nav band should").toBe(false);
});

/**
 * The two things the landing page was failing that only a real request can
 * show.
 *
 * A `main` landmark: the page had none, so a screen-reader user's first move
 * on an unfamiliar page — jump to main — had nowhere to go, and "skip to
 * content" had nothing to skip to. Asserted on the rendered document rather
 * than by searching the source, because `<main>` in the JSX and a main
 * landmark in the accessibility tree are not the same claim: a second one
 * added anywhere later makes both ambiguous, and only counting the rendered
 * result catches that.
 *
 * And `/favicon.ico`: the browser asks for that exact path whether or not a
 * `<link rel="icon">` was supplied, `src/app/icon.svg` did not answer it, and
 * the resulting 404 was logged as a console error on every single visit — the
 * one thing keeping Best Practices off 100. It is generated by
 * `scripts/gen-icons.mjs` from the same mark as every other icon.
 */
test("the landing page has one main landmark and answers /favicon.ico", async ({ browser, request }) => {
  /**
   * SIGNED OUT, in its own context. This file sets `storageState` to the
   * organizer at the top, and a signed-in visit to "/" is redirected — on the
   * client, after the document loads — to /dashboard.
   *
   * The first version of this test did not do that, and it is worth recording
   * what that looked like, because it passed two of its three assertions: the
   * console shell has a `main` of its own, so `toHaveCount(1)` and
   * `getByRole("main")` were both satisfied by a completely different page.
   * Only `main h1` failed, and it failed because the DASHBOARD has no h1 —
   * nothing to do with the landing page this test claims to measure.
   *
   * That is the mirror image of the trap the redirect guard above was written
   * for: that one caught specs measuring the landing page while believing they
   * were on a console screen. This is a spec measuring a console screen while
   * believing it is on the landing page. Hence the explicit pathname
   * assertion below — a landmark test that a redirect can satisfy is not a
   * test.
   */
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, "not on the landing page").toBe("/");

    // Exactly one — zero is the bug that was there, and more than one is the
    // bug somebody introduces while fixing it.
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("main")).toBeVisible();
    // The h1 belongs inside it: a main landmark that excludes the page's own
    // headline is a landmark around the leftovers.
    await expect(page.locator("main h1")).toHaveCount(1);
  } finally {
    await context.close();
  }

  const icon = await request.get("/favicon.ico");
  expect(icon.status(), "GET /favicon.ico").toBe(200);
  const body = await icon.body();
  expect(body.length, "favicon.ico is empty").toBeGreaterThan(0);
  // A real ICO container: reserved 0, type 1. Serving an HTML error page with
  // a 200 would otherwise satisfy the status check.
  expect([body[0], body[1], body[2], body[3]], "not an ICO header").toEqual([0, 0, 1, 0]);
});

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
