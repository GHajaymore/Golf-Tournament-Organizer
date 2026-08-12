import { test, expect } from "@playwright/test";
import { join } from "node:path";

test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

/**
 * The console must stay dense on a desktop pointer, and the app must have
 * reachable targets on a touch one.
 *
 * These two assertions are the same rule read from both sides, and neither is
 * meaningful alone: raising every control to 44px would have quietly bloated
 * the organizer's console, which is a real cost to the person who spends
 * hours in it. The gate is `@media (pointer: coarse)` — the pointing device,
 * not the window width — so a narrow desktop window keeps the dense layout.
 *
 * The first version of that rule silently did not apply to `.btn` at all:
 * Next's CSS chunker does not preserve `@import`-first order, so
 * design-system.css lands after globals.css and won at equal specificity.
 * Nothing failed. That is why this is measured in a built app rather than
 * asserted about a stylesheet.
 */

test("controls are thumb-sized on a phone and dense on a desktop", async ({ page }, testInfo) => {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  const btn = await page
    .locator(".btn")
    .filter({ has: page.locator(":scope:visible") })
    .first()
    .boundingBox()
    .catch(() => null);

  const height = await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>(".btn")].find(
      (b) => b.getBoundingClientRect().height > 0,
    );
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  });

  expect(height, "no visible button found to measure").not.toBeNull();

  // Branch on the pointer the browser actually reports, not on the project's
  // name. Naming one project "phone" and matching that string meant a second
  // touch profile — the 320px one — silently took the desktop branch and
  // asserted the opposite of what it should have.
  if (coarse) {
    expect(height!, `touch button is ${height}px; iOS asks 44pt and Android 48dp`).toBeGreaterThanOrEqual(44);
  } else {
    expect(
      height!,
      `desktop button is ${height}px — the console's density must not follow the phone`,
    ).toBeLessThanOrEqual(36);
  }
  expect(btn === null || btn.width > 0).toBeTruthy();
});

test("nothing tappable is smaller than the platform minimum", async ({ page }, testInfo) => {
  const isTouch = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  test.skip(!isTouch, "a touch-size rule only applies to touch");

  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");

  const small = await page.evaluate(() => {
    return [...document.querySelectorAll<HTMLElement>("button, a, [role=button], select, input")]
      .filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        // Links inside a sentence are text, not targets — enlarging those
        // would break the prose they sit in.
        const inProse = !!el.closest("p");
        return !inProse && (r.height < 44 || r.width < 24);
      })
      .map((el) => ({
        tag: el.tagName,
        cls: String(el.className ?? "").slice(0, 30),
        h: Math.round(el.getBoundingClientRect().height),
        text: (el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 24),
      }));
  });

  expect(small, `sub-44px targets: ${JSON.stringify(small)}`).toEqual([]);
});
