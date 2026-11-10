import { createHmac } from "node:crypto";
import { test, expect } from "./coverage";
import type { Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { pressRadio } from "./press-radio";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * AN ARCHIVED TOURNAMENT'S CONSOLE IS READ-ONLY IN ONE PLACE (2026-11-09; the tournament
 * director and the UX designer on the panel; `domain/archive-read-only.ts`).
 *
 * A lapsed club's tournament refuses every change, and about 140 staff actions THREW that
 * refusal into the error screen. Rather than teach each one, the console's layout wraps
 * every screen of an archived tournament in `ArchiveReadOnly`, which disables each control
 * that writes. This walks three working screens — Rounds & formats, Registration, the tee
 * sheet — as the club's owner and holds, on each:
 *
 *   - the archive's sentence is shown ONCE, at the top (the layout's banner);
 *   - at least one control is disabled (so the next check is not passing on an empty screen);
 *   - NO control is left pressable except the ones that only change the view — a disclosure,
 *     a tab, a search box, or one marked `data-reads` (a print, an export, a round picker).
 *
 * Then a link inside a locked screen still navigates, and the banner's way out — Your plan,
 * in Club settings — opens a screen the archive does NOT lock.
 *
 * Marked zz-, invented names, one club per screen size, deleted afterwards.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

const SENTENCE = /This club.s subscription ended on .+, so this tournament is paused where it stands\./;

/** The controls in the locked screen: how many are disabled, and which are still pressable that should not be. */
async function controlsOf(page: Page): Promise<{ disabled: number; pressable: string[] }> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-archive-read-only]");
    if (!root) return { disabled: 0, pressable: ["no read-only wrapper on this screen"] };
    const all = [...root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("button, input, select, textarea")];
    // The view-only exceptions, as the rule states them (`archiveLeavesLive`).
    const viewOnly = (el: Element) =>
      el.closest("[data-reads]") !== null ||
      el.closest("[data-new-tournament]") !== null ||
      // On a locked screen the tournament's own part is locked like the rest, so it is no exception here.
      el.getAttribute("role") === "tab" ||
      (el.tagName === "BUTTON" && el.hasAttribute("aria-expanded")) ||
      (el.tagName === "INPUT" && (el.getAttribute("type") ?? "").toLowerCase() === "search");
    return {
      disabled: all.filter((el) => el.disabled).length,
      pressable: all.filter((el) => !el.disabled && !viewOnly(el)).map((el) => el.outerHTML.slice(0, 140)),
    };
  });
}

