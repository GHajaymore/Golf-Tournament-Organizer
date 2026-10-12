import { test, expect, type Page, type BrowserContext } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * ONE PHONE, TWO PEOPLE — AND ONE PERSON, TWO TAPS (2026-10-11).
 *
 * The service worker answered every in-app page request from its cache first,
 * keyed by address alone (`public/sw.js`). So:
 *
 *   - a member who took over a phone and tapped Money was shown the last
 *     member's money, their card, their "YOU" on the board;
 *   - anybody opening the app saw the first tab they tapped as it was the LAST
 *     time they opened the app.
 *
 * WHY NOTHING SAW IT, which is the part to keep: every spec in this suite
 * opens a screen with `page.goto` — a whole document, which the worker never
 * answered from its cache. A player does not type addresses. They TAP A TAB,
 * which is a page-data request, and those always came from the cache. So this
 * spec moves the way a thumb does, and compares what is on the screen with
 * what that person is shown in a clean browser that has no worker at all.
 *
 * The first reading of this — mine, the same night — called it safe, because
 * it looked for a NAME on the screen instead of comparing the screen. A money
 * page names the other people in the pot; whose page it is, is in the figures.
 *
 * The fix is that the worker keeps nobody's pages at all (it never managed to
 * open a tab with no signal, which was the point of keeping them). Its rules
 * are unit-tested with a fake cache and network in
 * `the-worker-keeps-nobodys-pages-for-somebody-else.test.ts`. This is the real
 * one, in a real browser, against the built app.
 */

const cookiesOf = (who: "organizer" | "player") =>
  JSON.parse(readFileSync(join(process.cwd(), ".e2e", `${who}.json`), "utf8")).cookies as Array<Record<string, unknown>>;
const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };

/** The screens a player moves between with their thumb, and that say something about THEM. */
const SCREENS = ["/me/card", "/me/board"];

