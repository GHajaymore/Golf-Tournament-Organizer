import { test, expect } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seedDoorsClub, removeDoorsClub, groupLink } from "./doors-fixture";

/**
 * THE COMMITTEE STOPS PLAY, AND EVERYBODY IS TOLD (Rule 5.7).
 *
 * Lightning. The secretary presses one button, and what matters is not that
 * the button works but who finds out: the player with the app open on the 7th
 * fairway, the one who opens it a minute later, and the families watching the
 * public board. And then that all of them are told when it is safe again —
 * a suspension nobody can lift is worse than none.
 *
 * Until 2026-10-13 no browser test pressed that button. `suspendPlay`,
 * `resumePlay` and `currentPlayStatus` were three of the 184 actions the first
 * measured round found nothing performing (88 of 272 were). They had unit
 * tests of their words. Nothing had checked that the words reach a screen.
 *
 * What is done here, each step read back from somewhere other than the screen
 * that did it:
 *
 *   the secretary suspends, with a reason   → the row is stamped, and the log says who
 *   a member's OPEN screen                   → shows it without being reloaded
 *   a member who opens the app afterwards    → is told on arrival
 *   the public board, signed out             → says so too
 *   the secretary resumes                    → all three are clear, and the log says so
 *
 * And the control: before any of it, none of the three says play is suspended
 * — a banner that is always there would pass every line above.
 *
 * WHAT IT CANNOT SEE: the notification on a locked phone, and the siren. Those
 * need a real device; this is the screens.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; shareToken: string };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const REASON = "Lightning in the area";
const prisma = new PrismaClient();

/** The fixture is shared by every spec after this one: play is never left suspended, whatever happened above. */
async function playOn() {
  await prisma.event.update({ where: { id: data.eventId }, data: { playSuspendedAt: null, playSuspendedNote: "" } });
}

test.afterAll(async () => {
  await playOn();
  await prisma.$disconnect();
});

