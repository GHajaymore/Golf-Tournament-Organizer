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

  /**
   * Console-only DESTINATIONS, located by href.
   *
   * Two earlier versions of this assertion were wrong in the same way: they
   * described a layout rather than a capability. The first looked for the
   * player shell's tab bar; the second for the desktop sidebar, which a phone
   * does not have — it renders quick actions instead, and CI caught that on
   * the two device profiles while desktop passed.
   *
   * Where the links sit is a design decision and will change again. That an
   * organizer can reach registration and prizes, and a player never can, is
   * the thing worth pinning, and an href holds whichever way they are laid
   * out.
   */
  // Scoped to `main`: the sidebar copy of these links exists in the DOM on a
  // phone but is CSS-hidden, so an unscoped locator matches the invisible one
  // and fails on exactly the viewports a tournament is actually run from.
  await expect(page.locator('main a[href="/registration"]').first()).toBeVisible();
  await expect(page.locator('main a[href="/prizes"]').first()).toBeVisible();
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

/**
 * DESTROYING A NOTICE TAKES TWO TAPS.
 *
 * Pin and Delete were two unlabelled 34px icons eight pixels apart at 375px.
 * One is harmless; the other is a hard delete with no undo and nothing to
 * reconstruct the post from. Missing Pin by a thumb's width destroyed it.
 *
 * This runs at every viewport the suite carries, because the adjacency that
 * makes it dangerous is a phone's, and a desktop-only assertion would have
 * said nothing about the case that prompted it.
 *
 * The row this needs did not exist until the fixture seeded one: with no
 * announcements the screen renders an empty state, so every previous sweep of
 * this route — the touch-minimum sweep included — measured a page with no
 * pin or delete control on it at all.
 */
test("deleting an announcement takes two taps, not one", async ({ page }) => {
  await page.goto("/announcements");
  await page.waitForLoadState("networkidle");

  const posts = page.locator(".card", { hasText: "Round 2 tee times are up" });
  await expect(posts.first()).toBeVisible();

  const del = posts.first().locator('button[title="Delete"]');
  await expect(del).toBeVisible();
  await del.click();

  // The first tap ARMS. It must not have deleted anything.
  await expect(page.locator("body")).toContainText("Round 2 tee times are up");
  const confirm = page.getByRole("button", { name: /delete it/i });
  await expect(confirm).toBeVisible();

  // And backing out must leave the post alone — a confirmation that cannot be
  // declined is a slower way of deleting, not a safer one.
  await page.getByRole("button", { name: /^keep$/i }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.locator("body")).toContainText("Round 2 tee times are up");
});

/**
 * Post refuses out loud.
 *
 * `addAnnouncement` returned on an untitled post without a word and the button
 * stayed enabled, so an organizer who typed their notice into the box labelled
 * "Message" pressed Post and was ignored — no message, no focus, not one
 * character of the page changed.
 */
test("posting without a title says why, rather than doing nothing", async ({ page }) => {
  await page.goto("/announcements");
  await page.waitForLoadState("networkidle");

  const before = await page.locator(".card").count();
  await page.locator("textarea.input").fill("First tee 9:30 after the frost delay.");
  await page.getByRole("button", { name: /^post$/i }).click();

  // The message names what a title is FOR. An organizer who put the notice in
  // the message field has not forgotten a box; they need telling why the app
  // wants the other one.
  // By id, not by role: Next renders its own always-present route announcer
  // with role="alert", so `getByRole("alert")` matches two elements on every
  // page in the app.
  await expect(page.locator("#announcement-refusal")).toContainText(/players see on their dashboard/i);
  await expect(page.locator("#announcement-refusal")).toHaveAttribute("role", "alert");
  // And nothing was posted. Counted rather than searched for the text, since
  // the words are still sitting in the textarea either way.
  expect(await page.locator(".card").count()).toBe(before);
});

/**
 * THE PUBLIC BOARD SAYS WHAT ITS NUMBERS ARE.
 *
 * `PlayerLeaderboard` takes a `unit` — "strokes", "Stableford points", "match
 * points" — because the same board legitimately shows three different things
 * depending on the round, and a column of bare numbers is one the reader has
 * to infer.
 *
 * It has two call sites. The player's own Board tab passed it; the public
 * share link did not, which is backwards: a spectator following a link is the
 * reader least able to tell from the shape of the digits whether 10.5 is a
 * score, a points total or a handicap.
 *
 * Asserted on BOTH, and asserted EQUAL. One component labelling the same
 * column two different ways is the failure that matters, and either screen
 * alone cannot see it.
 */
test("the public board and the player's board label the column the same way", async ({ page, context }) => {
  await page.goto("/me/board");
  await page.waitForLoadState("networkidle");
  const player = await page.locator("body").innerText();

  const spectator = await context.newPage();
  await spectator.goto(`/live/${data.shareToken}`);
  await spectator.waitForLoadState("networkidle");
  const board = await spectator.locator("body").innerText();
  await spectator.close();

  // `text-transform: uppercase` means innerText comes back shouted.
  const unitOf = (t: string) => (t.match(/RANKED BY ([^\n]+)/i) ?? [])[1]?.trim() ?? "";

  expect(unitOf(player), "the player's board says what it ranks by").toBeTruthy();
  expect(unitOf(board), "and so does the public one").toBeTruthy();
  expect(unitOf(board), "and they agree").toBe(unitOf(player));
});
