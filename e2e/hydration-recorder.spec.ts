import { test, expect } from "./coverage";
import { whereTheyPart } from "./page-errors";

/**
 * THE RECORDER FOR A HYDRATION MISMATCH, PROVED ON ONE MADE ON PURPOSE.
 *
 * React #418 has struck on a different screen each time and never on demand,
 * and three recorders in a row came back saying "the two are the same" — each
 * was comparing a page that had already been redrawn. `keepWhatTheServerSent`
 * (page-errors.ts) keeps the page as it stood at the instant React replaced
 * it. A recorder that has never been seen to record is the same thing as no
 * recorder — CLAUDE.md, "a sweep that finds nothing may be broken" — so this
 * makes the fault happen and reads what was kept.
 *
 * HOW THE FAULT IS MADE: one element is taken out of the server's HTML on its
 * way to the browser, and nothing else is touched. The browser parses a page
 * without it, React expects it, and the page is redrawn — the real fault,
 * with a cause that is known. The recorder must name the element and where.
 *
 * AND THE CONTROL: the same page, left alone, keeps nothing and throws nothing.
 * Without it a recorder that fires on every page would pass the test above.
 *
 * Signed out, on /faq: a page with no fixture and no data that changes.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const REMOVED = '<span class="label">Questions</span>';

test("a page React has to redraw is kept as the server sent it, and the difference is named", async ({ page }) => {
  const thrown: string[] = [];
  page.on("pageerror", (e) => thrown.push(String(e)));
  // Said on the page before it loads, so the recorder's line is marked as made on purpose and a round
  // counting real mismatches does not count this one.
  await page.addInitScript(() => {
    (window as unknown as { __thqMismatchOnPurpose?: boolean }).__thqMismatchOnPurpose = true;
  });

  await page.route(
    (url) => url.pathname === "/faq",
    async (route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      const response = await route.fetch();
      const html = await response.text();
      // Exactly one, or the page has changed and this test is no longer removing what it says it is.
      expect(html.split(REMOVED).length - 1, "the element this test takes out of the page").toBe(1);
      await route.fulfill({ response, body: html.replace(REMOVED, "") });
    },
  );
  await page.goto("/faq");
  await expect
    .poll(() => thrown.some((e) => e.includes("#418")), { timeout: 20_000, message: "an element was taken out of the server's page and React did not object" })
    .toBe(true);

  const parted = await whereTheyPart(page);
  expect(parted, "React redrew the page and nothing was kept of the one it replaced").not.toBeNull();
  // The server's page went straight to the heading; the browser's own drawing put the label first.
  expect(parted).toContain("the server sent <h1.h1>, the browser drew <span.label>");
  expect(parted, "where in the page").toContain("section.fq-hero");
  expect(parted, "how far the document had loaded when it was replaced").toMatch(/kept \d+ms into the page, document "(loading|interactive|complete)"/);

  // The reader is none the wiser, which is why this fault hides: the page ends up whole.
  await expect(page.locator("span.label", { hasText: "Questions" })).toBeVisible();
});

test("CONTROL: a page that hydrates keeps nothing, and throws nothing", async ({ page }) => {
  const thrown: string[] = [];
  page.on("pageerror", (e) => thrown.push(String(e)));
  await page.goto("/faq");
  await page.waitForLoadState("networkidle");
  // Give it the same seconds the other test gives a page that is being redrawn, and move down it
  // (by script: a phone on WebKit has no mouse wheel to turn).
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(700);
  expect(await whereTheyPart(page), "something was kept on a page that hydrated").toBeNull();
  expect(thrown, "a clean page threw").toEqual([]);
});
