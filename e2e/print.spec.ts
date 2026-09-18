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

  for (const path of ["/foursomes", "/reports", "/scorecard"]) {
    test(`${path} hides its own chrome`, async ({ page }) => {
      // Also the control for the player result below: these carry the classes
      // the print block names, so if they ever fail the block itself has
      // broken and the player screens say nothing.
      const res = await page.goto(path);
      expect(res?.status(), `${path} did not render`).toBeLessThan(500);
      await page.waitForLoadState("networkidle");
      await page.emulateMedia({ media: "print" });

      const shown = await chromeStillShowing(page);
      expect(shown, `${path} printed chrome: ${JSON.stringify(shown)}`).toEqual([]);
    });
  }

  /**
   * AND THE SHEET ITSELF COMES OUT, which is the question a starter has.
   *
   * Hiding the app is only half of printing. `TeeSheetPrint` returns null
   * until a sheet has been SAVED, and `ReportsClient` carries a note about
   * exactly that — so "the chrome is gone" and "there is a tee sheet on the
   * paper" are two different claims and only one of them was being made.
   */
  for (const [path, needle] of [
    ["/foursomes", /group|tee/i],
    ["/reports", /standings|player/i],
  ] as const) {
    test(`${path} still has something on the page in print`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.emulateMedia({ media: "print" });

      const printed = await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        const visible = [...main.querySelectorAll("*")].filter((el) => {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return r.width > 40 && r.height > 12;
        });
        return { blocks: visible.length, text: (main.textContent || "").replace(/\s+/g, " ").trim() };
      });

      expect(printed.blocks, `${path} prints a blank sheet`).toBeGreaterThan(3);
      expect(printed.text, `${path} printed nothing recognisable`).toMatch(needle);
    });
  }
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
