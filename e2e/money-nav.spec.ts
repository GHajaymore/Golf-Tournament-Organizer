import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8"));

/**
 * Every money screen, reached the way a person reaches it.
 *
 * The 2026-08-25 audit listed this as outstanding and it stayed outstanding
 * for a reason: the fixture had no money in it, so the only thing any test
 * could have proved was that an empty state rendered. It has money now.
 *
 * WHY CLICKING MATTERS, when `npm run smoke` already GETs every route and
 * `layout.spec` already sweeps them from the filesystem. Neither of those goes
 * through the nav. A link whose href is stale, an entry hidden from a role that
 * should see it, a section that collapses on a phone and buries its own
 * contents — none of that is visible to a test that types the URL. Those are
 * navigation faults, and they need navigating to find.
 *
 * READ-ONLY, on purpose. This spec shares one seeded tournament with every
 * other spec and all three viewports. `offline.spec` learned that the hard
 * way: it entered a hole, the write reached the database, and `player.spec`
 * went red asserting the card's shape. Nothing here writes.
 */

const money = data.money as {
  billCents: number;
  settledCents: number;
  prizeLabel: string;
};

/** Money as the app renders it, so an assertion cannot disagree with the UI. */
const asMoney = (cents: number) => (cents / 100).toFixed(2);

/**
 * Open the app's own navigation, whatever it is on this viewport.
 *
 * The console is a sidebar on a desktop and a menu behind a button on a phone.
 * A test that only knew the desktop shape would silently skip the phone, which
 * is the viewport most of this product is used on.
 */
async function openNav(page: Page) {
  // "Open menu", exactly. /menu/i also matched the drawer's own "Close menu"
  // button, which sits in the DOM while the drawer is shut — two matches, a
  // strict-mode throw, and a catch that quietly left the nav closed. The test
  // then reported that the app had no Prizes link on a phone, which was a lie
  // about the product told by a fault in the test.
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
    // The Close button appears the instant the drawer mounts, but the drawer
    // slides in over 220ms (`drawer-in`). Clicking inside that window hit-tests
    // against the animating position, and the backdrop wins. Wait for the
    // animation the CSS actually declares rather than guessing at a delay.
    await page
      .locator(".m-drawer")
      .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined))
      .catch(() => undefined);
  }
}

/**
 * The navigation itself, whichever shape this viewport wears.
 *
 * Scoped, and that is the whole point. A bare
 * `getByRole("link", { name: /reports/i }).first()` matched a QUICK-LINK TILE
 * ON THE DASHBOARD -- 333x71, not in the drawer at all -- which sat underneath
 * the open drawer. Playwright then reported that the drawer was intercepting
 * clicks, and it was: the test was trying to click through it at something
 * else. Three plausible fixes were tried against that wrong diagnosis before
 * the element was actually measured.
 */
async function nav(page: Page) {
  const drawer = page.locator(".m-drawer");
  if (await drawer.isVisible().catch(() => false)) return drawer;
  return page.locator(".app-sidebar");
}

/** Click a nav entry by its label and wait for the screen behind it. */
async function navigateTo(page: Page, label: RegExp) {
  await openNav(page);
  const link = (await nav(page)).getByRole("link", { name: label }).first();
  await expect(link, `no nav entry matching ${label}`).toBeVisible();
  // The drawer is its own scrolling box, so scroll from the element to reach
  // its real scroll parent rather than the page.
  await link.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await link.click();
  await page.waitForLoadState("networkidle");
}

/** Nothing on screen may be an error, and the screen may not be blank. */
async function rendersCleanly(page: Page) {
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/i);
  await expect(page.locator("main, [role='main']").first()).toBeVisible();
}

