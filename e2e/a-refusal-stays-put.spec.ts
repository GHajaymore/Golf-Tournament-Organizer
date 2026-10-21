import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { landingSettled } from "./landing-settled";

/**
 * A REFUSAL IS BROUGHT INTO VIEW ONCE — NOT ON EVERY KEYSTROKE (2026-10-21).
 *
 * Refusals are scrolled into view when they appear, so that one said above or
 * below the press is not out of sight. The first way that was written — an
 * inline ref, `ref={(el) => el?.scrollIntoView(...)}` — is a new function on
 * every render, so React called it again on each one: while the refusal stayed
 * up, every keystroke pulled the page back to it, and somebody who had scrolled
 * away to correct the field it named was dragged back as they typed.
 *
 * Measured by COUNTING, not by reading the scroll position: a focused box is
 * scrolled into view by the browser itself as it is typed into, which would
 * move the page whichever way the app is written. So the page's own
 * `scrollIntoView` is wrapped, and the calls on the refusal are counted while
 * the person types ten characters into the form. Once is right; eleven is the
 * fault.
 *
 * The front door's sign-up form is the screen: its refusal stays up while the
 * person types, which is exactly when it matters. Previews, development and
 * this test server are not production, so sign-up is open here.
 */

async function countRefusalScrolls(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __refusalScrolls: number };
    w.__refusalScrolls = 0;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, ...args: Parameters<Element["scrollIntoView"]>) {
      if (this.getAttribute("role") === "alert") w.__refusalScrolls += 1;
      return original.apply(this, args);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __refusalScrolls: number }).__refusalScrolls);
}

test("a refusal on the sign-up form is brought into view once, and typing does not pull the page back to it", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "front door");
  const scrolls = await countRefusalScrolls(page);

  await page.goto("/");
  await landingSettled(page);
  await page.getByRole("tab", { name: "Sign up", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Sign up", exact: true })).toHaveAttribute("aria-selected", "true");

  const create = page.getByRole("button", { name: "Create account" });
  await create.click();
  const refused = page.getByRole("alert").filter({ hasText: "To create your account" });
  await expect(refused, "an empty sign-up was not refused in words").toBeVisible();
  await expect(refused, "the refusal is not on the screen of the person who pressed").toBeInViewport();
  await expect.poll(scrolls, { message: "the refusal was never brought into view" }).toBeGreaterThanOrEqual(1);
  const afterPress = await scrolls();

  // The person reads it and starts filling the form in, the refusal still up above the button.
  await page.getByPlaceholder("Full name").pressSequentially("Zz Stays Put", { delay: 20 });
  await expect(refused, "the refusal went away before anything was pressed").toBeVisible();
  expect(
    (await scrolls()) - afterPress,
    "typing pulled the page back to the refusal: it was scrolled into view again on a keystroke",
  ).toBe(0);
  expect(errors, errors.join("\n")).toEqual([]);
});
