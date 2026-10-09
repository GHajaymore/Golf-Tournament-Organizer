import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8"));

test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

/**
 * The player shell, which until now had never been opened.
 *
 * It was built, typechecked, unit-tested and committed without a single one
 * of its four screens being displayed — and it shipped carrying a bug that
 * would have written a blank card over a round already played. These are the
 * checks that would have caught it, and they are cheap to keep.
 */

test("a player lands in their own app, not the console", async ({ page }) => {
  await page.goto("/");
  // landingScreenFor sends a player to /me; the console's sidebar must not
  // be what a player sees first.
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.locator("nav[aria-label='Sections']")).toBeVisible();
});

test("Today answers the three questions a player actually has", async ({ page }) => {
  await page.goto("/me");
  await page.waitForLoadState("networkidle");

  // Who I am out with, from the drawn tee sheet. This player is mid-round
  // (thru 9), so since 2026-10-06 their group is under More — a player on the
  // course is standing with them; before the round it leads the screen.
  await openMore(page);
  await expect(page.getByText("08:10")).toBeVisible();
  await expect(page.getByText(/With .*Marcus Webb/)).toBeVisible();

  // What my card still needs. The fixture leaves nine holes in. Read off the
  // panel's headline — the footer that also said "9 of 18 holes in" was the
  // same fact a third time and went on 2026-09-19.
  await expect(page.getByText(`YOUR CARD · THRU ${data.partialHolesFilled}`)).toBeVisible();
});

test("My card opens on the holes already returned", async ({ page }) => {
  // The regression: it opened blank, and Save would then have erased the
  // nine holes this player had entered at the turn.
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");

  const scored = page.locator('[aria-label*=", complete"]');
  await expect(scored).toHaveCount(data.partialHolesFilled);
  await expect(page.getByText(`${data.partialHolesFilled} of 18 holes in`)).toBeVisible();

  // And it will not let a half-finished card be certified: since 2026-10-05
  // the button is not there until the last hole is in.
  await expect(page.getByRole("button", { name: /Certify/ })).toHaveCount(0);
});

test("entering a hole advances and updates the running score", async ({ page }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");

  // Hole 10 is the first unscored one, so the card opens there.
  await expect(page.getByText("Hole", { exact: true })).toBeVisible();
  const before = await page.locator('[aria-label*=", complete"]').count();

  await page.getByRole("button", { name: /^4Par$|Par$/ }).first().click();
  await expect(page.locator('[aria-label*=", complete"]')).toHaveCount(before + 1);
});

/**
 * A DOUBLE-TAP KEEPS THE SCORE (2026-10-09). The pad toggled: tapping the
 * chosen value cleared it, and the card moves on 160ms after a tap — so a
 * double-tap set the hole, cleared it, then advanced past a blank hole with
 * nothing said. Walked on a member's phone: her first two holes, gone.
 */
test("a double-tap on a score keeps it", async ({ page }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");
  const scored = page.locator('[aria-label*=", complete"]');
  const before = await scored.count();

  const hole = await page.getByRole("textbox", { name: /^Strokes on hole \d+$/ }).getAttribute("aria-label");
  const par = page.getByRole("button", { name: /^\d+\s*Par$/ }).first();
  await par.click();
  await par.click();
  try {
    // Past the advance and the save's debounce.
    await page.waitForTimeout(1500);
    await expect(scored, "the second tap cleared the hole the first one set").toHaveCount(before + 1);
  } finally {
    // Put the shared fixture back — the other projects read "thru 9" off it.
    // Cleared the deliberate way: back to that hole, empty "Other".
    const n = hole!.replace(/\D+/g, "");
    await page.getByRole("button", { name: new RegExp(`^Hole ${n},`) }).click();
    await page.getByRole("textbox", { name: `Strokes on hole ${n}` }).fill("");
    await page.waitForTimeout(1500);
    await expect(scored).toHaveCount(before);
  }
});

