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

  /** Bring one moment of the day to the middle of the window, as a reader scrolling does. */
  async function readMoment(page: import("@playwright/test").Page, words: string) {
    const moment = page.locator(".n-step").filter({ hasText: words });
    await moment.evaluate((el) => {
      const r = el.getBoundingClientRect();
      window.scrollTo(0, window.scrollY + r.top + r.height / 2 - window.innerHeight / 2);
    });
  }

  // Design D (2026-11-02): the day is told by both sides — the committee's laptop and a member's
  // phone are held in view together, and the device a moment happens on is the one lit.
  test("scrolling the day turns the device it happens on, and a phone gets a plain sequence", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/new");
    const stage = page.locator(".n-story-lit");

    // 11:42, the office: the laptop is lit and shows the organizer's dashboard.
    await readMoment(page, "The office sees every group.");
    await expect(stage).toHaveAttribute("data-active", "laptop");
    await expect(page.locator(".n-story-desk .n-frame:not(.n-off) [role=img]")).toHaveAttribute("aria-label", /dashboard/);
    await expect(page.getByRole("navigation", { name: "The day, by chapter" }).locator('[aria-current="step"]')).toHaveText(/The live round/);

    // 10:50, the card: the phone is lit and shows the member's card.
    await readMoment(page, "They tap the score, or say it.");
    await expect(stage).toHaveAttribute("data-active", "phone");
    await expect(page.locator(".n-story-lit > .n-phone .n-frame:not(.n-off) img")).toHaveAttribute("alt", /card/);

    // Both devices are held in view.
    for (const sel of [".n-story-desk", ".n-story-lit > .n-phone"]) {
      const box = await page.locator(sel).boundingBox();
      expect(box!.y, `${sel} is not held in view`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${sel} runs below the window`).toBeLessThanOrEqual(900);
    }

    // Below 768px there is no sticky stage: every moment carries its own screen — the member's on a
    // phone, the committee's as a window onto the console.
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(page.locator(".n-story-dev")).toBeHidden();
    const phones = await page.locator(".n-step-phone").count();
    const desks = await page.locator(".n-step-desk").count();
    expect(phones, "no member's moment").toBeGreaterThan(0);
    expect(desks, "no committee's moment").toBeGreaterThan(0);
    expect(phones + desks).toBe(await page.locator(".n-step").count());
    await expect(page.locator(".n-step-desk").first()).toBeVisible();
  });

  test("the social links are TourneyHQ's own, in the same tab, and X is not drawn", async ({ page }) => {
    await page.goto("/new");
    const links = page.locator('a[rel~="me"]');
    const hrefs = await links.evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]));
    // Each profile in `lib/social-links.ts` (the one place they are written): once in Follow along,
    // once in the footer.
    const ours = SOCIAL_LINKS.map((s) => s.href);
    expect(hrefs.length).toBe(ours.length * 2);
    for (const [href, target, rel] of hrefs) {
      expect(ours).toContain(href);
      expect(target).toBeNull();
      expect(rel).toContain("noopener");
    }
    await expect(page.locator('a[href*="x.com"], a[href*="twitter.com"]')).toHaveCount(0);
    const sameAs = await page.locator('script[type="application/ld+json"]').evaluate((s) => {
      const graph = JSON.parse(s.textContent ?? "{}")["@graph"] as Array<{ "@type": string; sameAs?: string[] }>;
      return graph.find((n) => n["@type"] === "Organization")?.sameAs ?? [];
    });
    expect([...sameAs].sort()).toEqual([...ours].sort());
  });
});
