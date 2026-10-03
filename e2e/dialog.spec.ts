import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
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

  // And top to bottom (2026-09-29): a dialog taller than the screen puts its
  // buttons where nobody can reach them — the width checks above cannot see it.
  const height = page.viewportSize()?.height ?? 0;
  expect(Math.round(rect!.y), `${what} starts above the top edge`).toBeGreaterThanOrEqual(0);
  expect(
    Math.round(rect!.y + rect!.height),
    `${what} runs past the bottom edge`,
  ).toBeLessThanOrEqual(height);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `${what}: the page is ${scrollWidth}px in a ${width}px viewport`)
    .toBeLessThanOrEqual(width);

  /**
   * AND EVERYTHING IN IT IS INSIDE IT (2026-10-03). The checks above measure
   * the dialog's own box, and a box can fit perfectly while its contents spill
   * out of it: #765 put a third button in the sign-out dialog's action row, and
   * at 393px the row was wider than the dialog — the first button started at
   * x=1, fifteen pixels outside a dialog that passed every check here. Found by
   * walking the screen, not by this file; this is the check that would have.
   *
   * Every control a person can press, measured against the dialog's LEFT and
   * RIGHT edges, with a pixel's grace for sub-pixel rounding. Not top and
   * bottom: a dialog is capped at the screen's height and scrolls inside itself
   * by design (`.dialog` in design-system.css), so a button below its fold on a
   * 320px phone is reachable — the first draft of this check flagged exactly
   * that and was wrong. Nobody scrolls SIDEWAYS inside a dialog to find a button.
   */
  const outside = await box.evaluate((dialog) => {
    const d = dialog.getBoundingClientRect();
    return [...dialog.querySelectorAll<HTMLElement>("a, button, input, select, textarea")]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < d.left - 1 || r.right > d.right + 1;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `"${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)} in a dialog ${Math.round(d.left)}..${Math.round(d.right)}`;
      });
  });
  expect(outside, `${what} has controls outside its own edges`).toEqual([]);
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
   * Launch is offered for a DRAFT, and the fixture tournament is live — it
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
      // Back to what the fixture seeds. These two must move together — see the
      // note on `status` in `fixture.mjs` for why it is "live" and not
      // "active", and what an invented status hid.
      await prisma.event.update({ where: { id: data.eventId }, data: { status: "live" } });
      await prisma.$disconnect();
    }
  });
});

test.describe("the complete-and-delete dialog", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

  /**
   * THE SECOND DIALOG IN `LifecycleBar` (2026-09-29): completing a tournament
   * on the free Par plan deletes it, so the button asks first — the terms, the
   * upgrade, and Go to Reports. It opens only for a club held to the Par terms,
   * and only when completing is not refused, and the shared fixture is neither:
   * its club has no plan row and its review queue holds a disputed card.
   *
   * So this builds its OWN throwaway tournament rather than bending the
   * fixture: a Par club and an empty live tournament, the fixture's organizer
   * made its admin, named off the fixture's club so the fixture's teardown
   * sweeps it if this dies half way. The dialog is opened, measured, and
   * CANCELLED — "Complete and delete" is never pressed — and everything is
   * removed in a `finally`.
   */
  test(`complete and delete ${FITS}`, async ({ page, baseURL }) => {
    const prisma = new PrismaClient();
    let orgId = "";
    try {
      const fixture = await prisma.event.findUnique({
        where: { id: data.eventId },
        select: { organization: { select: { name: true } }, accounts: { where: { role: "admin" }, select: { email: true }, take: 1 } },
      });
      const org = await prisma.organization.create({
        data: {
          name: `${fixture!.organization.name} Par`,
          kind: "club",
          subscription: { create: { plan: "free", planTermsApply: true } },
        },
      });
      orgId = org.id;
      const event = await prisma.event.create({
        data: {
          organizationId: org.id,
          // Long, like the fixture's: the name is in the dialog's title, and
          // 320px is where a long one shows.
          name: `${fixture!.organization.name} Par — Sunday Stableford for the Captain’s Prize`,
          dates: "", course: "", city: "", address: "", regDeadline: "",
          status: "live",
          shape: "single",
          shareToken: `${org.id}-par`,
          accounts: { create: { name: "O. Ganizer", email: fixture!.accounts[0].email, role: "admin" } },
        },
      });

      const secret = process.env.AUTH_SECRET ?? "dev-secret";
      const signed = `${event.id}.${createHmac("sha256", secret).update(event.id).digest("base64url")}`;
      await page.context().addCookies([{ name: "ng_active_event", value: signed, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);

      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /^complete tournament$/i }).first().click();

      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(/complete and delete/i);
      await expect(dialog).toContainText(/deletes it for good/i);
      await fitsTheViewport(page, dialog, "the complete-and-delete dialog");

      // Out the safe way, and the tournament is still there.
      await dialog.getByRole("button", { name: /^cancel$/i }).click();
      await expect(dialog).toBeHidden();
      expect(await prisma.event.count({ where: { id: event.id } }), "cancelling deleted the tournament").toBe(1);
    } finally {
      if (orgId) {
        await prisma.event.deleteMany({ where: { organizationId: orgId } });
        await prisma.organization.deleteMany({ where: { id: orgId } });
      }
      await prisma.$disconnect();
    }
  });
});
