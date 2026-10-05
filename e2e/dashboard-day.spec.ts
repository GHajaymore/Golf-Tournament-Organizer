import { test, expect } from "@playwright/test";
import { join } from "node:path";

/**
 * THE DASHBOARD ON TOURNAMENT DAY — Ajay, 2026-10-05: "I just want a clean
 * user experience". Read at 393px before the change: the whole tee sheet above
 * the heading, the tournament's name and dates twice, seven shortcut tiles one
 * per row, and what needed the organizer in three different places.
 *
 * The shared fixture holds exactly the day this is about: Round 1's sheet
 * published (Group 1 at 08:10, the whole field), one card certified and
 * waiting for the committee, one card disputed.
 */

test.describe("the organizer's dashboard", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

  test("puts what needs them first, each with the button that does it", async ({ page }) => {
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle");

    const needs = page.getByRole("region", { name: "Needs you now" });
    await expect(needs).toBeVisible();
    await expect(needs).toContainText("1 disputed result to settle");
    await expect(needs).toContainText("1 card to approve");
    await expect(needs.getByRole("link", { name: /Settle it/ })).toHaveAttribute("href", "/entry");
    await expect(needs.getByRole("link", { name: /^Review/ })).toHaveAttribute("href", "/entry");

    // First thing under the heading: above the leaderboard and the shortcuts.
    const y = async (l: ReturnType<typeof page.locator>) => (await l.boundingBox())!.y;
    // In `main`: "Live leaderboard" is also a menu entry.
    const main = page.locator("main");
    expect(await y(needs)).toBeLessThan(await y(main.getByText("Quick actions", { exact: true })));
    expect(await y(needs)).toBeLessThan(await y(main.getByText("Live leaderboard", { exact: true })));
    // Said once: the "Awaiting review" tile that repeated "1 card" is gone.
    await expect(main.getByText("Awaiting review", { exact: true })).toHaveCount(0);
    // And the heading comes first, the tee sheet's line after the to-do list.
    expect(await y(main.getByRole("heading", { level: 1 }))).toBeLessThan(await y(needs));
    expect(await y(needs)).toBeLessThan(await y(main.getByText(/^Round 1 tee sheet ·/)));
  });

  test("shows the tee sheet in one line, not every group and name", async ({ page }) => {
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle");

    const main = page.locator("main");
    await expect(main.getByText("Round 1 tee sheet · 1 group · first group 08:10")).toBeVisible();
    await expect(main.getByRole("link", { name: /See the tee sheet/ })).toHaveAttribute("href", "/foursomes");
    // The control: the full sheet card — "Tee sheet — Round 1" with its names —
    // is not drawn for the organizer.
    await expect(main.getByText("Tee sheet — Round 1", { exact: true })).toHaveCount(0);
  });

  test("names the tournament once, in the bar above, and keeps its one heading", async ({ page }) => {
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Tournament dashboard");
    await expect(main.locator(".page-kicker")).toHaveCount(0);
  });

  test("lays the shortcuts side by side, on a phone too", async ({ page }) => {
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle");
    const tiles = page.locator("main").getByText("Quick actions", { exact: true }).locator("..").getByRole("link");
    expect(await tiles.count()).toBeGreaterThan(2);
    const [a, b] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox()];
    expect(Math.abs(a!.y - b!.y), "the first two shortcuts are not on one row").toBeLessThan(2);
  });
});

test.describe("a member's dashboard", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

  test("still shows them the whole sheet, with their own group first", async ({ page }) => {
    // The organizer's one-line sheet must not take the member's answer away:
    // "when do I go, and with whom" is the reason they open this screen.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle");
    const main = page.locator("main");
    await expect(main.getByText("Tee sheet — Round 1", { exact: true })).toBeVisible();
    await expect(main).toContainText("You're in Group 1 — hole 1 at 08:10.");
    await expect(main).toContainText("Marcus Webb");
    // And none of the organizer's to-do list.
    await expect(page.getByRole("region", { name: "Needs you now" })).toHaveCount(0);
  });
});
