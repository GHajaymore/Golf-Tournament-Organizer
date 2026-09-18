import { test, expect } from "@playwright/test";
import { overflowing } from "./overflow";

/**
 * THE ACCESS SCREEN, WITH SOMEBODY WAITING ON IT.
 *
 * `layout.spec` walks `/organization` at every viewport and asserts nothing
 * sticks out. That sweep is only ever as good as what the fixture puts on the
 * screen, and the request-to-join panel is the newest thing there: a person's
 * name, their address, their note, a role picker and two buttons, on one row.
 *
 * So the fixture seeds a pending request, and this spec is the half the sweep
 * cannot do — proving the panel is actually rendered. Without it the width
 * assertions would pass on an empty screen for ever, which is the failure
 * `e2e/fixture.mjs` already records about a 404 satisfying the public-board
 * spec.
 *
 * READ-ONLY. It never approves or declines: this fixture is shared by three
 * viewport projects running in parallel, and a spec that answered the request
 * would delete the thing the other two came to measure.
 */

test.use({ storageState: ".e2e/organizer.json" });

test("a request to join is on the access screen, and fits", async ({ page }) => {
  await page.goto("/organization");
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname, "/organization redirected away — not signed in?").toBe("/organization");
  await expect(page.locator("#__next_error__")).toHaveCount(0);

  // THE PANEL IS THERE. Everything below measures it; this is what stops the
  // measurements being taken of nothing.
  const panel = page.locator(".card", { hasText: "Asked to join" }).first();
  await expect(panel).toBeVisible();

  // The three things the club needs in order to answer: who, how to recognise
  // them, and what they said. The name carries an accent, a curly apostrophe
  // and a hyphen, so this is an encoding check as much as a layout one.
  await expect(panel).toContainText("Síobhán O’Donnell-Fitzgerald");
  await expect(panel).toContainText("@example.invalid");
  await expect(panel).toContainText("Thursday night draw");

  // And the answer, with Admin first — the default the screen grants, because
  // whoever asks is the league's other organizer rather than a spectator.
  await expect(panel.getByRole("button", { name: /Add them/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Decline/ })).toBeVisible();
  const role = panel.getByRole("combobox").first();
  await expect(role).toHaveValue("admin");

  /**
   * Nothing sticks out — at whichever width this project runs. The panel's row
   * is a name, an address, a select and two buttons, which is the shape that
   * overflowed a 320px phone the last time a control grew (#429).
   */
  const width = page.viewportSize()?.width ?? 0;
  const offenders = await overflowing(page);
  expect(
    offenders,
    `/organization: ${offenders.length} element(s) past the right edge — ${JSON.stringify(offenders.slice(0, 3))}`,
  ).toEqual([]);
  const box = await panel.boundingBox();
  expect(box, "the panel has no box at all").not.toBeNull();
  expect(
    Math.round((box?.x ?? 0) + (box?.width ?? 0)),
    `the panel itself runs past a ${width}px screen`,
  ).toBeLessThanOrEqual(width + 1);
});