test("the secretary suspends play; an open phone, a phone opened later and the public board all say so; and resuming clears them", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  await playOn();
  const errors: string[] = [];
  const device = testInfo.project.use;

  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  const latecomer = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  const family = await browser.newContext({ ...device, baseURL, storageState: undefined });
  try {
    const console_ = await organizer.newPage();
    const open = await member.newPage();
    const board = await family.newPage();
    for (const p of [console_, open, board]) watchPageErrors(p, errors);

    const banner = (page: typeof open) => page.getByRole("alert").filter({ hasText: "Play is suspended" });
    const stop = `${REASON}. Stop now and don't play another shot until the`;

    // ── before: nobody is told anything ─────────────────────────────────────
    await open.goto(`/me?bust=${Date.now()}`);
    await open.waitForLoadState("networkidle").catch(() => {});
    await expect(open.locator("h1").first()).toBeVisible();
    await board.goto(`/live/${data.shareToken}?bust=${Date.now()}`);
    await expect(board.locator("h1").first()).toBeVisible();
    await expect(banner(open), "CONTROL: a member is told play is suspended before anybody suspended it").toHaveCount(0);
    await expect(banner(board), "CONTROL: the public board says so before anybody suspended it").toHaveCount(0);

    // ── the secretary stops play ────────────────────────────────────────────
    await console_.goto(`/dashboard?bust=${Date.now()}`);
    await console_.waitForLoadState("networkidle").catch(() => {});
    await console_.getByRole("button", { name: "Suspend play" }).click();
    await console_.getByLabel("Reason (optional)").fill(REASON);
    await console_.getByRole("button", { name: "Suspend play now" }).click();
    await expect(console_.getByRole("alert").filter({ hasText: "Play is suspended" }), "the dashboard does not say play is suspended").toBeVisible({ timeout: 20_000 });
    await expect(console_.getByRole("button", { name: "Resume play" }), "suspended, with no way back on the screen").toBeVisible();

    const stamped = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playSuspendedAt: true, playSuspendedNote: true } });
    expect(stamped.playSuspendedAt, "the tournament is not marked suspended").not.toBeNull();
    expect(stamped.playSuspendedNote).toBe(REASON);
    const logged = await prisma.auditLog.findFirst({ where: { eventId: data.eventId, action: "play-suspended" }, orderBy: { createdAt: "desc" } });
    expect(logged?.detail, "the log does not say play was suspended, or why").toBe(`Play suspended: ${REASON}`);
    expect(logged?.actor, "the log does not say who suspended play").toBeTruthy();

    // ── the member whose screen was already open: told without touching it ──
    // The screen asks every twenty seconds. Nothing here reloads it.
    await expect(banner(open), "an open player screen never noticed that play was suspended").toBeVisible({ timeout: 45_000 });
    await expect(banner(open)).toContainText(stop);

    // ── the member who opens the app afterwards, on any tab ─────────────────
    const late = await latecomer.newPage();
    watchPageErrors(late, errors);
    for (const tab of ["/me", "/me/card", "/me/board"]) {
      await late.goto(`${tab}?bust=${Date.now()}`);
      await expect(banner(late), `${tab} does not tell a member that play is suspended`).toBeVisible({ timeout: 20_000 });
      await expect(banner(late)).toContainText(stop);
    }

    // ── the public board ────────────────────────────────────────────────────
    await board.goto(`/live/${data.shareToken}?bust=${Date.now()}`);
    await expect(banner(board), "the public board does not say play is suspended").toBeVisible({ timeout: 20_000 });
    await expect(banner(board)).toContainText(REASON);

    // ── and it is lifted ────────────────────────────────────────────────────
    // Resume confirms (#1149 C3): an accidental resume sends the field back into the hazard.
    await console_.getByRole("button", { name: "Resume play", exact: true }).click();
    await expect(console_.getByText("Players will be told to play on"), "Resume did not ask first").toBeVisible();
    expect(
      (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playSuspendedAt: true } })).playSuspendedAt,
      "the first press of Resume lifted the suspension without its confirm",
    ).not.toBeNull();
    await console_.getByRole("button", { name: "Resume play now" }).click();
    await expect(console_.getByRole("button", { name: "Suspend play" }), "after resuming, the dashboard still shows play suspended").toBeVisible({ timeout: 20_000 });
    const lifted = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playSuspendedAt: true, playSuspendedNote: true } });
    expect(lifted.playSuspendedAt, "the tournament is still marked suspended").toBeNull();
    expect(lifted.playSuspendedNote).toBe("");
    expect(
      await prisma.auditLog.count({ where: { eventId: data.eventId, action: "play-resumed", createdAt: { gte: logged!.createdAt } } }),
      "the log does not say play was resumed",
    ).toBeGreaterThan(0);

    await expect(banner(open), "an open player screen still says play is suspended after it was resumed").toHaveCount(0, { timeout: 45_000 });
    await late.goto(`/me?bust=${Date.now()}`);
    await expect(late.locator("h1").first()).toBeVisible();
    await expect(banner(late), "a member opening the app is still told play is suspended").toHaveCount(0);
    await board.goto(`/live/${data.shareToken}?bust=${Date.now()}`);
    await expect(board.locator("h1").first()).toBeVisible();
    await expect(banner(board), "the public board still says play is suspended").toHaveCount(0);

    expect(errors, "a screen threw while play was suspended or resumed").toEqual([]);
  } finally {
    await Promise.all([organizer, member, latecomer, family].map((c) => c.close()));
  }
});

/**
 * FROM WHEREVER THE ORGANIZER IS STANDING, IN TWO PRESSES (simplicity cut 2,
 * 2026-11-14; Rule 5.7).
 *
 * Suspend play was on the dashboard only: from the tee sheet in a storm that
 * was the menu, Home, Suspend play, Suspend play now — 4 presses — and
 * resuming took the organizer off the sheet. The console's shell draws it on
 * every screen now, once. Here the organizer, on a phone, stands on the tee
 * sheet and stops play with exactly two presses (the button, then the
 * confirm), the banner and Resume play are on every console screen walked,
 * the dashboard draws ONE control, not two, and resuming is two presses (it
 * confirms: #1149 C3) that leave the organizer where they were. Scrolled down
 * the sheet, the button is still in view (sticky). Each step is read back
 * from the row.
 */
