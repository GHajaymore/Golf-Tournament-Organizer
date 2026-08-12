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

  const card = page.locator(".card").filter({ hasText: "Your availability" });
  await expect(card).toBeVisible();

  // Grouped: the imminent round is lifted out of the list.
  await expect(card.getByText("Next round")).toBeVisible();
  await expect(card.getByText(/Future rounds/)).toBeVisible();

  // Dated. The fixture plays its next round three days out, so the card must
  // say so in words as well as showing the date.
  await expect(card.getByText("in 3 days")).toBeVisible();

  // Played rounds are kept but collapsed, not deleted and not in the way.
  await expect(card.getByText(/Earlier rounds \(1\)/)).toBeVisible();
});

test("the next round comes before the future ones on screen", async ({ page }) => {
  // Not merely first in the data — first where the eye lands. A flat list is
  // what this replaced.
  await page.goto("/me");
  await page.waitForLoadState("networkidle");

  const card = page.locator(".card").filter({ hasText: "Your availability" });
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
