import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { interestWords, HELD_FRONT_DOOR, SIGNINS_CLOSED_NOTICE, type LaunchState } from "../src/lib/go-live";

/**
 * JOINING THE EARLY LIST SAYS IT IS FREE AND NEEDS NO CARD (Ajay, 2026-10-31: "for the early
 * interest, its not showing no credit card or just need an email … correct everywhere").
 *
 * The early-list page is where every ad and every "Join the early list" button lands, so it is
 * the one place a visitor must read, before the form, that joining costs nothing. It is not the
 * free plan's "No card" (held until launch): it is about the list, which takes a few details and
 * an email.
 *
 * THE PAGE FOLLOWS THE GO-LIVE SWITCH (#936): the early list is offered only while held; once
 * live the page is "Now open" and offers no list (`interest.spec.ts` holds that it says no 25%).
 * So on a held server this walks the line and its place above the form; on a live one — every
 * e2e server, which is never production — it says so and asserts that the page offers no early
 * list at all, so there is nothing to say "free" about. `go-live-switch.spec.ts` walks the held
 * front door's pricing note (which carries the same words) on a server that holds.
 *
 * WHAT IT CANNOT SEE on a live server: the held words on screen. Those are pinned as data below,
 * every place that offers the list, and in `interest-form-rules.test.ts`.
 */
const FREE = "Free to join, no card needed.";

test("the early-list page says joining is free and needs no card, above the form", async ({ page }) => {
  const errors: string[] = [];
  watchPageErrors(page, errors);
  // Every held place that offers the early list says it is free and needs no card.
  expect(interestWords("held").sub.startsWith(FREE), "the page and its words disagree").toBe(true);
  for (const [where, said] of [
    ["front door lead", HELD_FRONT_DOOR.lead],
    ["front door pricing note", HELD_FRONT_DOOR.pricingNote],
    ["sign-in notice", SIGNINS_CLOSED_NOTICE.offer],
  ] as const) {
    expect(said, `${where} offers the early list without saying it is free`).toMatch(/free/i);
    expect(said, `${where} offers the early list without saying no card`).toMatch(/no card/i);
  }

  await page.goto(`/interest?bust=${Date.now()}`);
  const form = page.locator("form").first();
  await expect(form).toBeVisible({ timeout: 30_000 });
  const launch = (await page.locator("main").getAttribute("data-launch")) as LaunchState | null;
  expect(launch === "held" || launch === "live", `/interest does not say which state it is in: ${launch}`).toBe(true);

  if (launch === "held") {
    const promise = page.getByText(FREE, { exact: false }).first();
    await expect(promise, "the early-list page does not say it is free with no card").toBeVisible({ timeout: 30_000 });
    // Before the form, so it is read before anybody types.
    const [p, f] = await Promise.all([promise.boundingBox(), form.boundingBox()]);
    expect(p && f && p.y < f.y, "the no-card line sits below the form, where nobody reads it first").toBe(true);
  } else {
    test.info().annotations.push({ type: "not walked", description: "this server is live: /interest offers no early list, so the held line is asserted as data only" });
    // The early list's offer is its 25%: the same test `interest.spec.ts` makes of the live page.
    await expect(page.getByText(/25%/), "the live page still offers the early list").toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
