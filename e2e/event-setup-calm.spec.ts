import { test, expect } from "@playwright/test";
import { join } from "node:path";

/**
 * EVENT SETUP, SAID SHORT — step B of the organizer cleanup (Ajay, 2026-10-05).
 *
 * The shared fixture's tournament is launched and has four rounds, which is
 * the screen an organizer comes back to mid-season: setup finished, a setting
 * to check or change.
 */
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

test("a launched tournament's setup reads short, and every explanation is one tap away", async ({ page }) => {
  await page.goto(`/event?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
  const main = page.locator("main");

  // The checklist is one line once launched, its rows a tap away.
  const checklist = main.getByText(/^Setup checklist · \d+ of \d+ done$/);
  await expect(checklist).toBeVisible();
  await checklist.click();
  await expect(main.getByText("Tournament details", { exact: true }).first()).toBeVisible();

  // An option is its name; its explanation opens from its own ⓘ — and lands
  // inside the screen, on a phone as on a desktop.
  await expect(main.getByText(/A blind event/)).toHaveCount(0);
  const info = main.getByRole("button", { name: "More about Organizers only" });
  await info.scrollIntoViewIfNeeded();
  await info.click();
  const panel = main.getByRole("note").filter({ hasText: /A blind event/ });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x, "the explanation starts off the left edge").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "the explanation runs off the right edge").toBeLessThanOrEqual(width + 1);

  // Four rounds: there is a next week, so weekly sign-up is still asked.
  await expect(main.getByText("Weekly sign-up", { exact: true })).toBeVisible();
});
