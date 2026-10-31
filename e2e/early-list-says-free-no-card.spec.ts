import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { INTEREST_COPY } from "../src/lib/domain/interest";

/**
 * JOINING THE EARLY LIST SAYS IT IS FREE AND NEEDS NO CARD (Ajay, 2026-10-31: "for the early
 * interest, its not showing no credit card or just need an email … correct everywhere").
 *
 * The early-list page is where every ad and every "Join the early list" button lands, so it is
 * the one place a visitor must read, before the form, that joining costs nothing. It is not the
 * free plan's "No card" (held until launch): it is about the list, which takes a few details and
 * an email.
 *
 * WHAT IT CANNOT SEE: the held front door's own lead and pricing note. Those show only while
 * production holds sign-ins, which previews and e2e never do; their words are the same
 * constants, read in `sign-in-gate.ts`.
 */
test("the early-list page says joining is free and needs no card, above the form", async ({ page }) => {
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await page.goto(`/interest?bust=${Date.now()}`);
  const promise = page.getByText("Free to join, no card needed.", { exact: false }).first();
  await expect(promise, "the early-list page does not say it is free with no card").toBeVisible({ timeout: 30_000 });
  // Before the form, so it is read before anybody types.
  const form = page.locator("form").first();
  await expect(form).toBeVisible();
  const [p, f] = await Promise.all([promise.boundingBox(), form.boundingBox()]);
  expect(p && f && p.y < f.y, "the no-card line sits below the form, where nobody reads it first").toBe(true);
  expect(INTEREST_COPY.sub.startsWith("Free to join, no card needed."), "the page and its words disagree").toBe(true);
  expect(errors).toEqual([]);
});