test("the board a player sees matches the one the share link shows", async ({ page, context }) => {
  // Both render PlayerLeaderboard from the same standings. If these ever
  // differ, meFor and standingRows have drifted apart — which is the failure
  // that ends with two screens disagreeing about who is winning.
  await page.goto("/me/board");
  await page.waitForLoadState("networkidle");
  const inApp = await page.locator("ol li").allInnerTexts();

  const anon = await context.browser()!.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${page.url().split("/me")[0]}/live/${data.shareToken}`);
  await anonPage.waitForLoadState("networkidle");
  const publicBoard = await anonPage.locator("ol li").allInnerTexts();
  await anon.close();

  expect(inApp.length, "the board should list the field").toBeGreaterThan(0);
  expect(inApp).toEqual(publicBoard);
});

test("the rules a player sees lead with this tournament, not the rule book", async ({ page }) => {
  await page.goto("/me/rules");
  await page.waitForLoadState("networkidle");

  const headings = await page.locator("h2").allInnerTexts();
  expect(headings[0], "a player asks what THIS event decided first").toBe("This tournament");

  // Derived from the round's own configuration.
  await expect(page.getByText("95% of course handicap")).toBeVisible();
  // The club's local rules, and the governing rules underneath.
  await expect(page.getByText(/Internal out of bounds/)).toBeVisible();
  expect(headings).toContain("The Rules of Golf");
});

test("a blind tournament hides the board from its players", async ({ page }) => {
  /**
   * A privacy rule, not a layout one, and the reason it is tested here rather
   * than asserted about the sidebar: hiding a link stops nobody from typing
   * the URL. The screen itself has to refuse.
   *
   * The tournament is flipped to staff-only for the length of this test and
   * put back afterwards, so the rest of the suite still sees a published one.
   */
  const setVisibility = async (value: string) => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      await prisma.event.update({ where: { id: data.eventId }, data: { leaderboardVisibility: value } });
    } finally {
      await prisma.$disconnect();
    }
  };

  await setVisibility("staff");
  try {
    await page.goto("/me/board");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/hasn.t published standings/i)).toBeVisible();
    // And no standings leaked underneath the message.
    await expect(page.locator("ol li")).toHaveCount(0);
  } finally {
    await setVisibility("public");
  }
});

test("the score pad is a keypad, not a scrolling list", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "the stacking rule only applies on phones");

  /**
   * globals.css stacks every inline grid inside <main> on phones — an
   * !important attribute selector — because most two-column layouts have no
   * business staying side by side at 375px. The par-relative pad does, and it
   * had not opted in to `keep-grid`, so six picks shipped as six stacked
   * full-width buttons: a scrolling list where a keypad was designed.
   *
   * Every other test passed throughout, because they counted scored holes and
   * checked the certify button. None of them looked at where anything WAS.
   */
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");

  const tops = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /Birdie/.test(b.textContent ?? ""));
    const grid = btn?.parentElement;
    if (!grid) return null;
    return [...grid.children].map((k) => Math.round(k.getBoundingClientRect().top));
  });

  expect(tops, "no score pad found").not.toBeNull();
  // Three picks share the first row; a single-column stack would give six
  // distinct tops.
  const rows = new Set(tops!);
  expect(rows.size, `pad rendered in ${rows.size} rows — expected 2`).toBe(2);
});

test("availability is on the player's own screen, grouped and dated", async ({ page }) => {
  /**
   * The weekly sign-up question used to live only on /dashboard — the console
   * screen players are routed away from by landingScreenFor. It was a feature
   * whose entire audience could not reach it, and no test noticed because
   * every test that touched it was signed in as the organizer.
   */
  await page.goto("/me");
  await page.waitForLoadState("networkidle");

  /**
   * The list view, chosen explicitly.
   *
   * `RoundAvailability` defaults to a CALENDAR whenever the rounds carry real
   * dates, and the grouped headings this test is about — Next round, Future
   * rounds, Earlier rounds — belong to the list. The calendar arrived after
   * these assertions were written, so they had been failing ever since,
   * describing a layout the screen no longer opens on.
   *
   * Driving the toggle rather than weakening the assertions: the grouping is
   * still a real promise of the list view, and it is still worth holding to.
   */
  // Since 2026-10-06 the card is Today's "Are you playing?" — on the screen
  // before the round, under More once it is under way (this player is thru 9).
  // The rest of the season folds under "Your other rounds" — opened, then the
  // list.
  const availability = await openAvailability(page);
  await availability.getByText(/Your other rounds/).click();
  await availability.getByText("List", { exact: false }).click();

  const card = availability;

  // Grouped: the imminent round is lifted out of the list, as the question
  // (or its one-line answer) at the top of the card.
  await expect(card.getByText(/Are you playing\?|You're (not )?playing/).first()).toBeVisible();
  await expect(card.getByText(/Future rounds/)).toBeVisible();

  /**
   * Dated — in words, and NOT the exact number of them.
   *
   * This asserted the literal "in 3 days", because the fixture plays its next
   * round three days out. But that offset is computed when global-setup SEEDS
   * the database, and this assertion runs minutes later — so a run crossing
   * MIDNIGHT between the two renders "in 2 days" and fails.
   *
   * Not a flake: deterministic for a window every night. It turned `main` red
   * on 2026-09-05 at 00:02 on all three viewports while the run twenty minutes
   * earlier was green, and on one PR the phone project passed at 23:59 while
   * the two that ran after midnight failed — same commit, decided by the clock.
   *
   * The app's promise is that an imminent round is dated in relative words.
   * WHICH number appears is the fixture's arithmetic and the clock's, not the
   * app's. `relativeDay` returns "Today", "Tomorrow" or "in N days" inside a
   * fortnight and "" beyond it, so this still fails if the phrase disappears,
   * stops being relative, or falls out of that window.
   *
   * `.first()` because every round inside the fortnight carries one of these
   * tags — the fixture's next two are "in 3 days" and "in 10 days" — and the
   * first is the next round's, whose primacy the very next test asserts.
   */
  await expect(card.getByText(/Today|Tomorrow|in \d+ days/).first()).toBeVisible();

  // Played rounds are kept but collapsed, not deleted and not in the way.
  await expect(card.getByText(/Earlier rounds \(1\)/)).toBeVisible();
});

test("the next round comes before the future ones on screen", async ({ page }) => {
  // Not merely first in the data — first where the eye lands. A flat list is
  // what this replaced.
  await page.goto("/me");
  await page.waitForLoadState("networkidle");

  // Same reason as the test above: the grouped headings live in the list view,
  // and the screen opens on the calendar.
  const card = await openAvailability(page);
  await card.getByText(/Your other rounds/).click();
  await card.getByText("List", { exact: false }).click();
  const next = await card.getByText(/Are you playing\?|You're (not )?playing/).first().boundingBox();
  const future = await card.getByText(/Future rounds/).boundingBox();
  expect(next, "no next-round question").not.toBeNull();
  expect(future, "no Future rounds heading").not.toBeNull();
  expect(next!.y).toBeLessThan(future!.y);
});

test("the answer is big enough to hit with a thumb", async ({ page }) => {
  // The control a league player taps most. It shipped as a 34px segmented
  // control; since 2026-10-06 it is two 48px buttons with a verb on each, on
  // every screen — a button that size is as right on a desktop as on a phone.
  const card = await openAvailability(page);
  const change = card.getByRole("button", { name: "Change" });
  if (await change.count()) await change.click();
  for (const name of [/I.m playing/, /Can't make it/]) {
    const box = await card.getByRole("button", { name }).boundingBox();
    expect(box, `no ${name} button`).not.toBeNull();
    expect(box!.height, `${name} was ${box!.height}px`).toBeGreaterThanOrEqual(44);
  }
});

/**
 * Today's availability card, wherever Today has put it: on the screen before
 * the round, under "More" once the card has holes in.
 */
async function openAvailability(page: import("@playwright/test").Page) {
  await page.goto(`/me?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
  const card = page.getByRole("region", { name: "Your availability" });
  if (!(await card.isVisible())) await page.locator("summary", { hasText: /^More:/ }).click();
  await expect(card).toBeVisible();
  return card;
}

test("a multi-week league opens on the round played, not the last on the calendar", async ({ page }) => {
  /**
   * With no Round Robin stages the current round used to be "the last playing
   * round", which for a league is the final week of the season. The fixture
   * plays Round 1 a week ago and has three weeks still to come, so under the
   * old rule this screen opened on Round 4: no tee sheet, no card, nothing.
   *
   * Every card test above passes only because this is right — but none of them
   * says so, and a rule nobody states is a rule that gets changed back.
   */
  await page.goto("/me");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Round 1", { exact: true }).first()).toBeVisible();
  // Round 1's group, under More mid-round (see the first test in this file).
  await openMore(page);
  await expect(page.getByText("08:10")).toBeVisible();
});

/** Open Today's extender — the one labelled "More: …". */
async function openMore(page: import("@playwright/test").Page) {
  const more = page.locator("main summary", { hasText: /^More:/ });
  await expect(more).toHaveCount(1);
  await more.click();
}
