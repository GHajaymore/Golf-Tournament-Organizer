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

/**
 * The field, exactly as `fixture.mjs` seeds it.
 *
 * One name is long and carries an accent and a curly apostrophe on purpose —
 * a player's name lands in the tightest column this app has, and a field of
 * short ASCII names was letting every width assertion pass without ever being
 * asked a hard question. See the note beside `names` in the fixture.
 */
const FIELD = ["Aj Moore", "Marcus Webb", "Síle Ní Bhraonáin-O’Dwyer", "Sang-woo Kim"];

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

/**
 * TOURNAMENT DETAILS IS A VERY LONG SCREEN, AND ITS SAVE IS AT THE BOTTOM.
 *
 * Measured on the demo data: the Players & scoring block is ~2,450px and its
 * first control — "Who can see the leaderboard" — sits about 1,900px above
 * the only button that keeps a change. Two and a third phone screens, with
 * nothing on the way down saying a Save exists.
 *
 * One button still: this screen saves everything together on purpose, and
 * per-group saves are how a club changes something, presses Save, and finds
 * half of it kept. So the button follows rather than multiplies.
 *
 * PLAYWRIGHT RATHER THAN A RENDER TEST, because the behaviour only exists
 * once something is dirty and `form` starts equal to `settings` — a static
 * render can prove the clean state and nothing else. This is the sixth of the
 * gate doing the thing nothing above it can.
 */
test("the settings save follows you once there is something to save", async ({ page }) => {
  await page.goto("/event");
  await page.waitForLoadState("networkidle");

  /* Scoped to the section: the setup form above has its own Save, and an
     unscoped locator resolves to both. Two save buttons on one screen is a
     finding in itself — they belong to different forms and say almost the
     same word — but they are genuinely separate forms, so the fix here is the
     scope rather than the button. */
  const scoring = page.locator("#scoring");
  const save = scoring.getByRole("button", { name: /save settings|^saved$/i });
  await expect(save).toBeVisible();

  // UNTOUCHED: no floating chrome on a screen nobody has changed.
  await expect(save.locator("xpath=..")).toHaveCSS("position", "static");
  await expect(page.getByText("Unsaved changes to players & scoring")).toHaveCount(0);

  // Change the first thing in the block, which is the furthest from the save.
  const blind = scoring.getByRole("radio", { name: /organizers only/i }).first();
  await blind.check();

  await expect(page.getByText("Unsaved changes to players & scoring")).toBeVisible();
  await expect(save.locator("xpath=..")).toHaveCSS("position", "sticky");

  // And it is REACHABLE from the top of its own section, which is the whole
  // point — scrolled up 1,900px, the button is still on screen.
  await page.locator("#scoring").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById("scoring")?.scrollIntoView({ block: "start" }));
  const box = await save.boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect(box, "the save button has no box").not.toBeNull();
  expect(box!.y, "the save scrolled off the top").toBeGreaterThan(0);
  expect(box!.y, "the save is below the fold").toBeLessThan(height);

  /**
   * NOTHING IS SAVED. This spec shares one fixture with every other test in
   * the file, and leaving this tournament blind would break the public-board
   * specs above it. Reloading discards the draft, which is also the assertion
   * that the draft really was a draft.
   */
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Unsaved changes to players & scoring")).toHaveCount(0);
});

/**
 * TWO FORMS, TWO SAVES, AND ONLY THE ONE YOU TOUCHED FOLLOWS YOU.
 *
 * /event stacks the setup form (1,898px, with 1,125px from its first field to
 * its Save) above Players & scoring (2,455px, 1,897px). Both use the same
 * `StickySave` now, which is the point: fixing one of two Saves on a screen
 * that has two would have been a worse inconsistency than the distance.
 *
 * Their idle labels are both "Saved", so the note is what tells them apart
 * once one has floated away from the heading that named it. This asserts they
 * stay independent — dirtying one must not pin the other over controls it
 * does not save.
 */
test("each form's save follows only its own form", async ({ page }) => {
  await page.goto("/event");
  await page.waitForLoadState("networkidle");

  const setupSave = page.locator("#details").getByRole("button", { name: /save event|^saved$/i });
  const settingsSave = page
    .locator("#scoring")
    .getByRole("button", { name: /save settings|^saved$/i });
  await expect(setupSave.locator("xpath=..")).toHaveCSS("position", "static");
  await expect(settingsSave.locator("xpath=..")).toHaveCSS("position", "static");

  /* The first text field in the upper form, positionally. `getByLabel` does
     not reach it: the label wraps a FieldInfo button as well as the words, so
     the accessible name is not the label text. Positional is honest here —
     this test is about the FIRST field being far from the Save. */
  /* `input` rather than `input[type="text"]`: these fields set no type
     attribute, so the attribute selector matches nothing even though the DOM
     property reads "text". */
  const name = page.locator("#details").locator("input").first();
  await name.fill("zz-renamed for a sticky-save test");

  await expect(page.getByText("Unsaved changes to the tournament")).toBeVisible();
  await expect(setupSave.locator("xpath=..")).toHaveCSS("position", "sticky");
  // And the other form is untouched, so its save has not pinned itself over
  // controls it does not save.
  await expect(settingsSave.locator("xpath=..")).toHaveCSS("position", "static");
  await expect(page.getByText("Unsaved changes to players & scoring")).toHaveCount(0);

  // Nothing is saved: this fixture is shared with every test in the file.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Unsaved changes to the tournament")).toHaveCount(0);
});

/**
 * "SWITCH EVENT" LANDS ON THE LIST.
 *
 * `EventContextBar` is on every authenticated screen, so this is the most
 * pressed link in the console — and it pointed at `/event`, which is 6,330px
 * of configuring ONE tournament with the switcher as 7% of it. Where that 7%
 * sits depends on the lifecycle: it leads once a tournament is launched and
 * trails while the setup rail is still talking. So the link landed somewhere
 * different depending on state, and never on what it asked for.
 *
 * A fragment (`/event#tournaments`) fixed the landing and left the screen
 * still doing two jobs. The list has its own route now, so what this checks
 * is simpler and stronger: the link goes to `/tournaments`, and the list is
 * the FIRST thing on it rather than something to scroll to.
 *
 * That last part is why this is an e2e test and not a unit one. "Near the top
 * of the page" is a measurement, and the whole defect being fixed was a
 * reader arriving somewhere and not finding what they clicked for.
 */
test("switch event lands on the tournament list, not the top of the form", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const swap = page.getByRole("link", { name: /switch event/i });
  await expect(swap).toHaveAttribute("href", "/tournaments");
  await swap.click();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/tournaments$/);

  /* By its heading rather than by an id. It had one — the anchor a fragment
     link needed — and an id kept only so a test can find it is an id that
     drifts. The words are what a reader is looking for. */
  const list = page.locator(".card", { hasText: "Your tournaments" }).first();
  await expect(list).toBeVisible();

  const box = await list.boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect(box, "the tournament list has no box").not.toBeNull();
  expect(box!.y, "the list is scrolled off the top").toBeGreaterThanOrEqual(0);
  expect(box!.y, "the list is below the fold — the link did not land").toBeLessThan(height);
});
