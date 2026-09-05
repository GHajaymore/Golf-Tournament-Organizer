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

  // Who I am out with, from the drawn tee sheet.
  await expect(page.getByText("08:10")).toBeVisible();
  await expect(page.getByText(/With .*Marcus Webb/)).toBeVisible();

  // What my card still needs. The fixture leaves nine holes in.
  await expect(page.getByText(`${data.partialHolesFilled} of 18 holes in`)).toBeVisible();
});

test("My card opens on the holes already returned", async ({ page }) => {
  // The regression: it opened blank, and Save would then have erased the
  // nine holes this player had entered at the turn.
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");

  const scored = page.locator('[aria-label*=", complete"]');
  await expect(scored).toHaveCount(data.partialHolesFilled);
  await expect(page.getByText(`${data.partialHolesFilled} of 18 holes in`)).toBeVisible();

  // And it will not let a half-finished card be certified.
  await expect(page.getByRole("button", { name: /Certify/ })).toBeDisabled();
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
  const availability = page.locator(".card").filter({ hasText: "Your availability" });
  await expect(availability).toBeVisible();
  await availability.getByText("List", { exact: false }).click();

  const card = availability;

  // Grouped: the imminent round is lifted out of the list.
  await expect(card.getByText("Next round")).toBeVisible();
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
  const card = page.locator(".card").filter({ hasText: "Your availability" });
  await expect(card).toBeVisible();
  await card.getByText("List", { exact: false }).click();
  const next = await card.getByText("Next round").boundingBox();
  const future = await card.getByText(/Future rounds/).boundingBox();
  expect(next, "no Next round heading").not.toBeNull();
  expect(future, "no Future rounds heading").not.toBeNull();
  expect(next!.y).toBeLessThan(future!.y);
});

test("In / Out is big enough to hit with a thumb", async ({ page }, testInfo) => {
  // The control a league player taps most, and the one segmented control that
  // never got sized for touch: it shipped at 34px while every button around it
  // was 44. Branching on the reported pointer, not the project name — the
  // 320px profile is a phone too.
  await page.goto("/me");
  await page.waitForLoadState("networkidle");

  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const opt = page.locator(".seg-opt").first();
  await expect(opt).toBeVisible();
  const box = await opt.boundingBox();
  expect(box, "no In/Out control found").not.toBeNull();

  if (coarse) {
    expect(box!.height, `In/Out was ${box!.height}px on a touch screen`).toBeGreaterThanOrEqual(44);
  } else {
    // Desktop keeps its compact control — the phone fix must not coarsen it.
    expect(box!.height, `In/Out grew to ${box!.height}px on desktop`).toBeLessThan(44);
  }
  expect(testInfo.project.name).toBeTruthy();
});

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
  await expect(page.getByText("08:10")).toBeVisible();
});
