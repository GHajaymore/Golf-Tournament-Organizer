import { test, expect } from "@playwright/test";
import { join } from "node:path";

test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

/**
 * WHAT A PLAYER SEES STANDING ON THE TEE.
 *
 * `/me` is the screen the field actually opens, and the thing they open it to
 * do is put their card in. On 2026-09-18 at 375x812 the button that starts
 * that — "Finish my card" — sat at y=765 behind a navigation bar fixed from
 * y=747. It was ON the first screen and underneath the tab bar, so the only
 * way to reach it was to scroll a screen that looked finished.
 *
 * `elementFromPoint` is the assertion rather than a bounding box, because a
 * box says where something IS and this bug was about what is on TOP of it. A
 * covered button has a perfectly good box.
 *
 * `touch.spec` could not see this: every target was well over the minimum, and
 * it never asks whether anything is in front of them.
 */
test.describe("the player's own round", () => {
  /**
   * 375x812 IS IN THIS LIST BECAUSE IT IS WHERE THE BUG WAS.
   *
   * The first version ran 393x852 and 320x720 and went green against the
   * broken screen — at 393 the extra forty pixels of height cleared the bar,
   * and at 320 the button fell below the fold, which this deliberately does
   * not count. Neither viewport could express the fault, so the mutation that
   * should have turned them red did not.
   *
   * A test that cannot catch the bug it was written for is decoration, so the
   * size that was actually measured is the first one here.
   */
  for (const [name, width, height] of [
    ["iphone", 375, 812],
    ["phone", 393, 852],
    ["small-phone", 320, 720],
  ] as const) {
    test(`does not hide the card's action behind the tab bar at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/me");
      await page.waitForLoadState("networkidle");
      expect(new URL(page.url()).pathname, "not signed in as a player").toBe("/me");

      const action = page.getByRole("link", { name: /finish my card/i }).first();
      await expect(action, "the card's primary action is missing").toHaveCount(1);

      const covered = await action.evaluate((el) => {
        const r = el.getBoundingClientRect();
        // Below the fold is not this bug — a player scrolls. The fault is a
        // control that is ON screen with something painted over it.
        const onScreen = r.top < window.innerHeight && r.bottom > 0;
        if (!onScreen) return { onScreen, hidden: false, by: null as string | null };
        const x = Math.round(r.x + r.width / 2);
        const y = Math.round(Math.min(r.y + r.height / 2, window.innerHeight - 1));
        const top = document.elementFromPoint(x, y);
        const hidden = !(top === el || el.contains(top) || (top && top.contains(el)));
        return { onScreen, hidden, by: hidden && top ? top.tagName + " " + (top.textContent || "").trim().slice(0, 30) : null };
      });

      expect(
        covered.hidden,
        `"Finish my card" is on screen and covered by ${covered.by} — the player cannot press it without scrolling a screen that looks finished`,
      ).toBe(false);
    });
  }

  test("still shows the club's unpinned notices, below the round", async ({ page }) => {
    /**
     * The control on the change that fixed the above. Moving club notices
     * under the player's card must not DROP them — an announcement nobody sees
     * is the fault `/me` grew an announcement list to fix in the first place.
     *
     * Pinned stays on top, which is what pinning means and what
     * `/announcements` promises in those words.
     */
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/me");
    await page.waitForLoadState("networkidle");

    const body = page.locator("body");
    await expect(body, "the pinned notice is gone").toContainText(/tee times are up/i);
    await expect(body, "the unpinned notice was dropped rather than moved").toContainText(
      /halfway house/i,
    );

    // And the pinned one is still above the player's position.
    const order = await page.evaluate(() => {
      const y = (re: RegExp) => {
        const el = [...document.querySelectorAll("*")].find(
          (e) => e.children.length === 0 && re.test(e.textContent || ""),
        );
        return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : -1;
      };
      return { pinned: y(/tee times are up/i), position: y(/^Position$/), unpinned: y(/halfway house/i) };
    });
    expect(order.pinned, "pinned notice not found").toBeGreaterThan(-1);
    expect(order.pinned).toBeLessThan(order.position);
    expect(order.unpinned, "unpinned notice should sit below the round").toBeGreaterThan(order.position);
  });
});
