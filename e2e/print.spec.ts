import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";

/**
 * WHAT COMES OUT OF THE PRINTER.
 *
 * A starter holds a paper tee sheet on the first tee, a committee prints the
 * standings, and a player prints their card. `globals.css` has a whole
 * `@media print` block for exactly that — it hides the sidebar, the top bar,
 * the tab bar and the drawer so the page prints as content.
 *
 * NOTHING HAS EVER LOOKED. No spec emulates print media, so the block has been
 * asserted by reading it, and it hides things BY CLASS: `.app-sidebar`,
 * `.m-topbar`, `.m-tabbar`, `.m-drawer`, `.no-print`. Those are the CONSOLE's
 * class names. The player shell was built later with inline styles and carries
 * none of them — its `<nav>` is `position: fixed` with no class at all, which
 * is also how `nothing-is-covered.spec.ts` had to identify it.
 *
 * So this asks the printer, rather than the stylesheet: with print media
 * emulated, is any fixed or sticky chrome still displayed?
 */

test.describe("the console prints as content", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

  test("hides its own chrome", async ({ page }) => {
    // The control. These carry the classes the print block names, so if this
    // ever fails the block itself has broken and the player result below means
    // nothing.
    await page.goto("/foursomes");
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ media: "print" });

    const shown = await chromeStillShowing(page);
    expect(shown, `console chrome printed: ${JSON.stringify(shown)}`).toEqual([]);
  });
});

test.describe("the player's screens print as content", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

  for (const path of ["/me", "/me/card", "/me/board"]) {
    test(`${path} hides the app around it`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(new URL(page.url()).pathname, "not signed in as a player").toBe(path);
      await page.emulateMedia({ media: "print" });

      const shown = await chromeStillShowing(page);
      expect(
        shown,
        `${path} prints the app around the content: ${JSON.stringify(shown)}`,
      ).toEqual([]);
    });
  }
});

/**
 * Fixed or sticky boxes still painted with print media on.
 *
 * Position rather than a class list, deliberately: a class list would only
 * ever find the chrome somebody remembered to name, which is the whole bug.
 * Nothing legitimately sticks to the edge of a sheet of paper.
 */
async function chromeStillShowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 24) continue;
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 34);
      out.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).slice(0, 18) : ""} "${text}"`);
    }
    return out;
  });
}
