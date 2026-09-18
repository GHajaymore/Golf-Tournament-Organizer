import { test, expect } from "@playwright/test";
import { overflowing } from "./overflow";

/**
 * THE CLUB'S OWN LIST, IN A BROWSER.
 *
 * `/roster` has been swept by `layout.spec` at three viewports since that file
 * existed, against a club with NO MEMBERS — so the sweep measured an empty
 * screen and no browser had ever rendered a member row.
 *
 * The fixture has three now, and the third is the point: a member whose index
 * nobody has claimed (`handicapSource: "none"`). Every screen printed the
 * stored 0 beside such a row until 2026-09-18, which reads as a scratch
 * golfer — the outcome `handicap-policy.ts` opens by calling catastrophic:
 *
 *   "A 24-handicapper playing off scratch does not look like an outage; it
 *    looks like a competition, and it is settled and paid out before anybody
 *    works out why the results are absurd."
 *
 * Unit tests pin `indexLabel`. This pins that what the label says reaches the
 * screen a secretary actually reads — the gap `org-noun-reaches-the-screen`
 * was written for, one floor down.
 *
 * READ-ONLY. Three viewport projects share one fixture; nothing here edits a
 * member.
 */

test.use({ storageState: ".e2e/organizer.json" });

test("a member with no index does not read as a scratch golfer", async ({ page }) => {
  await page.goto("/roster");
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname, "/roster redirected away — not signed in?").toBe("/roster");
  await expect(page.locator("#__next_error__")).toHaveCount(0);

  // The list rendered at all — without this the assertions below pass on an
  // empty table, which is exactly the state this spec was written to end.
  const row = (name: string) => page.locator("tr", { hasText: name }).first();
  await expect(row("Aj Moore")).toBeVisible();

  // A claimed figure prints.
  await expect(row("Aj Moore")).toContainText("12.4");

  // A genuine scratch player still reads 0 — the direction a careless fix
  // breaks, told to the same secretary.
  await expect(row("Pat Scratch")).toContainText("0");
  await expect(row("Pat Scratch")).not.toContainText("no index");

  // And the one nobody has an index for says so.
  const unfinished = row("O’Donnell-Fitzgerald");
  await expect(unfinished).toBeVisible();
  await expect(unfinished, "a member with no claimed index is showing a number").toContainText("no index");

  const width = page.viewportSize()?.width ?? 0;
  const offenders = await overflowing(page);
  expect(
    offenders,
    `/roster: ${offenders.length} element(s) past the right edge — ${JSON.stringify(offenders.slice(0, 3))}`,
  ).toEqual([]);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `/roster: body is ${scrollWidth}px in a ${width}px viewport`).toBeLessThanOrEqual(width + 1);
});