const mainText = async (page: Page) => (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();

/** Tap a link in the shell, the way a thumb does — an in-app navigation, not a new document. */
async function tap(page: Page, href: string) {
  const link = page.locator(`a[href="${href}"]`).first();
  await expect(link, `no link to ${href} on ${new URL(page.url()).pathname}`).toBeVisible();
  await link.click();
  await page.waitForURL((u) => u.pathname === href, { timeout: 15_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** A signed-in phone whose pages the service worker is answering. */
async function phoneFor(context: BrowserContext, who: "organizer" | "player"): Promise<Page> {
  await context.addCookies(cookiesOf(who) as never);
  const page = await context.newPage();
  await page.goto("/me");
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20_000 });
  // Once more, now that the worker is in charge of this page's requests.
  await page.goto("/me");
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}

test.describe("a phone that changes hands", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "one phone: the worker is the same at every width");
  });

  test("the second person is shown their own screens, by tapping, with and without signal", async ({ browser, baseURL }) => {
    test.setTimeout(180_000);

    // What the ORGANIZER is really shown — a clean browser with no worker.
    const clean = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 }, serviceWorkers: "block" });
    await clean.addCookies(cookiesOf("organizer") as never);
    const cleanPage = await clean.newPage();
    const theirs: Record<string, string> = {};
    for (const screen of SCREENS) {
      await cleanPage.goto(screen);
      await cleanPage.waitForLoadState("networkidle").catch(() => {});
      theirs[screen] = await mainText(cleanPage);
    }
    await clean.close();

    // The phone, in the PLAYER's hands first. They tap through their screens.
    const phone = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 } });
    const page = await phoneFor(phone, "player");
    const players: Record<string, string> = {};
    for (const screen of SCREENS) {
      await tap(page, screen);
      players[screen] = await mainText(page);
    }
    // CONTROL: the two people's screens really differ, or nothing below means anything.
    for (const screen of SCREENS) {
      expect(players[screen], `${screen} reads the same for both people — the fixture cannot show a mix-up`).not.toBe(theirs[screen]);
    }

    // The phone is handed over: the player signs out, the organizer signs in.
    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 20_000 });
    await phone.addCookies(cookiesOf("organizer") as never);
    await page.goto("/me");
    await page.waitForLoadState("networkidle").catch(() => {});

    for (const screen of SCREENS) {
      await tap(page, screen);
      const shown = await mainText(page);
      expect(shown, `${screen}: the last person's screen was shown to the next`).not.toBe(players[screen]);
      expect(shown, `${screen}: not what this person is shown in a clean browser`).toBe(theirs[screen]);
    }

    // And with no signal, a tab must not be answered with the player's copy.
    // Nothing at all is the right answer; the last person's screen is not.
    await tap(page, "/me");
    await phone.setOffline(true);
    try {
      // One tap. With no signal the app may give way to the browser's own "no
      // connection" page, and there is then no second tab to tap — every wait
      // here is short, or a missing link would sit out the whole test.
      const screen = SCREENS[0];
      await page.locator(`a[href="${screen}"]`).first().click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const shown = await page
        .locator("body")
        .innerText({ timeout: 5_000 })
        .then((t) => t.replace(/\s+/g, " "), () => "");
      expect(players[screen].length, "the player's screen was never read").toBeGreaterThan(20);
      expect(shown.includes(players[screen]), `${screen}, no signal: the last person's screen`).toBe(false);
    } finally {
      await phone.setOffline(false);
    }
    await phone.close();
  });

  test("the cookies are simply swapped — no sign-out, no log-in screen — and it is still their own", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    // The route that does NOT pass the log-in screen: a reset link, a restored
    // session. The shell itself has to say whose pages these are.
    const clean = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 }, serviceWorkers: "block" });
    await clean.addCookies(cookiesOf("organizer") as never);
    const cleanPage = await clean.newPage();
    await cleanPage.goto("/me/card");
    await cleanPage.waitForLoadState("networkidle").catch(() => {});
    const theirs = await mainText(cleanPage);
    await clean.close();

    const phone = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 } });
    const page = await phoneFor(phone, "player");
    await tap(page, "/me/card");
    const players = await mainText(page);
    expect(players).not.toBe(theirs);

    await phone.clearCookies();
    await phone.addCookies(cookiesOf("organizer") as never);
    await page.goto("/me");
    await page.waitForLoadState("networkidle").catch(() => {});
    await tap(page, "/me/card");
    expect(await mainText(page)).toBe(theirs);
    await phone.close();
  });
});

test.describe("one person, opening the app again", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "one phone: the worker is the same at every width");
  });

  test("sees a tab as it is now, not as it was the last time they opened the app", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const prisma = new PrismaClient();
    const event = await prisma.event.findUnique({ where: { id: data.eventId }, select: { name: true } });
    expect(event, "the fixture's tournament is not in the database").not.toBeNull();
    const before = event!.name;
    const after = `${before} (moved)`;
    const phone = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 } });
    try {
      const page = await phoneFor(phone, "player");
      await tap(page, "/me/events");
      await expect(page.locator("main")).toContainText(before);
      await expect(page.locator("main")).not.toContainText(after);

      // Something changes at the club, and they open the app again later —
      // a fresh document, the same first tap. The old worker answered that tap
      // with the copy it filed the LAST time the app was opened.
      await prisma.event.update({ where: { id: data.eventId }, data: { name: after } });
      await page.goto("/me");
      await page.waitForLoadState("networkidle").catch(() => {});
      await tap(page, "/me/events");
      // Read once, at once: a copy that corrects itself a moment later was
      // still shown to somebody.
      expect(await mainText(page), "the tab was answered with the copy from last time").toContain(after);
    } finally {
      await prisma.event.update({ where: { id: data.eventId }, data: { name: before } });
      await prisma.$disconnect();
      await phone.close();
    }
  });
});
