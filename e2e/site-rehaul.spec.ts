import { expect, test } from "./coverage";

/**
 * THE SITE REHAUL'S PREVIEW, `/new` (2026-11-01), at the three widths it was designed at.
 *
 * What it holds: the page renders and is never indexed; nothing scrolls sideways; every picture
 * arrives; on a 393 x 852 phone the live moment (the member's phone with their row marked on the
 * board) is in the first screen without scrolling — the panel's condition for adopting it; the day
 * board's times turn the screen beside them; and the social links are TourneyHQ's own, in the same
 * tab, with no X until it has an address.
 *
 * Reduced motion, so the hero shows its settled state at once (the moment itself is a component
 * test of timing, not of layout).
 */
test.use({ storageState: { cookies: [], origins: [] } });

const WIDTHS = [
  { width: 393, height: 852 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

test.describe("/new, the site rehaul's preview", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // The widths are set below, so one project is enough.
    test.skip(testInfo.project.name !== "desktop", "the widths are set by the test itself");
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const size of WIDTHS) {
    test(`renders whole at ${size.width}px, with nothing sideways and every picture in`, async ({ page }) => {
      await page.setViewportSize(size);
      const res = await page.goto("/new");
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveText(/Run the whole competition\.\s*They score by phone\./i);
      await expect(page.locator(".n-tagline")).toHaveText("From Registration to Recognition.");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

      // Walk down so every lazy picture is asked for, then come back.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 600) await page.evaluate((top) => window.scrollTo(0, top), y);
      // A swipe row's later pictures are never scrolled into view down the page: ask for them too.
      await page.evaluate(() => document.querySelectorAll<HTMLImageElement>("img[loading=lazy]").forEach((i) => (i.loading = "eager")));
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))));
      await page.evaluate(() => window.scrollTo(0, 0));

      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sideways, "the page scrolls sideways").toBeLessThanOrEqual(0);
      const broken = await page.evaluate(() =>
        [...document.images].filter((i) => i.getBoundingClientRect().width > 0 && (!i.complete || i.naturalWidth === 0)).map((i) => i.currentSrc || i.src),
      );
      expect(broken, "pictures that did not arrive").toEqual([]);
    });
  }

  test("on a 393 x 852 phone the live moment is in the first screen", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/new");
    const mark = page.locator(".n-stage .n-phone .n-mark.n-show");
    await expect(mark).toBeVisible();
    const box = await mark.boundingBox();
    expect(box, "the marked row has no box").not.toBeNull();
    expect(box!.y + box!.height, "the member's marked row is below the fold").toBeLessThanOrEqual(852);
    // And the words that say what it is come before it.
    const sub = await page.locator(".n-hero-sub").boundingBox();
    expect(sub!.y).toBeLessThan(box!.y);
  });

  test("a time on the day board turns the screen beside it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/new");
    const board = page.getByRole("tablist", { name: "The week, by time" });
    const tab = board.getByRole("tab", { name: /11:42/ });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel").filter({ hasText: "The board moves." })).toBeVisible();
    await expect(page.locator(".n-day-phone .n-frame:not(.n-off) img")).toHaveAttribute("alt", /Board/);
    // The arrow keys move along the board.
    await tab.press("ArrowRight");
    await expect(board.getByRole("tab", { name: /14:00/ })).toHaveAttribute("aria-selected", "true");
  });

  test("the social links are TourneyHQ's own, in the same tab, and X is not drawn", async ({ page }) => {
    await page.goto("/new");
    const links = page.locator('a[rel~="me"]');
    const hrefs = await links.evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]));
    expect(hrefs.length).toBe(8); // four in Follow along, four in the footer
    for (const [href, target, rel] of hrefs) {
      expect(href).toMatch(/^https:\/\/www\.(instagram\.com\/tourneyhq|youtube\.com\/@tourneyhq|facebook\.com\/TourneyHQ|linkedin\.com\/company\/tourneyhq)$/);
      expect(target).toBeNull();
      expect(rel).toContain("noopener");
    }
    await expect(page.locator('a[href*="x.com"], a[href*="twitter.com"]')).toHaveCount(0);
    const sameAs = await page.locator('script[type="application/ld+json"]').evaluate((s) => {
      const graph = JSON.parse(s.textContent ?? "{}")["@graph"] as Array<{ "@type": string; sameAs?: string[] }>;
      return graph.find((n) => n["@type"] === "Organization")?.sameAs ?? [];
    });
    expect(sameAs).toHaveLength(4);
  });
});
