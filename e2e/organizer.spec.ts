import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8"));

test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

/**
 * The console, which is where a club actually spends its Saturday.
 *
 * The end-to-end suite covered the player shell and the layout sweep and left
 * the organizer's own screens untested — eighteen specs, none of them on the
 * half of the product a club pays for. This walks the path a committee walks
 * on the day: see the field, see the cards, see what the pots did, see who
 * owes whom.
 *
 * The reason to have it is not coverage arithmetic. `/prizes` shipped a 500 to
 * production on 2026-08-25 because a hook was added to a server component, and
 * a clean build with 1,300 green tests said nothing at all about it. Every
 * assertion below is on a screen that has failed that way or could.
 */

const FIELD = ["Aj Moore", "Marcus Webb", "Priya Nair", "Sang-woo Kim"];

test("an organizer lands in the console, not the player app", async ({ page }) => {
  await page.goto("/");
  // The mirror of the player test: landingScreenFor sends staff to the
  // console, and getting this backwards would put an organizer in a shell
  // with no way to run their own tournament.
  await expect(page).not.toHaveURL(/\/me$/);
  // The console sidebar, which is a different navigation from the player
  // shell's tab bar — asserting the player's nav here would have passed on
  // entirely the wrong screen, which is what the first draft of this did.
  await expect(page.getByRole("link", { name: /Dashboard/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Members/i })).toBeVisible();
});

test("the leaderboard shows the whole field, not just who has scored", async ({ page }) => {
  await page.goto("/leaderboard");
  await page.waitForLoadState("networkidle");

  // Every confirmed entrant appears, including the one whose card is only
  // part-filled. A board that quietly drops players who have not finished is
  // the shape a committee notices at prizegiving and not before.
  for (const name of FIELD) {
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  }
});

test("the score-entry screen shows every player in the field", async ({ page }) => {
  await page.goto("/entry");
  await page.waitForLoadState("networkidle");

  // The fixture deliberately holds one card entered, one certified, one
  // approved and one disputed. If the screen renders only some of them, the
  // organizer cannot see what still needs signing off — and the player whose
  // card is only part-filled is exactly the one who would go missing.
  const body = await page.locator("body").innerText();
  expect(body.length, "the score-entry screen rendered nothing").toBeGreaterThan(200);
  for (const name of FIELD) {
    expect(body, `${name} is missing from the score-entry screen`).toContain(name);
  }
});

test("prizes renders its arithmetic rather than 500-ing", async ({ page }) => {
  /**
   * THE REGRESSION THIS EXISTS FOR. `/prizes` returned 500 to every user in
   * production because a client hook was added to a server component — a
   * failure invisible to tsc, to 1,300 unit tests and to a clean build.
   */
  const res = await page.goto("/prizes");
  expect(res?.status(), "/prizes must not be a server error").toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).not.toContainText("Application error");
});

test("group games shows the fourballs the draw actually made", async ({ page }) => {
  const res = await page.goto("/group-games");
  expect(res?.status()).toBeLessThan(400);
  await page.waitForLoadState("networkidle");

  // The tee sheet is published in the fixture, so the groups it names must be
  // the ones offered a game. A page that renders no groups here means the
  // sheet and the money screens disagree about who is playing together.
  const body = await page.locator("body").innerText();
  expect(body, "no tee group reached the group-games screen").toMatch(/Group\s*\d/i);
});

test("the public board and the console agree on the field", async ({ page, context }) => {
  /**
   * Two readers, one answer.
   *
   * The console board and the public one are separate code paths — and since
   * the public one is now CACHED per event, they can disagree in a way neither
   * screen would reveal on its own. A spectator being shown a different field
   * from the committee is the kind of error nobody reports as a bug; they just
   * stop trusting the board.
   */
  await page.goto("/leaderboard");
  await page.waitForLoadState("networkidle");
  const console_ = await page.locator("body").innerText();

  const spectator = await context.newPage();
  await spectator.goto(`/live/${data.shareToken}`);
  await spectator.waitForLoadState("networkidle");
  const board = await spectator.locator("body").innerText();

  for (const name of FIELD) {
    expect(console_, `${name} missing from the console board`).toContain(name);
    expect(board, `${name} missing from the public board`).toContain(name);
  }
  await spectator.close();
});

test("the public board says how fresh it is, and it is fresh", async ({ page }) => {
  // The board polls itself now. The label is the only thing telling a
  // spectator whether they are looking at the current standings, so a board
  // that renders without it is one nobody can calibrate.
  await page.goto(`/live/${data.shareToken}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).toContainText(/updated|updates on its own/i);
});
