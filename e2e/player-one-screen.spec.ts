import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * TODAY AND MONEY ARE ONE SCREEN, THEN MORE (Ajay, 2026-10-06).
 *
 * Measured on the rendered page, not argued from source. What is pinned is
 * what the design promises and what was measured to hold:
 *
 *   - on the SMALLEST common phone (375x667) a player in the middle of a round
 *     sees their card and its "Finish my card" button whole on the first
 *     screen, above the tab bar — the screen's one job on the course;
 *   - what a player only sometimes wants is folded behind ONE extender that
 *     names what is in it, and is not on the screen until it is opened;
 *   - Money leads with the one number and the handovers that are yours.
 *
 * It does NOT pin "everything above More fits a 375x667 screen": measured, a
 * mid-round player with a pinned notice is about 200px over on that phone —
 * the player shell, the card and a position line do not fit 452px. On a
 * 393x852 phone the same screen is 19px over, with the card, its button and
 * the position line all in view.
 */

function asStored(page: Page, file: string) {
  const s = JSON.parse(readFileSync(join(process.cwd(), ".e2e", file), "utf8"));
  return page.context().clearCookies().then(() => page.context().addCookies(s.cookies));
}

async function open(page: Page, path: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`${path}?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

/** Where the fixed tab bar starts — the bottom of the first screen. */
function tabBarTop(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Sections"]');
    return nav ? nav.getBoundingClientRect().top : innerHeight;
  });
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "sizes are set per test; one project is enough");
});

test("mid-round, the card and its button are whole on the smallest phone's first screen", async ({ page }) => {
  await asStored(page, "player.json");
  await open(page, "/me", 375, 667);
  const finish = page.getByRole("link", { name: /Finish my card/ });
  await expect(finish).toBeVisible();
  const box = (await finish.boundingBox())!;
  expect(box.y + box.height, "Finish my card runs under the tab bar").toBeLessThanOrEqual(await tabBarTop(page));
});

test("what a player only sometimes wants is behind one extender that names it", async ({ page }) => {
  await asStored(page, "player.json");
  await open(page, "/me", 393, 852);
  const more = page.locator("main summary", { hasText: /^More:/ });
  await expect(more).toHaveCount(1);
  // Named, in the order it holds them — this player is mid-round, so their
  // group and the season's other rounds have moved here too.
  await expect(more).toHaveText(/More: Your group · Leaders · Your rounds/);
  // Folded: the leaders table is not on the screen until More is opened.
  const leaders = page.getByText(/^LEADERS$/i);
  await expect(leaders).toBeHidden();
  await more.click();
  await expect(leaders).toBeVisible();
});

test("Money leads with the one number and your own handovers", async ({ page }) => {
  await asStored(page, "player.json");
  await open(page, "/me/money", 393, 852);
  const top = await tabBarTop(page);
  const owed = page.getByText(/^You're (owed|square)$|^You owe$/);
  await expect(owed).toBeVisible();
  const settle = page.getByRole("button", { name: "Mark settled" }).first();
  await expect(settle).toBeVisible();
  const box = (await settle.boundingBox())!;
  expect(box.y + box.height, "your handover is not on the first screen").toBeLessThanOrEqual(top);
  // The itemised money, folded and named.
  const more = page.locator("main summary", { hasText: /^More:/ });
  await expect(more).toHaveText(/Expenses \(\d+\)/);
  await expect(page.getByText(/^Already settled$/)).toBeHidden();
});
