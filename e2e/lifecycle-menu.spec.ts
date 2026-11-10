import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { statusFixture, prisma } from "./status-fixture";
import { clubToday } from "../src/lib/domain/club-clock";
import { addDays } from "../src/lib/domain/round-dates";

/**
 * THE MENU FOLLOWS THE LIFECYCLE, OPENED AS AN ORGANIZER OPENS IT (the console structure review,
 * 9 Nov; step 2). Behind the stepper's switch: `?stepper=1` while it is off.
 *
 * The organizer of a two-day medal opens the console twice — as it is today, and with the preview —
 * and the two menus are read off the screen:
 *
 *   switch off      the menu as it was: no stops, no "Event", every link plain
 *   switch on       four stops in the stepper's order and words — Set up · Tee times · Play · Results —
 *                   under "Event"; the stop it marks is the one the stepper marks
 *   nothing lost    every address the old menu offered is offered by the new one, and every one of
 *                   them OPENS (200, no bounce) — asked of the server for each, pressed for the ones
 *                   that moved beneath another entry
 *   it stays on     a press in the menu keeps the preview: the next screen has the same menu
 *
 * A knockout's second stop reads "Draw", with its Bracket beneath Tee times & draw.
 *
 * On a phone the menu is the drawer behind "Menu"; the same checks are made there. On the club's
 * clock (`clubToday(zone)`; the club takes `E2E_TZ` when a run sets it).
 *
 * WHAT IT CANNOT SEE: one shape at a time. Every role, shape, setting and family is held to "nothing
 * lost" by `nav-lifecycle.test.ts`. Nothing is saved here, so no service worker is in play.
 * Memory: one context, one page, light.
 */

const ZONE = process.env.E2E_TZ || "America/New_York";

/** The menu on this screen size: the sidebar, or the phone's drawer (opened). */
async function menuOf(page: Page): Promise<Locator> {
  // "Open menu", exactly: the drawer's own "Close menu" would match a looser name (money-nav.spec.ts).
  const opener = page.getByRole("button", { name: "Open menu" });
  if (await opener.isVisible().catch(() => false)) {
    await opener.click();
    const drawer = page.locator(".m-drawer");
    await expect(drawer).toBeVisible();
    // The drawer slides in over 220ms (`drawer-in`); a press inside that window lands on the backdrop.
    await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined)).catch(() => undefined);
    return drawer;
  }
  const side = page.locator("aside.app-sidebar nav");
  await expect(side).toBeVisible();
  return side;
}

/** Every address the menu's entries open, as written (the console's own screens only). */
async function linksOf(menu: Locator): Promise<string[]> {
  return menu.locator("a.side-link").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
}

const plain = (href: string) => href.replace(/[?&]stepper=1/, "");

