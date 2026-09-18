import { test, expect } from "@playwright/test";
import { join } from "node:path";

test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

/**
 * A WEEK OF THE AVAILABILITY CALENDAR IS SEVEN ACROSS.
 *
 * It was not. Measured on a 375px phone on 2026-09-18: every week row computed
 * to a single 311px track, so each month drew as forty-two stacked bars —
 * 1,859px per month, and the availability card alone was 4,121px of a 4,932px
 * page. The player's own screen was 6.3 viewports tall and 83% of it was a
 * calendar that was not a calendar.
 *
 * Nothing caught it. `layout.spec` asserts no page scrolls SIDEWAYS, which a
 * single column never does; `touch.spec` asserts targets are big enough, and
 * these were enormous. A screen can be unusable in the other direction and
 * every geometry test still passes, which is the gap this closes.
 *
 * WHY THE ASSERTION IS ON POSITIONS RATHER THAN CSS. `grid-template-columns`
 * was correct on the element the whole time — in the style attribute and in
 * the CSSOM — and did not take effect. Asserting the declaration would have
 * passed throughout the bug. Where the squares actually SIT is the thing a
 * player cares about and the only thing that was ever wrong.
 */
test.describe("the availability calendar", () => {
  for (const [name, width, height] of [
    ["small-phone", 320, 720],
    ["phone", 393, 852],
    ["desktop", 1280, 900],
  ] as const) {
    test(`draws a week seven across at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/me");
      await page.waitForLoadState("networkidle");
      expect(new URL(page.url()).pathname, "not signed in as a player").toBe("/me");

      const rows = page.locator('[role="row"]');
      const count = await rows.count();
      // The control: a spec that finds no rows asserts nothing about them, and
      // would go green on a screen that had lost the calendar entirely.
      expect(count, "no calendar rows on /me — is the fixture's league dated?").toBeGreaterThan(0);

      const first = rows.first();
      const cells = first.locator('[role="gridcell"]');
      expect(await cells.count(), "a week is seven days").toBe(7);

      const lefts: number[] = [];
      for (let i = 0; i < 7; i += 1) {
        const box = await cells.nth(i).boundingBox();
        expect(box, `day ${i} has no box`).not.toBeNull();
        lefts.push(Math.round(box!.x));
      }

      // Seven squares on seven different x positions is what "a week" means.
      // When this broke they shared one, and the row grew to 332px.
      expect(new Set(lefts).size, `the week stacked: ${JSON.stringify(lefts)}`).toBe(7);
      expect(lefts).toEqual([...lefts].sort((a, b) => a - b));

      const rowBox = await first.boundingBox();
      expect(rowBox!.height, "a week row is one square tall, not seven").toBeLessThan(80);
    });
  }

  test("does not make the player's own screen a scroll marathon", async ({ page }) => {
    /**
     * The number that made it obvious, kept as a ceiling rather than a target.
     *
     * 6.3 viewports before, 2.4 after, on the same fixture. Five is generous
     * enough that ordinary content growth is not a failure, and tight enough
     * that a month drawn as forty-two bars is.
     */
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/me");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).toBe("/me");

    const screens = await page.evaluate(
      () => document.documentElement.scrollHeight / window.innerHeight,
    );
    expect(screens, `/me is ${screens.toFixed(1)} viewports tall`).toBeLessThan(5);
  });
});
