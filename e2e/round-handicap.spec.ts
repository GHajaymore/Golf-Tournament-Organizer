import { createHmac } from "node:crypto";
import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * WHAT ONE PLAYER PLAYS OFF IN ONE ROUND, AND THEIR INDEX — SET BY HAND.
 *
 * The round's own handicap editor (Rounds → a round → Customize → "Change a
 * player's handicap") had never been pressed by any spec: the walk opens the
 * screen and the control crawl has no box of its own to fill. Reading it on
 * 2026-10-13 found that it read its box as ARITHMETIC — and to arithmetic "+2"
 * is two. The screen says "plays off +2" for a plus-two player; an organizer who
 * typed that figure back into the box beside it saved a player RECEIVING two
 * strokes, four out, in that round only. The box also opened on "-2".
 *
 * Since 2026-10-16 "Change" asks WHAT is being changed (Ajay asked for a
 * player's adjusted handicap to reach the member record; the review panel
 * shaped it — docs/handicap-push-brief-2026-10-16.md): their strokes in this
 * round only, or their handicap INDEX, which moves every round not yet played
 * and, when ticked, the member record.
 *
 * So this is the secretary, on a week of the seeded league nobody has played
 * yet, doing what an organizer does there:
 *
 *   set       a plus handicap, typed with its plus — and the round then says
 *             "+2", which it can only say of a player who gives strokes
 *   reopen    the box opens on the figure the sentence shows
 *   refuse    an index (12.4), an empty box and a figure past the range, each
 *             in words, none of them saved
 *   scratch   the word the screen prints is a figure it reads
 *   undo      the round's figure cleared, and the round says everybody is on
 *             the roster again
 *   index     a member's index typed as a German club writes it ("7,3"), the
 *             sentence read before Save, and Members showing it after
 *
 * One project: nothing here is about width.
 */

const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  club = await seed();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  await teardown();
});

/** The Rounds screen, with the first round nobody has played opened to its list of players. */
async function openEditor(page: Page) {
  await page.goto(`/stages?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  // A round is a row until it is opened. The weeks still to come carry no tag
  // since 2026-10-16 (a tag was "Upcoming" on every one); played and active ones do.
  const round = page
    .getByRole("button", { name: /^Round \d+ · / })
    .filter({ hasNotText: /Played|In play/ })
    .first();
  await expect(round, "the seeded league has no round still to be played").toBeVisible({ timeout: 20_000 });
  if ((await round.getAttribute("aria-expanded")) !== "true") await round.click();
  // The list is under Customize, which starts closed (2026-10-16).
  const customize = page.getByRole("button", { name: /^Customize this round/ }).filter({ visible: true }).first();
  if ((await customize.getAttribute("aria-expanded")) !== "true") await customize.click();
  const opener = page.getByRole("button", { name: "Change a player's handicap" }).filter({ visible: true }).first();
  await expect(opener, "an unplayed round does not offer to change a handicap").toBeVisible({ timeout: 20_000 });
  await opener.click();
}

async function signInToLeague(page: Page, context: import("@playwright/test").BrowserContext, baseURL: string) {
  const league = club.events.find((e) => e.slug === "league");
  expect(league, "the seeded club has no league").toBeTruthy();
  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL },
    { name: "ng_active_event", value: sign(league!.id), url: baseURL },
  ]);
}

test("the secretary sets one player's strokes for one round, and a plus handicap is typed with its plus", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project: nothing here is about width");
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await signInToLeague(page, context, baseURL!);

  await openEditor(page);
  // Whoever is first on the list: the test is about the box, not the person.
  const firstChange = page.getByRole("button", { name: /^Change .+'s handicap$/ }).first();
  await expect(firstChange).toBeVisible();
  const name = ((await firstChange.getAttribute("aria-label")) ?? "").replace(/^Change /, "").replace(/'s handicap$/, "");
  expect(name.length, "the row has no name on it").toBeGreaterThan(1);
  const line = () => page.locator("div").filter({ has: page.locator("span", { hasText: name }) }).filter({ hasText: "plays off" }).last();
  /**
   * THE ROW SAYS TWO FIGURES ON A ROUND WITH AN ALLOWANCE (2026-10-13), and the
   * box edits the first of them. The league plays Stableford at 95%, so the row
   * reads "course handicap 9 (9.39 before rounding) · plays off 9 at 95%": what
   * the player is told, and what their card is scored off. The allowance is
   * taken of the figure before rounding (Rule 6.2a), so the two can differ.
   */
  await expect(line(), "the row does not say what the allowance is taken of").toContainText(/course handicap \S+.* · plays off \S+ at 95%/);
  const roster = ((await line().innerText()).match(/course handicap\s+(\S+)/) ?? [])[1];
  expect(roster, "the row does not say the player's course handicap").toBeTruthy();
  const change = () => page.getByRole("button", { name: `Change ${name}'s handicap`, exact: true });
  const box = page.getByLabel(/^Strokes in /);
  const save = page.getByRole("button", { name: /^Save for / });

  await test.step("Change asks what is being changed, and starts on this round only", async () => {
    await change().click();
    await expect(page.getByRole("radiogroup", { name: `What are you changing for ${name}?` })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Their strokes in .+ only/ })).toBeChecked();
  });

  await test.step("a plus handicap, typed with its plus, is a player who GIVES strokes", async () => {
    await expect(box, "the box opens on the figure the sentence shows").toHaveValue(roster!);
    await box.fill("+2");
    await expect(page.getByText(`${name} plays off +2 in `)).toBeVisible();
    await save.click();
    // The confirmation, where the press was.
    await expect(page.getByRole("status").filter({ hasText: `Done. ${name} plays off +2 in ` })).toBeVisible({ timeout: 20_000 });
    // "+2" is what this screen prints for minus two, and for nothing else: plain two reads "2".
    // And a committee's figure is a whole number, so 95% is taken of it as given: plus 1.9, which is plus 2.
    await expect(line()).toContainText(`course handicap +2 · plays off +2 at 95% — set for this round, in place of ${roster}`, { timeout: 20_000 });
    await openEditor(page);
    await expect(line(), "kept after a reload").toContainText("course handicap +2 · plays off +2 at 95% — set for this round");
  });

  await test.step("opened again, the box says what the sentence says", async () => {
    await change().click();
    await expect(box).toHaveValue("+2");
  });

  await test.step("an index, an empty box and a figure past the range are each refused in words", async () => {
    // Save waits for a figure it can say a sentence about, and the box says why as it is typed.
    await box.fill("12.4");
    await expect(page.getByText("A round's handicap is whole strokes — 12, not 12.4. The index stays on the roster.")).toBeVisible();
    await expect(save).toBeDisabled();
    await box.fill("");
    await expect(page.getByText("Enter the strokes as a whole number, like 12 — or +2 for a plus handicap.")).toBeVisible();
    await expect(save).toBeDisabled();
    await box.fill("77");
    await expect(page.getByText("A handicap runs from +10 to 54.")).toBeVisible();
    await expect(save).toBeDisabled();
    await openEditor(page);
    await expect(line(), "none of the three saved anything").toContainText("course handicap +2 · plays off +2 at 95% — set for this round");
  });

  await test.step("the word the screen prints for nought is a figure it reads", async () => {
    await change().click();
    await box.fill("scratch");
    await save.click();
    await expect(line()).toContainText("course handicap scratch · plays off scratch at 95% — set for this round", { timeout: 20_000 });
  });

  await test.step("the round's figure cleared, and the round says everybody is on the roster again", async () => {
    await change().click();
    await page.getByRole("button", { name: "Clear this round’s figure", exact: true }).click();
    await expect(line()).toContainText(`course handicap ${roster}`, { timeout: 20_000 });
    await expect(line()).not.toContainText("set for this round");
    await openEditor(page);
    await expect(line()).not.toContainText("set for this round");
  });

  expect(errors, "a screen threw").toEqual([]);
});

