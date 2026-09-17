import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { overflowing } from "./overflow";

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8"));
const league = data.league as {
  eventId: string;
  topClub: string;
  clubCount: number;
  pairsPerClub: number;
};

/**
 * THE INTERCLUB LEAGUE, IN A BROWSER, AT EVERY WIDTH.
 *
 * Twelve clubs and six pairs each is the league Ajay is running, and until
 * this file existed not one of its screens had ever been rendered by a test.
 * `layout.spec` visits `/teams` and `/week` on every run — with a stroke-play
 * medal as the active event, so `LeagueSection` returns null and the sweep
 * measures an empty page. A twelve-row table with a club column, six meetings
 * of six four-balls and a play-off bracket had no measured width anywhere.
 *
 * That is not a theoretical gap. On 2026-09-17 a fourth option on the club's
 * role picker pushed `/organization` past a 320px screen, and the only reason
 * anybody found out is that `layout.spec` renders that screen with data. A
 * control is exactly as wide as what it is given.
 *
 * WHAT EACH ASSERTION IS FOR, since a layout test is the easiest kind to write
 * as a no-op: the CONTENT check comes first every time. An empty page has no
 * horizontal overflow either, and this suite has been fooled by that before —
 * the note in `e2e/fixture.mjs` about a 404 passing the public-leaderboard
 * spec is the same failure. So each test proves the league is on the screen
 * before it measures anything about it.
 *
 * READ-ONLY, like every other spec sharing this fixture. Nothing here
 * nominates, draws or records a play-off hole: the league fixture is seeded
 * once and three viewports run against it.
 */

/**
 * The strings that prove the league actually rendered, not an empty section.
 *
 * By TEXT rather than by role, because the two screens title it differently
 * and both are correct: `/teams` opens a section with an `h2`, and `/week`
 * puts it in a card whose title is a `card-title` span. Binding to the role
 * would have made this assert the markup rather than what a member reads.
 */
async function leagueIsOnScreen(page: Page, heading: string) {
  await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
  // The club column, at its most awkward: an em dash, two curly apostrophes
  // and an ampersand in one name.
  await expect(page.getByText(league.topClub, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/League table|Season table/).first()).toBeVisible();
}

/** Nothing sticks out, and the document itself has not been widened. */
async function fitsTheViewport(page: Page, where: string) {
  const width = page.viewportSize()?.width ?? 0;
  const offenders = await overflowing(page);
  expect(
    offenders,
    `${where}: ${offenders.length} element(s) past the right edge — ${JSON.stringify(offenders.slice(0, 3))}`,
  ).toEqual([]);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `${where}: body is ${scrollWidth}px in a ${width}px viewport`).toBeLessThanOrEqual(
    width + 1,
  );
}

test.describe("the league secretary's screen", () => {
  test.use({ storageState: ".e2e/league-organizer.json" });

  test("/teams shows twelve clubs and their week, and fits the viewport", async ({ page }) => {
    await page.goto("/teams");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, "/teams redirected away — not signed in?").toBe("/teams");
    await expect(page.locator("#__next_error__")).toHaveCount(0);

    await leagueIsOnScreen(page, "Clubs, pairs and meetings");

    // The staff half: team sheets to nominate into, and the draw.
    await expect(page.getByText("This week’s team sheets")).toBeVisible();
    await expect(page.getByRole("button", { name: /Nominate pair/ }).first()).toBeVisible();

    /**
     * EVERY CLUB, not just the one at the top. A table that renders its first
     * row and drops the rest would satisfy every assertion above, and the
     * twelfth club is the row furthest down a phone.
     */
    const rows = await page.locator("table tbody tr").count();
    expect(rows, "fewer rows than the league has clubs").toBeGreaterThanOrEqual(league.clubCount);

    await fitsTheViewport(page, "/teams");
  });
});

test.describe("what a club's member sees", () => {
  test.use({ storageState: ".e2e/league-member.json" });

  test("/week shows their league read-only, and fits the viewport", async ({ page }) => {
    await page.goto("/week");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, "/week redirected away — not signed in?").toBe("/week");
    await expect(page.locator("#__next_error__")).toHaveCount(0);

    await leagueIsOnScreen(page, "Clubs and meetings");

    /**
     * READ-ONLY IS THE PRODUCT RULE, not a detail of this screen: players
     * enter scores, opt in and out, and sign up. Nominating a pair, drawing a
     * week and settling a play-off are the club's, and a captain hands their
     * six pairs to the organizer rather than typing them in here.
     *
     * Asserted as an ABSENCE on the screen a member actually opens, because
     * the server action refusing them is invisible to somebody looking at a
     * button they should never have been shown.
     */
    for (const staffOnly of [/Nominate pair/, /Draw the week/, /Record the play-off hole/, /Overturn this result/]) {
      await expect(page.getByRole("button", { name: staffOnly })).toHaveCount(0);
    }

    await fitsTheViewport(page, "/week");
  });
});