test("an archived tournament's working screens are read-only, say why once, and keep their links", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-archive-ro-${size}@example.invalid`;
  const ids = { user: "", org: "", event: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `zz-archive-ro club ${size}` } });
    const lapsedAt = new Date(Math.floor((Date.now() - 86_400_000) / 1000) * 1000);
    const user = await prisma.user.create({ data: { email, name: "Zz Archive Reader", password: "x:unusable" } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `zz-archive-ro club ${size}`,
        kind: "club",
        timeZone: "Europe/London",
        locale: "en-GB",
        subscription: {
          create: {
            plan: "free", status: "canceled", provider: "stripe", providerCustomerId: `cus_zz_archro_${size}`,
            providerSubscriptionId: `sub_zz_archro_${size}`, planTermsApply: true, lapsedAt, currentPeriodEnd: lapsedAt,
          },
        },
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const event = await prisma.event.create({
      data: {
        organizationId: org.id, name: `zz-archive-ro league ${size}`, dates: "Sundays", course: "Home", city: "", address: "", regDeadline: "",
        status: "live", shape: "series", shareToken: `zz-archive-ro-${size}-${Date.now()}`, archivedAt: lapsedAt, launchedAt: new Date(),
        customPars: JSON.stringify(new Array(18).fill(4)), customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    ids.event = event.id;
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } });
    for (const [i, name] of ["Zz Ada Fernsby", "Zz Bram Oakhurst", "Zz Cleo Marrow"].entries()) {
      await prisma.player.create({ data: { eventId: event.id, name, email: `zz-archive-ro-${i}-${size}@example.invalid`, seed: i + 1, status: "confirmed" } });
    }
    await prisma.account.create({ data: { eventId: event.id, email, name: "Zz Archive Reader", role: "admin" } });
    await ctx.addCookies([
      { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(event.id), url: baseURL! },
    ]);

    const page = await ctx.newPage();
    watchPageErrors(page, errors);
    /** A link inside a locked screen, to press once the walk is done. */
    let link: { screen: string; href: string } | null = null;

    for (const [screen, name] of [["/stages", "Rounds & formats"], ["/registration", "Registration"], ["/foursomes", "Tee sheet"]] as const) {
      await page.goto(`${screen}?bust=${Date.now()}`);
      const banner = page.locator("[data-archive-banner]");
      await expect(banner, `${name} does not say the tournament is read-only`).toBeVisible({ timeout: 30_000 });
      await expect(banner, `${name} says the archive more than once`).toHaveCount(1);
      await expect(banner).toContainText(SENTENCE);
      await expect(page.locator("[data-archive-read-only]"), `${name} is not wrapped read-only`).toHaveCount(1);
      // Disabled after the screen comes alive (the lock is applied as it hydrates), so polled.
      await expect.poll(async () => (await controlsOf(page)).disabled, { message: `${name}: no control was disabled`, timeout: 20_000 }).toBeGreaterThan(0);
      await expect.poll(async () => (await controlsOf(page)).pressable, { message: `${name}: a control that writes is still pressable`, timeout: 20_000 }).toEqual([]);
      await expect(page.getByText("This screen didn't load"), `${name} showed the error screen`).toHaveCount(0);

      if (!link) {
        const href = await page
          .locator('[data-archive-read-only] a[href^="/"]:not([download]):not([target]):not([href^="/api"])')
          .evaluateAll(
            (as, here) =>
              as
                .filter((a) => a.getClientRects().length > 0)
                .map((a) => a.getAttribute("href") ?? "")
                .find((h) => h.split(/[?#]/)[0] !== here) ?? null,
            screen,
          );
        if (href) link = { screen, href };
      }
    }

    // A link is not a control: one inside a locked screen still goes where it says.
    expect(link, "none of the three screens drew a link to follow").not.toBeNull();
    await page.goto(`${link!.screen}?bust=${Date.now()}`);
    await page.locator(`[data-archive-read-only] a[href="${link!.href}"]:visible`).first().click();
    await expect(page, `the link to ${link!.href} did not navigate`).toHaveURL(new RegExp(link!.href.split(/[?#]/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), { timeout: 20_000 });

    // The way out: Your plan, in Club settings, is not locked.
    await page.goto(`/stages?bust=${Date.now()}`);
    await page.locator("[data-archive-banner]").getByRole("link", { name: "Go to Your plan" }).click();
    await expect(page).toHaveURL(/\/organization/, { timeout: 20_000 });
    await expect(page.locator("[data-archive-read-only]"), "Club settings, where the way out is, was locked").toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
  }
});

/**
 * WHAT ONLY CHANGES THE VIEW STAYS LIVE, ON THE SCREENS PEOPLE READ (the Opus re-check,
 * 2026-11-10): the board's Overall / By flight, and a flighted knockout's choice of flight,
 * were locked with everything else — so an archive showed one flight and no way to the next.
 * Here a lapsed club holds two archived tournaments: a medal in two flights, and a knockout
 * drawn in two flights. On each the view control is ENABLED and pressing it CHANGES what is
 * shown. Then the medal is taken out of the archive, and its board draws no read-only wrapper.
 */
test("in an archive the board's flights and a knockout's flights can still be switched, and a live tournament is not wrapped", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const size = testInfo.project.name.replace(/[^a-z]/gi, "").toLowerCase();
  const email = `zz-archive-views-${size}@example.invalid`;
  const ids = { user: "", org: "", medal: "", knockout: "" };
  const errors: string[] = [];
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.organization.deleteMany({ where: { name: `zz-archive-views club ${size}` } });
    const lapsedAt = new Date(Math.floor((Date.now() - 86_400_000) / 1000) * 1000);
    const user = await prisma.user.create({ data: { email, name: "Zz Archive Viewer", password: "x:unusable" } });
    ids.user = user.id;
    const org = await prisma.organization.create({
      data: {
        name: `zz-archive-views club ${size}`,
        kind: "club",
        timeZone: "Europe/London",
        locale: "en-GB",
        subscription: {
          create: {
            plan: "free", status: "canceled", provider: "stripe", providerCustomerId: `cus_zz_archviews_${size}`,
            providerSubscriptionId: `sub_zz_archviews_${size}`, planTermsApply: true, lapsedAt, currentPeriodEnd: lapsedAt,
          },
        },
        members: { create: { userId: user.id, role: "owner" } },
      },
    });
    ids.org = org.id;
    const card = {
      customPars: JSON.stringify(new Array(18).fill(4)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    };

    // The medal: one round, two flights of two, every card in.
    const medal = await prisma.event.create({
      data: {
        organizationId: org.id, name: `zz-archive-views medal ${size}`, dates: "", course: "Home", city: "", address: "", regDeadline: "",
        status: "live", shape: "series", shareToken: `zz-archive-views-m-${size}-${Date.now()}`, archivedAt: lapsedAt, launchedAt: new Date(), ...card,
      },
    });
    ids.medal = medal.id;
    const round = await prisma.stage.create({ data: { eventId: medal.id, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } });
    const flightA = await prisma.group.create({ data: { eventId: medal.id, name: "Flight A", position: 0 } });
    const flightB = await prisma.group.create({ data: { eventId: medal.id, name: "Flight B", position: 1 } });
    for (const [i, [name, groupId]] of ([["Zz Ada Fernsby", flightA.id], ["Zz Bram Oakhurst", flightA.id], ["Zz Cleo Marrow", flightB.id], ["Zz Dov Ellery", flightB.id]] as const).entries()) {
      const p = await prisma.player.create({ data: { eventId: medal.id, name, email: `zz-archive-views-m${i}-${size}@example.invalid`, seed: i + 1, status: "confirmed", groupId } });
      await prisma.scorecard.create({
        data: { eventId: medal.id, stageId: round.id, playerId: p.id, strokes: JSON.stringify(new Array(18).fill(4 + (i % 2))), status: "approved", approvedBy: "zz", approvedAt: new Date() },
      });
    }
    await prisma.account.create({ data: { eventId: medal.id, email, name: "Zz Archive Viewer", role: "admin" } });

    // The knockout: drawn in two flights of two.
    const knockout = await prisma.event.create({
      data: {
        organizationId: org.id, name: `zz-archive-views knockout ${size}`, dates: "", course: "Home", city: "", address: "", regDeadline: "",
        status: "live", shape: "knockout", format: "match", bracketMode: "flights", shareToken: `zz-archive-views-k-${size}-${Date.now()}`,
        archivedAt: lapsedAt, launchedAt: new Date(), ...card,
      },
    });
    ids.knockout = knockout.id;
    await prisma.stage.create({ data: { eventId: knockout.id, position: 0, type: "Bracket Stage", format: "Match Play", scoringBasis: "gross", holes: 18 } });
    const ko: string[] = [];
    for (const [i, name] of ["Zz Elm Hartley", "Zz Fern Coyle", "Zz Gale Pruett", "Zz Holt Varney"].entries()) {
      const p = await prisma.player.create({ data: { eventId: knockout.id, name, email: `zz-archive-views-k${i}-${size}@example.invalid`, seed: i + 1, status: "confirmed", handicap: i * 2 } });
      ko.push(p.id);
    }
    await prisma.event.update({
      where: { id: knockout.id },
      data: { bracketDraw: JSON.stringify({ v: 2, criterion: "handicap", flights: [{ name: "Flight A", playerIds: ko.slice(0, 2) }, { name: "Flight B", playerIds: ko.slice(2) }] }) },
    });
    await prisma.account.create({ data: { eventId: knockout.id, email, name: "Zz Archive Viewer", role: "admin" } });

    const open = async (eventId: string, path: string) => {
      await ctx.addCookies([
        { name: "ng_session", value: sign(signedInNow(user.id)), url: baseURL! },
        { name: "ng_active_event", value: sign(eventId), url: baseURL! },
      ]);
      await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
      // Pressed only once the screen is alive: a radio pressed before its script has arrived proves nothing.
      await page.waitForLoadState("networkidle").catch(() => {});
    };
    const page = await ctx.newPage();
    watchPageErrors(page, errors);

    // The board: locked, and its Overall / By flight still switches the view.
    await open(medal.id, "/leaderboard");
    await expect(page.locator("[data-archive-banner]"), "the board does not say it is read-only").toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-archive-read-only]"), "the board is not wrapped read-only").toHaveCount(1);
    // The lock has run (a writing control is disabled) before the view control is judged.
    await expect.poll(async () => (await controlsOf(page)).pressable, { message: "/leaderboard: a control that writes is still pressable", timeout: 20_000 }).toEqual([]);
    const byFlight = page.getByRole("radio", { name: "By flight" });
    await expect(byFlight, "the board's By flight was locked in an archive").toBeEnabled({ timeout: 15_000 });
    const tables = page.locator("[data-archive-read-only] table");
    const before = await tables.count();
    await pressRadio(byFlight);
    await expect.poll(() => tables.count(), { message: "By flight did not change the board", timeout: 15_000 }).toBeGreaterThan(before);
    await expect(page.getByText("Flight B", { exact: true }).first()).toBeVisible();

    // The knockout's draw: locked, and its choice of flight still shows the next flight.
    await open(knockout.id, "/bracket?view=draw");
    await expect(page.locator("[data-archive-read-only]"), "the bracket is not wrapped read-only").toHaveCount(1, { timeout: 30_000 });
    await expect.poll(async () => (await controlsOf(page)).pressable, { message: "/bracket: a control that writes is still pressable", timeout: 20_000 }).toEqual([]);
    const flightBDraw = page.getByRole("radio", { name: /Flight B/ });
    await expect(flightBDraw, "the knockout's choice of flight was locked in an archive").toBeEnabled({ timeout: 15_000 });
    await expect(page.getByText("Zz Gale Pruett").first(), "Flight B's draw showed before it was chosen").toBeHidden();
    await pressRadio(flightBDraw);
    await expect(page.getByText("Zz Gale Pruett").first(), "choosing Flight B did not show its draw").toBeVisible({ timeout: 15_000 });

    // Out of the archive, the same board draws no read-only wrapper and no banner.
    await prisma.event.update({ where: { id: medal.id }, data: { archivedAt: null } });
    await open(medal.id, "/leaderboard");
    await expect(page.getByText("Zz Ada Fernsby").first(), "the live board did not load").toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-archive-read-only]"), "a live tournament's screen was wrapped read-only").toHaveCount(0);
    await expect(page.locator("[data-archive-banner]"), "a live tournament said it was read-only").toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close().catch(() => {});
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
    for (const id of [ids.medal, ids.knockout]) if (id) await prisma.event.deleteMany({ where: { id } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});