/**
 * THE INDEX, AND MEMBERS (2026-10-16). Ajay: "an option to adjust individual
 * handicap of the player and then another option to push it to member screen
 * to become its new handicap." Typed as a German club writes it — "7,3" — the
 * way the reviewers asked it to be walked, since a reader of "7.3" alone passes
 * on every machine that writes a point.
 */
test("the secretary changes a member's index from the round, and Members shows it", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project: nothing here is about width");
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  await signInToLeague(page, context, baseURL!);
  await openEditor(page);

  // The first player on the list whose member record the club may change.
  const changes = page.getByRole("button", { name: /^Change .+'s handicap$/ });
  const tick = page.getByRole("checkbox", { name: /^Also make it their handicap on Members/ });
  let name = "";
  for (let i = 0; i < Math.min(8, await changes.count()); i += 1) {
    const b = changes.nth(i);
    const who = ((await b.getAttribute("aria-label")) ?? "").replace(/^Change /, "").replace(/'s handicap$/, "");
    await b.click();
    await page.getByRole("radio", { name: /^Their handicap index/ }).check();
    const box = page.getByRole("textbox", { name: "Handicap index", exact: true });
    await expect(box, "the index box never filled in").not.toHaveValue("", { timeout: 20_000 });
    if (await tick.isVisible()) {
      name = who;
      break;
    }
    // Refused, in words: say it is a reason and not a blank.
    await expect(page.getByText(/no member record|association|nine-hole|organizer can change/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  expect(name, "no player in the league could be pushed to Members").not.toBe("");

  const box = page.getByRole("textbox", { name: "Handicap index", exact: true });
  await box.fill("7,3");
  await expect(page.getByText(new RegExp(`^Changes ${name}'s index from \\S+ to 7\\.3 for `))).toBeVisible();
  await expect(page.getByRole("button", { name: "Save index", exact: true })).toBeEnabled();

  await tick.check();
  const saveBoth = page.getByRole("button", { name: "Save index and Members", exact: true });
  // A reason first: Rule 7.1 records an adjustment, so Save waits for one.
  await expect(saveBoth).toBeDisabled();
  await page.getByLabel("Why — kept in the history").fill("Committee adjustment after the summer league");
  await expect(page.getByText(`On Members, 7.3 becomes ${name}'s index for every tournament they enter from now on.`)).toBeVisible();
  await saveBoth.click();
  await expect(page.getByRole("status").filter({ hasText: `Done. ${name}'s index is 7.3` })).toContainText("and on Members", { timeout: 20_000 });

  await test.step("Members shows the new index", async () => {
    await page.goto(`/roster?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const row = page.locator("tr, li, div").filter({ hasText: name }).filter({ hasText: "7.3" }).last();
    await expect(row, "Members does not show 7.3 for the player").toBeVisible({ timeout: 20_000 });
  });

  expect(errors, "a screen threw").toEqual([]);
});
