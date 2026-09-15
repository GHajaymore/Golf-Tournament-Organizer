import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8"));

/**
 * THE DIALOGS, WHICH NOTHING HAS EVER MEASURED.
 *
 * `layout.spec` and `touch.spec` sweep every route from the filesystem and
 * assert that what renders on arrival fits the viewport. Neither contains a
 * single `.click()` — measured on 2026-09-14, not estimated — so nothing that
 * requires an interaction to exist has ever had its geometry asserted at any
 * width. A route sweep enumerates routes; it cannot enumerate STATES.
 *
 * THIS IS A HAND LIST, DELIBERATELY, AND THAT NEEDS SAYING because CLAUDE.md
 * says layout is swept from the filesystem and "do not reintroduce a hand
 * list". That rule is right and this is not the thing it forbids. A trigger is
 * per-component and cannot be derived: opening the launch dialog means knowing
 * it is behind the primary button on `/dashboard` and only for a draft. So the
 * list is by hand and `src/lib/__tests__/dialogs-are-swept.test.ts` pins the
 * COUNT and the KIND of every dialog in the app against it. Add a fourth and
 * that test goes red, which sends somebody here. A hand list that goes stale
 * silently is the fault the rule is about; a hand list with a count pinned
 * against it is a different animal — but only the pairing makes it so, which
 * is why each file names the other.
 *
 * WHAT IS ASSERTED. Not "does it look right" — that a dialog fits the viewport
 * it opened in, and that opening it does not make the page scroll sideways.
 * Those are the two failures that are invisible until somebody opens one on a
 * phone, and 320px is where they show.
 */

const FITS = "fits the viewport it opened in";

/**
 * The page must not scroll sideways, and the dialog must be inside it.
 *
 * Both halves matter and they fail differently: a dialog wider than the
 * viewport is unreadable, and a dialog that fits while pushing the BODY wider
 * is the `/roster` failure — the control was fine and the page moved under it.
 */
async function fitsTheViewport(page: Page, box: Locator, what: string) {
  const width = page.viewportSize()?.width ?? 0;
  const rect = await box.boundingBox();
  expect(rect, `${what}: no box — it did not open`).not.toBeNull();

  expect(
    Math.round(rect!.width),
    `${what} is ${Math.round(rect!.width)}px in a ${width}px viewport`,
  ).toBeLessThanOrEqual(width);

  // Left edge on screen, right edge on screen. A centred overlay that fits but
  // hangs off one side is still unreachable.
  expect(Math.round(rect!.x), `${what} starts off the left edge`).toBeGreaterThanOrEqual(0);
  expect(
    Math.round(rect!.x + rect!.width),
    `${what} runs past the right edge`,
  ).toBeLessThanOrEqual(width);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `${what}: the page is ${scrollWidth}px in a ${width}px viewport`)
    .toBeLessThanOrEqual(width);
}

test.describe("the sign-out dialog", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

  test(`sign out ${FITS}`, async ({ page }) => {
    await page.goto("/me");
    await page.waitForLoadState("networkidle");

    // By its accessible name, which is what a person navigating by assistive
    // tech has too — and which only exists because the trigger was labelled.
    await page.getByRole("button", { name: /sign out/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // It says WHICH dialog. A modal announced as "dialog" and nothing else is
    // the state this had until the sweep found it.
    await expect(dialog).toContainText(/sign out/i);
    await fitsTheViewport(page, dialog, "the sign-out dialog");
  });
});

test.describe("the launch dialog", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

  /**
   * Launch is offered for a DRAFT, and the fixture tournament is active — it
   * has a played round and cards against it, which is what the rest of the
   * suite needs. So the status is moved for this test and put back afterwards,
   * the same way `player.spec` moves `leaderboardVisibility`.
   *
   * In a `finally`, because a fixture left in the wrong state is a fixture the
   * next spec fails against for reasons that have nothing to do with it.
   */
  test(`launch ${FITS}`, async ({ page }) => {
    const prisma = new PrismaClient();
    try {
      await prisma.event.update({ where: { id: data.eventId }, data: { status: "draft" } });

      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /^launch tournament$/i }).first().click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // The tournament's name is IN the title, and the fixture's name is 59
      // characters — which is the whole reason this assertion is worth having
      // at 320px. See the note on the names in e2e/fixture.mjs.
      await expect(dialog).toContainText(/launch/i);
      await fitsTheViewport(page, dialog, "the launch dialog");
    } finally {
      await prisma.event.update({ where: { id: data.eventId }, data: { status: "active" } });
      await prisma.$disconnect();
    }
  });
});