test("the organizer on a phone suspends play from the tee sheet in two presses, sees it on every console screen, and resumes where they stand", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  await playOn();
  const errors: string[] = [];
  const organizer = await browser.newContext({
    ...testInfo.project.use,
    baseURL,
    storageState: ORGANIZER,
    viewport: { width: 393, height: 851 },
    hasTouch: true,
    // A save on WebKit that the service worker sends is not the page's (G411-3): the presses here are saves.
    serviceWorkers: "block",
  });
  const member = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: PLAYER, serviceWorkers: "block" });
  try {
    const page = await organizer.newPage();
    watchPageErrors(page, errors, "the organizer's phone");
    const banner = page.getByRole("alert").filter({ hasText: "Play is suspended" });
    const suspendButton = page.getByRole("button", { name: "Suspend play", exact: true });
    let presses = 0;
    const press = async (name: string) => {
      await page.getByRole("button", { name, exact: true }).click();
      presses++;
    };

    // ── the tee sheet, with play on: the button is there, no banner ─────────
    await page.goto(`/foursomes?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const sheet = new URL(page.url()).pathname;
    expect(sheet, "the tee sheet sent the organizer somewhere else").toBe("/foursomes");
    await expect(suspendButton, "Suspend play is not on the tee sheet").toBeVisible({ timeout: 20_000 });
    await expect(banner, "CONTROL: the tee sheet says play is suspended before anybody suspended it").toHaveCount(0);

    // ── scrolled down the sheet, the button is still in view, and not under the top bar ─
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const scrolled = await page.evaluate(() => window.scrollY);
    await expect(suspendButton, `scrolled ${scrolled}px down the tee sheet, Suspend play is out of view`).toBeInViewport();
    const bar = await page.locator(".m-topbar").boundingBox();
    const button = await suspendButton.boundingBox();
    if (bar && button) expect(button.y, "Suspend play is under the phone's top bar").toBeGreaterThanOrEqual(bar.y + bar.height - 1);

    // ── two presses ─────────────────────────────────────────────────────────
    await press("Suspend play");
    await page.getByLabel("Reason (optional)").fill(REASON);
    await press("Suspend play now");
    await expect(banner, "the tee sheet does not say play is suspended").toBeVisible({ timeout: 20_000 });
    expect(presses, "suspending play took more than the button and its confirm").toBe(2);
    expect(new URL(page.url()).pathname, "suspending play took the organizer off the tee sheet").toBe(sheet);
    const stamped = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playSuspendedAt: true, playSuspendedNote: true } });
    expect(stamped.playSuspendedAt, "the tournament is not marked suspended").not.toBeNull();
    expect(stamped.playSuspendedNote).toBe(REASON);

    // ── every console screen carries the banner and the way back, once ──────
    for (const screen of ["/entry", "/leaderboard", "/dashboard", "/registration"]) {
      await page.goto(`${screen}?bust=${Date.now()}`);
      await expect(banner, `${screen} does not say play is suspended`).toBeVisible({ timeout: 20_000 });
      await expect(banner, `${screen} draws the banner more than once`).toHaveCount(1);
      await expect(banner).toContainText(REASON);
      await expect(page.getByRole("button", { name: "Resume play", exact: true }), `${screen} has no way back`).toHaveCount(1);
    }

    // ── a player is never offered it ────────────────────────────────────────
    const me = await member.newPage();
    watchPageErrors(me, errors, "a member's phone");
    await me.goto(`/me?bust=${Date.now()}`);
    await expect(me.getByRole("alert").filter({ hasText: "Play is suspended" }), "CONTROL: the member is not told").toBeVisible({ timeout: 20_000 });
    await expect(me.getByRole("button", { name: "Resume play" }), "a player is offered Resume play").toHaveCount(0);

    // ── resumed in two presses (it confirms, #1149 C3), from the tee sheet, staying on it ─
    await page.goto(`/foursomes?bust=${Date.now()}`);
    await expect(banner).toBeVisible({ timeout: 20_000 });
    const before = new URL(page.url()).pathname;
    presses = 0;
    await press("Resume play");
    await expect(page.getByText("Players will be told to play on")).toBeVisible();
    await press("Resume play now");
    expect(presses, "resuming took more than the button and its confirm").toBe(2);
    await expect(suspendButton, "after resuming, the tee sheet still shows play suspended").toBeVisible({ timeout: 20_000 });
    await expect(banner).toHaveCount(0);
    expect(new URL(page.url()).pathname, "resuming took the organizer off the tee sheet").toBe(before);
    const lifted = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playSuspendedAt: true } });
    expect(lifted.playSuspendedAt, "the tournament is still marked suspended").toBeNull();

    // ── and the dashboard draws one Suspend play, not its own beside the shell's ─
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(suspendButton, "the dashboard lost Suspend play").toBeVisible({ timeout: 20_000 });
    await expect(suspendButton, "the dashboard draws Suspend play twice").toHaveCount(1);

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await playOn();
    await Promise.all([organizer, member].map((c) => c.close()));
  }
});

/**
 * A SECOND STAFF DEVICE IS TOLD, WITHOUT A RELOAD (review of #1149, C2).
 *
 * The control lives in the console's LAYOUT, and a layout is not drawn again
 * when somebody moves between its screens through the menu. So a second staff
 * member with the console open when the first suspends — the starter on the
 * tee sheet while the TD presses it in the office — went on seeing "Suspend
 * play" and no banner on every screen the menu took them to, and after a
 * resume, a stale banner whose Resume could lift the NEXT storm. Here device
 * B only ever moves by the sidebar's links (client navigations: a marker on
 * `window` proves no page was reloaded), and must see each change device A
 * makes within the frame's 20-second refresh, plus slack.
 *
 * On #1149's first head (17cb8a0d, no `PlayStatusFrame`) this fails at the
 * first wait: B's layout keeps the state it was loaded with.
 */
test("a second staff device sees a suspension and a resume after moving by the menu, without a reload", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  await playOn();
  const errors: string[] = [];
  const desk = { ...testInfo.project.use, baseURL, storageState: ORGANIZER, viewport: { width: 1280, height: 860 }, serviceWorkers: "block" as const };
  const a = await browser.newContext(desk);
  const b = await browser.newContext(desk);
  try {
    const office = await a.newPage();
    const starter = await b.newPage();
    watchPageErrors(office, errors, "device A");
    watchPageErrors(starter, errors, "device B");
    const bannerOn = (p: typeof starter) => p.getByRole("alert").filter({ hasText: "Play is suspended" });
    const menu = (path: string) => starter.locator(`.app-sidebar a[href^="${path}"]`).first();

    // ── B opens the tee sheet once, with play on, and never reloads after ────
    await starter.goto(`/foursomes?bust=${Date.now()}`);
    await expect(starter.getByRole("button", { name: "Suspend play", exact: true })).toBeVisible({ timeout: 20_000 });
    await starter.evaluate(() => ((window as unknown as { __noReload: number }).__noReload = 1));
    const stillTheSamePage = () => starter.evaluate(() => (window as unknown as { __noReload?: number }).__noReload === 1);

    // ── A suspends ──────────────────────────────────────────────────────────
    await office.goto(`/dashboard?bust=${Date.now()}`);
    await office.getByRole("button", { name: "Suspend play", exact: true }).click();
    await office.getByLabel("Reason (optional)").fill(REASON);
    await office.getByRole("button", { name: "Suspend play now" }).click();
    await expect(bannerOn(office)).toBeVisible({ timeout: 20_000 });

    // ── B moves by the menu, and is told ────────────────────────────────────
    await menu("/entry").click();
    await starter.waitForURL(/\/entry/, { timeout: 20_000 });
    await expect(bannerOn(starter), "device B, moved by the menu, was never told play is suspended").toBeVisible({ timeout: 30_000 });
    await expect(bannerOn(starter)).toContainText(REASON);
    expect(await stillTheSamePage(), "B's page was reloaded, so this proves nothing about a client navigation").toBe(true);

    // ── A resumes; B moves by the menu again, and the stale banner goes ─────
    await office.getByRole("button", { name: "Resume play", exact: true }).click();
    await office.getByRole("button", { name: "Resume play now" }).click();
    await expect(bannerOn(office)).toHaveCount(0, { timeout: 20_000 });
    await menu("/leaderboard").click();
    await starter.waitForURL(/\/leaderboard/, { timeout: 20_000 });
    await expect(bannerOn(starter), "device B still shows a banner (and a Resume) after play resumed").toHaveCount(0, { timeout: 30_000 });
    await expect(starter.getByRole("button", { name: "Suspend play", exact: true })).toBeVisible();
    expect(await stillTheSamePage(), "B's page was reloaded").toBe(true);

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await playOn();
    await Promise.all([a, b].map((c) => c.close()));
  }
});

/**
 * AND THE PHONE WITH A ROUND CODE (2026-11-14, safety sweep G-1).
 *
 * `/play` is the phone a group's scorer keeps the whole group's card on, and
 * the door a player with no email is sent to. It drew no banner and its open
 * screen was never told: a group could play on through lightning. Its own
 * club (`doors-fixture.ts`, a cup session on a round code), so the suspension
 * here touches nobody else's screen; the press itself is the test above, so
 * here the committee's row is written directly and what is checked is that
 * the phone FINDS OUT — without being reloaded — and is told when it is over.
 */
test("a round-code phone on /play is told play is suspended without a reload, and told when it resumes", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const club = await seedDoorsClub(prisma, "zz-suspend-code", { visibility: "participants", rounds: 1 });
  const errors: string[] = [];
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const stop = (on: boolean) =>
    prisma.event.update({ where: { id: club.event }, data: on ? { playSuspendedAt: new Date(), playSuspendedNote: REASON } : { playSuspendedAt: null, playSuspendedNote: "" } });
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, "a round-code phone");
    const banner = page.getByRole("alert").filter({ hasText: "Play is suspended" });
    const r = club.rounds[0];
    await page.goto(groupLink(r.code, r.match));
    await page.getByRole("button", { name: "Yes, that's my group" }).click({ timeout: 30_000 });
    const card = page.getByRole("group", { name: /^Who won hole/ }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(banner, "CONTROL: /play says play is suspended before anybody suspended it").toHaveCount(0);

    // ── the committee stops play; the open card is not touched ─────────────
    await stop(true);
    await expect(banner, "an open /play screen never noticed that play was suspended").toBeVisible({ timeout: 45_000 });
    await expect(banner).toContainText(`${REASON}. Stop now and don't play another shot until the`);
    await expect(card, "the card went away when the banner came").toBeVisible();

    // ── the code holder's board says so too ────────────────────────────────
    await page.goto(`/play/board?bust=${Date.now()}`);
    await expect(banner, "/play/board does not tell a code holder that play is suspended").toBeVisible({ timeout: 30_000 });
    await page.goto(`/play?bust=${Date.now()}`);
    await expect(banner, "a round-code phone opened during the suspension is not told").toBeVisible({ timeout: 30_000 });

    // ── and play resumes ───────────────────────────────────────────────────
    await stop(false);
    await expect(banner, "an open /play screen still says play is suspended after it was resumed").toHaveCount(0, { timeout: 45_000 });
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
    await removeDoorsClub(prisma, club);
  }
});
