import { expect, test } from "./coverage";
import { SOCIAL_LINKS } from "../src/lib/social-links";

/**
 * THE SITE REHAUL'S PREVIEW, `/new` (2026-11-01), at the three widths it was designed at.
 *
 * What it holds: the page renders and is never indexed; nothing scrolls sideways; every picture
 * arrives; on a 393 x 852 phone the live moment (the member's phone with their row marked on the
 * board) is in the first screen without scrolling — the panel's condition for adopting it; the day,
 * told as a scroll story (design C), turns the screen of the phone held in view and becomes a plain
 * sequence on a phone; and the social links are TourneyHQ's own, in the same
 * tab, with no X until it has an address.
 *
 * Design E ("one day's light", 2026-11-02) keeps all of that: the h1 is today's "From Registration
 * to Recognition." with "Run the whole competition. They score by phone." under it, the story runs
 * five moments (the money and the result have sections of their own), and the social links are
 * read from `src/lib/social-links.ts`, so the footer is their only place on the page.
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
      await expect(page.locator("h1")).toHaveText(/From Registration\s*to Recognition\./i);
      await expect(page.locator(".e-sub")).toHaveText(/Run the whole competition\.\s*They score by phone\./i);
      await expect(page.locator(".n-tagline")).toHaveText(/Golf tournament & league software/i);
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

  test("scrolling the day turns the phone that stays in view, and a phone gets a plain sequence", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/new");
    // Bring the 11:42 moment to the middle of the window: the phone in view shows the board.
    const moment = page.locator(".n-step").filter({ hasText: "The board moves." });
    await moment.evaluate((el) => {
      const r = el.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + r.top + r.height / 2 - window.innerHeight / 2);
    });
    await expect(page.locator(".n-story-pin .n-frame:not(.n-off) img")).toHaveAttribute("alt", /Board/);
    await expect(page.getByRole("navigation", { name: "The day, by chapter" }).locator('[aria-current="step"]')).toHaveText(/The live board/);
    const pin = await page.locator(".n-story-pin .n-phone").boundingBox();
    expect(pin!.y, "the phone is not held in view").toBeGreaterThanOrEqual(0);
    expect(pin!.y + pin!.height).toBeLessThanOrEqual(900);

    // Below 768px there is no sticky phone: every moment carries its own screen.
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(page.locator(".n-story-dev")).toBeHidden();
    await expect(page.locator(".n-step-phone")).toHaveCount(5);
    await expect(page.locator(".n-step-phone").first()).toBeVisible();
  });

  test("the social links are TourneyHQ's own, in the same tab, and X is not drawn", async ({ page }) => {
    await page.goto("/new");
    const links = page.locator('a[rel~="me"]');
    const hrefs = await links.evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]));
    expect(hrefs.length).toBe(SOCIAL_LINKS.length); // the footer's, one per profile
    for (const [href, target, rel] of hrefs) {
      expect(SOCIAL_LINKS.map((s) => s.href)).toContain(href);
      expect(target).toBeNull();
      expect(rel).toContain("noopener");
    }
    await expect(page.locator('a[href*="x.com"], a[href*="twitter.com"]')).toHaveCount(0);
    const sameAs = await page.locator('script[type="application/ld+json"]').evaluate((s) => {
      const graph = JSON.parse(s.textContent ?? "{}")["@graph"] as Array<{ "@type": string; sameAs?: string[] }>;
      return graph.find((n) => n["@type"] === "Organization")?.sameAs ?? [];
    });
    expect(sameAs).toEqual(SOCIAL_LINKS.map((s) => s.href));
  });
});