async function noSidewaysScroll(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${where} scrolls sideways`).toBeLessThanOrEqual(0);
}

test("with the switch on the menu is the stepper's four stops, and every old destination is still there and opens", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const today = clubToday(ZONE);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "menu",
    event: { dates: "A two-day medal", startOn: addDays(today, 1), endOn: addDays(today, 2) },
    rounds: [
      { type: "Stroke Play Round", format: "Stroke Play", playedOn: addDays(today, 1) },
      { type: "Stroke Play Round", format: "Stroke Play", playedOn: addDays(today, 2) },
    ],
  });
  try {
    await prisma.organization.update({ where: { id: f.orgId }, data: { timeZone: ZONE } });
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    // SWITCH OFF: the menu as it was.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    let menu = await menuOf(page);
    await expect(menu.locator("[data-nav-stop]"), "the old menu has no stops").toHaveCount(0);
    await expect(menu.locator("[data-nav-scope]")).toHaveCount(0);
    const before = await linksOf(menu);
    expect(before.length, "the old menu was not read").toBeGreaterThan(15);
    expect(before.filter((h) => h.includes("stepper")), "the old menu's links are plain").toEqual([]);
    for (const old of ["Dashboard", "Tournament details", "Entries", "Tee sheet", "Reports & export"]) {
      await expect(menu.getByRole("link", { name: old, exact: true }), `the old menu lost "${old}"`).toBeVisible();
    }

    // SWITCH ON: four stops, the stepper's, in its order — under "Event".
    await page.goto("/dashboard?stepper=1");
    const stepper = page.getByRole("region", { name: "Where this tournament is" });
    await expect(stepper).toBeVisible();
    menu = await menuOf(page);
    const stops = menu.locator("[data-nav-stop]");
    await expect(stops).toHaveCount(4);
    expect(await stops.evaluateAll((els) => els.map((e) => e.getAttribute("data-nav-stop")))).toEqual(["setup", "draw", "day", "after"]);
    for (const [i, word] of ["Set up", "Tee times", "Play", "Results"].entries()) {
      await expect(stops.nth(i).locator("[data-nav-heading]"), `stop ${i + 1}`).toContainText(new RegExp(`^${word}`, "i"));
    }
    await expect(menu.locator("[data-nav-scope]")).toHaveText(/^event$/i);
    // The stepper names the same four, in the same order.
    await expect(stepper.locator(".ls-phase-title")).toHaveText(["Set up", "Tee times", "Play", "Results"]);
    // Setting up, ready to launch: the stepper is on Launch, and the menu marks Set up.
    await expect(stepper.locator('[aria-current="step"]')).toContainText("Launch");
    await expect(menu.locator('[data-nav-stop] > [aria-current="step"]')).toHaveCount(1);
    await expect(menu.locator('[data-nav-stop="setup"] > [aria-current="step"]')).toContainText(/set up/i);

    // The decided entries, and what is grouped beneath them.
    for (const entry of ["Home", "Messages", "Event details", "Rounds & formats", "Players", "Prizes & side games", "Tee times & draw", "Score entry", "Leaderboard", "Results", "Money & payouts", "Events", "Members", "Courses", "Seasons & honours", "Club settings", "Guide & rules"]) {
      await expect(menu.getByRole("link", { name: entry, exact: true }), `the menu has no "${entry}"`).toBeVisible();
    }
    for (const beneath of ["Announcements", "Entries", "Flights", "Print kit", "Side games", "Member history", "Staff & helpers", "How TourneyHQ works", "Rules reference"]) {
      await expect(menu.getByRole("link", { name: beneath, exact: true }), `"${beneath}" is not in the menu`).toBeVisible();
    }

    // NOTHING LOST: every address the old menu offered is offered now, every link keeps the preview…
    const after = await linksOf(menu);
    expect(after.filter((h) => !h.includes("stepper=1")), "a link that drops the preview").toEqual([]);
    const offered = new Set(after.map(plain));
    expect(before.filter((h) => !offered.has(h)), "screens the old menu reached and this one does not").toEqual([]);
    // …and fewer doors do it: the grouped screens sit beneath an entry (marked so by the drawing itself,
    // not inferred from an icon), and the two kinds add up to every link drawn.
    const topLevel = await menu.locator("a.side-link:not([data-nav-beneath])").count();
    const beneathCount = await menu.locator("a.side-link[data-nav-beneath]").count();
    expect(beneathCount, "nothing was grouped beneath an entry").toBeGreaterThan(0);
    expect(topLevel + beneathCount).toBe(after.length);
    expect(topLevel, "the menu did not get shorter").toBeLessThan(before.length);
    expect(topLevel).toBeLessThanOrEqual(18);
    // On a phone the three tabs keep the preview on too.
    const tabs = page.locator("nav.m-tabbar a.m-tab");
    if (await tabs.first().isVisible().catch(() => false)) {
      const tabHrefs = await tabs.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      expect(tabHrefs.length, "the phone has no tabs").toBeGreaterThan(0);
      expect(tabHrefs.filter((h) => !h.includes("stepper=1")), "a tab that drops the preview").toEqual([]);
    }
    await noSidewaysScroll(page, "the dashboard, menu open");

    // …and every one of them OPENS for this organizer, on the screen it opened before: asked of the
    // server with the switch off and on (a bounce to another screen would answer 200 too, so the
    // address it lands on is read as well).
    for (const href of before) {
      const off = await page.request.get(href);
      const on = await page.request.get(`${href}?stepper=1`);
      expect(on.status(), `${href} did not open`).toBe(200);
      expect(new URL(on.url()).pathname, `${href} lands somewhere else with the menu on`).toBe(new URL(off.url()).pathname);
      expect(new URL(on.url()).pathname, `${href} bounced to the sign-in or the chooser`).not.toMatch(/^\/(sign-in|login|choose)/);
    }

    // PRESSED: a screen that moved beneath another entry opens, is marked as here, and the preview stays on.
    await menu.getByRole("link", { name: "Flights", exact: true }).click();
    await expect(page).toHaveURL(/\/grouping\?stepper=1$/);
    await expect(page.getByRole("region", { name: "Where this tournament is" })).toBeVisible();
    menu = await menuOf(page);
    await expect(menu.locator("[data-nav-stop]")).toHaveCount(4);
    await expect(menu.locator('a.side-link[aria-current="page"]')).toHaveText("Flights");
    await menu.getByRole("link", { name: "Print kit", exact: true }).click();
    await expect(page).toHaveURL(/\/print\?stepper=1$/);
    menu = await menuOf(page);
    // Two doors to one screen, one mark: Entries, beneath Players.
    await menu.getByRole("link", { name: "Players", exact: true }).click();
    await expect(page).toHaveURL(/\/registration\?stepper=1$/);
    menu = await menuOf(page);
    await expect(menu.locator('a.side-link[aria-current="page"]')).toHaveText("Entries");

    // LAUNCHED, the tee sheet not out: the stepper moves to the Tee times stop, and so does the menu's mark.
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "live", launchedAt: new Date(), configUnlocked: false } });
    await page.goto("/dashboard?stepper=1");
    await expect(page.getByRole("region", { name: "Where this tournament is" }).locator('[aria-current="step"]')).toContainText("Tee sheet");
    menu = await menuOf(page);
    await expect(menu.locator('[data-nav-stop] > [aria-current="step"]')).toHaveCount(1);
    await expect(menu.locator('[data-nav-stop="draw"] > [aria-current="step"]')).toContainText(/tee times/i);

    expect(errors).toEqual([]);
  } finally {
    await f.done();
  }
});

test("a knockout's second stop reads Draw, with its bracket beneath Tee times & draw", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const today = clubToday(ZONE);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "menu-ko",
    // A knockout as the app makes one (status-knockout.spec.ts): its shape and its one bracket, not only its round.
    event: { dates: "A knockout", startOn: addDays(today, 3), endOn: addDays(today, 3), shape: "knockout", qualifyMode: "overall", qualifyOverall: 8, bracketMode: "single" },
    rounds: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross", playedOn: addDays(today, 3) }],
    players: 8,
  });
  try {
    await prisma.organization.update({ where: { id: f.orgId }, data: { timeZone: ZONE } });
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    await page.goto(`/dashboard?bust=${Date.now()}`);
    let menu = await menuOf(page);
    const before = await linksOf(menu);
    expect(before, "a knockout's old menu has its Bracket").toContain("/bracket");

    await page.goto("/dashboard?stepper=1");
    const stepper = page.getByRole("region", { name: "Where this tournament is" });
    await expect(stepper.locator(".ls-phase-title")).toHaveText(["Set up", "Draw", "Play", "Results"]);
    menu = await menuOf(page);
    await expect(menu.locator('[data-nav-stop="draw"] [data-nav-heading]')).toContainText(/^draw/i);
    const offered = new Set((await linksOf(menu)).map(plain));
    expect(before.filter((h) => !offered.has(h)), "screens the old menu reached and this one does not").toEqual([]);
    await menu.getByRole("link", { name: "Bracket", exact: true }).click();
    await expect(page).toHaveURL(/\/bracket\?stepper=1$/);

    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
