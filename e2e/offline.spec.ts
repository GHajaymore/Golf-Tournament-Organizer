import { test, expect } from "@playwright/test";
import { join } from "node:path";

test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

/**
 * A hole entered with no signal must not be lost.
 *
 * The scoring screen wrote on a debounce and kept the strokes nowhere but
 * React state. A scorer behind the 12th with no signal, who then locked their
 * phone or let the tab be evicted, LOST the holes they had entered — and the
 * screen went on showing them, so they had no reason to re-enter anything.
 *
 * That is the worst failure this app can have. A wrong number is correctable
 * by anybody who was there; a hole nobody recorded is gone, and the player
 * finds out at the scorer's table.
 *
 * These run with the network genuinely cut at the browser, not with a mocked
 * fetch — because the thing under test is what the DEVICE keeps when a request
 * cannot leave it, and a stubbed failure would not exercise that at all.
 */

test("a hole entered with no signal is kept on the phone", async ({ page, context }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Hole", { exact: true })).toBeVisible();

  await context.setOffline(true);

  const before = await page.locator('[aria-label*=", complete"]').count();
  await page.getByRole("button", { name: /^4Par$|Par$/ }).first().click();
  await expect(page.locator('[aria-label*=", complete"]')).toHaveCount(before + 1);

  // THE ASSERTION THAT MATTERS: the strokes are on the device, not merely in
  // memory. Reading localStorage is the point — a hole that exists only in a
  // React ref dies with the tab.
  const stored = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) =>
      k.startsWith("tourneyhq:pending-card:"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  expect(stored, "the card was not written to the device").not.toBeNull();
  expect(JSON.parse(stored!).some((n: number | null) => n != null)).toBe(true);

  await context.setOffline(false);
});

test("it tells the scorer the truth: kept, not failed", async ({ page, context }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await page.getByRole("button", { name: /^4Par$|Par$/ }).first().click();

  /**
   * The old wording was "Not saved… check your signal and tap a hole again",
   * which is now false in the case that matters most. A scorer told that
   * stands on a tee hunting for a bar of signal instead of playing their shot.
   */
  const status = page.locator('[role="status"]');
  await expect(status).toContainText(/no signal/i, { timeout: 10_000 });
  await expect(status).toContainText(/saved on this phone/i);
  await expect(status).not.toContainText(/not saved/i);

  await context.setOffline(false);
});

test("and sends it by itself when the signal comes back", async ({ page, context }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await page.getByRole("button", { name: /^4Par$|Par$/ }).first().click();
  await expect(page.locator('[role="status"]')).toContainText(/no signal/i, { timeout: 10_000 });

  // Coming back into coverage must not need a tap. A scorer who has walked to
  // the next tee is not looking at the phone, and a queue that waits for
  // attention is a queue that never drains.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.locator('[role="status"]')).toContainText(/saved/i, { timeout: 20_000 });

  // And the device copy is released only once the server has it — until then
  // there would be a moment where neither side holds the scorer's holes.
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          Object.keys(window.localStorage).filter((k) =>
            k.startsWith("tourneyhq:pending-card:"),
          ).length,
        ),
      { timeout: 20_000 },
    )
    .toBe(0);
});