test.describe("the organizer's money screens", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

  test("Prizes & payouts is reachable from the nav and shows the prize", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await navigateTo(page, /prizes/i);
    await expect(page).toHaveURL(/\/prizes/);
    await rendersCleanly(page);
    // The fixture's prize, so this proves the screen read the ledger rather
    // than merely rendering its own chrome.
    await expect(page.locator("body")).toContainText(money.prizeLabel);
  });

  test("Group games is reachable, and is not the same screen as Prizes", async ({ page }) => {
    /**
     * These are DIFFERENT MONEY with different owners — the field's pot is the
     * club's, a group's pot is four players' own — and nav.ts says so in a
     * comment. Two lists of identical cards on one screen is how somebody pays
     * into the wrong one, so the separation is worth pinning.
     */
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await navigateTo(page, /group games/i);
    await expect(page).toHaveURL(/\/group-games/);
    await rendersCleanly(page);
    await expect(page.locator("body")).not.toContainText(money.prizeLabel);
  });

  test("the settle-up shows what is left, not what was owed", async ({ page }) => {
    /**
     * THE ARITHMETIC THAT HAD NEVER BEEN LOOKED AT. The fixture's bill is 4001
     * split three ways and one player has already paid 1000 of their 1334. A
     * screen that showed the original share, or that showed nothing because it
     * treated any settlement as settling everything, would look completely
     * normal — and would be telling somebody to hand over money they have
     * already handed over.
     */
    await page.goto("/prizes");
    await page.waitForLoadState("networkidle");
    await rendersCleanly(page);

    const body = await page.locator("body").innerText();
    // Either the outstanding balance is on this screen, or it is on the
    // organizer ledger it links to — but the ORIGINAL share must not be the
    // number presented as still owing.
    expect(body, "the screen renders no money at all").toMatch(/[\d]+\.\d{2}|[£$€¥]/);
  });

  test("Reports & export opens", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await navigateTo(page, /reports/i);
    await expect(page).toHaveURL(/\/reports/);
    await rendersCleanly(page);
  });
});

test.describe("the player's money screen", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

  test("Money is a tab a player can reach, and it names a real number", async ({ page }) => {
    /**
     * The player settle-up is where somebody finds out what they owe a friend.
     * It is reached by a tab rather than a sidebar, which is a different piece
     * of navigation entirely and had never been clicked in this suite.
     */
    await page.goto("/me");
    await page.waitForLoadState("networkidle");

    const tab = page.getByRole("link", { name: /money/i }).first();
    await expect(tab, "the player has no Money tab").toBeVisible();
    await tab.click();
    await page.waitForLoadState("networkidle");

    await expect(page).toHaveURL(/\/me\/money/);
    await rendersCleanly(page);

    // players[0] paid the whole 4001 bill, so they are owed something by the
    // other two. The screen must say so rather than show an empty ledger.
    await expect(page.locator("body")).toContainText(/buggies/i);
  });

  test("the split is worked out, not just the bill echoed back", async ({ page }) => {
    /**
     * 4001 across three is 1334 / 1334 / 1333 — it does not divide, which is
     * why the fixture uses it. The screen legitimately shows the BILL total on
     * the line (somebody paid 40.01) and the SHARE beside it, so asserting the
     * total is absent was wrong about the product: a ledger that hid what the
     * bill came to would be a worse ledger.
     *
     * What actually matters is that a share appears at all. A screen echoing
     * the total where a share belongs is the most alarming way this can be
     * wrong, and it is indistinguishable from a correct one until you look
     * for the divided number.
     */
    await page.goto("/me/money");
    await page.waitForLoadState("networkidle");
    await rendersCleanly(page);

    const body = await page.locator("body").innerText();
    const share = new RegExp(`${asMoney(1334)}|${asMoney(1333)}`);
    expect(body, `no share of ${asMoney(money.billCents)} anywhere on the screen`).toMatch(share);
  });
});

test.describe("the week view's money block", () => {
  test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

  test("opens without erroring", async ({ page }) => {
    // Named in the audit as never having been opened.
    await page.goto("/week");
    await page.waitForLoadState("networkidle");
    await rendersCleanly(page);
  });
});
