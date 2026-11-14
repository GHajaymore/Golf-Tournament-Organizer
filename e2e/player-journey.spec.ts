import { randomBytes, scryptSync } from "node:crypto";
import { test, expect, type Browser, type BrowserContext, type Page, type TestInfo } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession, type Club } from "./rounds-fixture";
import { clubToday } from "../src/lib/domain/club-clock";
import { watchPageErrors } from "./page-errors";
import { landingSettled } from "./landing-settled";
import { journey, projectTag, ceilingBreaches, type Journey } from "./journey";

/**
 * A PLAYER'S ROUND, MEASURED (work plan row 0b; Ajay, 14 Nov: "I am keep telling to simplify the things
 * while setting up or as a player").
 *
 * Four journeys, walked as the player walks them, through the screens and nothing else, and counted by
 * the same counter as the secretary's (`e2e/journey.ts`: screens, visits, returns, presses, boxes,
 * characters, seconds at the panel's pace):
 *
 *   J4  player-member             signed in on their own phone: opens the app (Today) → their card →
 *                                 scores hole 1 → the Board, where their name stands
 *   J4b player-member-signed-out  the same member on a browser the app has not seen, signed out: opens
 *                                 the app's link → is asked to log in (address, password) → Today →
 *                                 card → hole 1 → Board
 *   J6  player-guest              no email, no app (J39/J40): opens the personal player link the
 *                                 organizer handed over → "Open my card" → Today → card → hole 1 → Board
 *   J5  player-card-18            a whole card on ONE BAR OF SIGNAL (every save held two seconds at the
 *                                 network, as `slow-signal-scoring.spec.ts` holds them): a realistic
 *                                 88 for a 14.2 index, in playing order, signed, and the final standing
 *
 * Each prints one `JOURNEY {…}` line (with its ceiling and target) and its step list, and asserts the
 * ceiling in `journey-budgets.ts` (the ratchet: a journey that grows fails here).
 *
 * The way to the card is the one the screen offers first: the Today's own button to the card when it
 * draws one, the "My card" tab when it does not — and the step list says which was pressed.
 *
 * SLOW NETWORK: J5 delays every card save by two seconds with `page.route`, which every engine honours
 * the same way. Playwright's bandwidth throttling (CDP) is Chromium's alone, so it is not used: a WebKit
 * or Firefox run of the same spec would measure a different network.
 *
 * WHAT IS NOT COUNTED: the organizer handing the guest their link (Entries → Player link → Show QR) is
 * the organizer's job, done here as setup in its own browser. A hole is "scored" when the card the
 * server holds has it (read from the database — not a press, and not a screen). In J5 a press that had
 * to wait for a save is not counted separately: the pad never disables for a save, so there is none.
 *
 * Fixture facts are read from the fixture: the members are the entries `makeEvent` made, the guest the
 * row made here (standing "guest", no email), the pars the event's own card; the round is played on the
 * club's today (`clubToday(ZONE)`), with a published tee sheet putting everybody in a group. Service
 * workers are blocked in every context (a save spec, for WebKit). Memory: at most three browser
 * contexts at once (organizer, a player, a visitor), one page each, about 450 MB.
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against the markup of the
 * player shell (PlayTabs, /me, /me/card's HoleByHoleCard and PlayerCard, /me/board), LoginPanel,
 * PlayerLinkPanel and PlayerLinkOpener; CI runs it.
 */

const ZONE = "UTC";
const GUEST = "Robin Calloway-Marsh";
// A test value for this app only, generated here — see CLAUDE.md on fixtures.
const PASSWORD = "Larch-Fairway-Nine-27";

/** A 14.2 index's 88, against par, hole by hole: one birdie, five pars, eight bogeys, three doubles, and an 8 on a par 4. */
const CARD_88: number[] = [1, 0, 1, 2, 0, 1, -1, 4, 1, 0, 1, 2, 1, 0, 1, 1, 2, 0];

const stem = (project: string) => `zz-journey-player-${projectTag(project)}`;

/** The app's own stored shape (`hashPassword` in lib/auth.ts): "salt:hash", scrypt, hex. */
function hashed(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

async function phone(browser: Browser, baseURL: string, testInfo: TestInfo): Promise<BrowserContext> {
  return browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
}

const sections = (page: Page) => page.getByRole("navigation", { name: "Sections" });
const visible = (page: Page, css: string) => page.locator(css).locator("visible=true").first();

/** The pad's word for a score against par — HoleByHoleCard's `nameFor`, read off the button. */
function padWord(rel: number, par: number): string | null {
  if (par + rel === 1) return "Ace";
  const words: Record<number, string> = { [-2]: "Eagle", [-1]: "Birdie", 0: "Par", 1: "Bogey", 2: "Double", 3: "+3" };
  return words[rel] ?? null;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * From Today to the card, the way the screen offers first: the Today's own button to the card
 * ("Start my card") when it draws one, otherwise the "My card" tab. The step list says which.
 */
async function toTheCard(walk: Journey, page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const onToday = page.locator("main").getByRole("link", { name: /my card/i }).first();
  if (await onToday.isVisible().catch(() => false)) {
    const words = (await onToday.innerText()).replace(/\s+/g, " ").trim();
    await walk.press(onToday, `“${words}” on Today`);
  } else {
    await walk.press(sections(page).getByRole("link", { name: /My card/ }), "the “My card” tab");
  }
  await page.waitForURL(/\/me\/card/, { timeout: 30_000 });
}

/** The holes the server holds for this card. */
async function holesIn(stageId: string, playerId: string): Promise<number> {
  const card = await prisma.scorecard.findFirst({ where: { stageId, playerId }, select: { strokes: true } });
  return card ? (JSON.parse(card.strokes) as (number | null)[]).filter((n) => n != null).length : 0;
}

/** Hole 1 at par, on the card that is open, and on the server. */
async function scoreOneHole(walk: Journey, page: Page, stageId: string, playerId: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByText("Hole", { exact: true })).toBeVisible({ timeout: 20_000 });
  const par = page.getByRole("button", { name: /Par$/ }).first();
  await expect(par).toBeEnabled({ timeout: 30_000 });
  await walk.press(par, "“Par” for hole 1");
  await expect.poll(() => holesIn(stageId, playerId), { timeout: 30_000, message: "the hole never reached the server" }).toBe(1);
  walk.note("the hole is on the server");
}

/** The Board tab, and the player's own name on it. What the line around the name says goes in the step list. */
async function seeWhereTheyStand(walk: Journey, page: Page, name: string) {
  await walk.press(sections(page).getByRole("link", { name: /Board/ }), "the “Board” tab");
  await page.waitForURL(/\/me\/board/, { timeout: 30_000 });
  const main = page.locator("main");
  await expect(main, "the player's own name is not on their Board").toContainText(name, { timeout: 20_000 });
  walk.stop();
  const text = (await main.innerText()).replace(/\s+/g, " ");
  const at = text.indexOf(name);
  const around = at < 0 ? "" : text.slice(Math.max(0, at - 12), at + name.length + 24).trim();
  walk.note(`sees where they stand: “${around}”`);
}

/** The figures printed, and the ceiling held (the ratchet). */
async function reportAndHold(walk: Journey, testInfo: TestInfo) {
  const f = await walk.report(testInfo);
  const over = ceilingBreaches(f);
  expect(over, over.join("\n")).toEqual([]);
  return f;
}

test.describe("a player's round, measured", () => {
  let club: Club;
  let mark = "";
  let eventId = "";
  let stageId = "";
  let pars: number[] = [];
  const players: { id: string; name: string; email: string }[] = [];
  let guestId = "";

  test.beforeAll(async ({}, testInfo) => {
    mark = stem(testInfo.project.name);
    await dropClub(mark);
    club = await makeClub(mark, { timeZone: ZONE });
    const made = await makeEvent(club, "Spring Outing", {
      status: "live",
      stages: [{ playedOn: clubToday(ZONE), scoringBasis: "gross" }],
      players: 4,
      event: { playerAccess: "both", scoreEntryBy: "players" },
    });
    eventId = made.event.id;
    stageId = made.stages[0].id;
    // The fixture's card and entries, as the fixture made them.
    pars = JSON.parse(made.event.customPars ?? "[]") as number[];
    players.length = 0;
    for (const p of made.players) players.push({ id: p.id, name: p.name, email: p.email });
    const guest = await prisma.player.create({
      data: { eventId, name: GUEST, email: "", standing: "guest", handicap: 14.2, seed: 5, status: "confirmed" },
    });
    guestId = guest.id;
    await prisma.stage.update({
      where: { id: stageId },
      data: {
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "8:10 AM", playerIds: [players[0].id, players[1].id, guestId] },
            { name: "Group 2", startHole: 1, time: "8:20 AM", playerIds: [players[2].id, players[3].id] },
          ],
        }),
      },
    });
  });
  test.afterAll(async () => {
    try {
      if (mark) await dropClub(mark);
    } finally {
      await prisma.$disconnect();
    }
  });
  // A press that cannot land fails in seconds and says where.
  test.use({ actionTimeout: 20_000, navigationTimeout: 60_000 });

  test("J4: a MEMBER opens the app, scores one hole and sees where they stand", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const member = players[0];
    const { session } = await memberSession(eventId, member.email, member.name);
    const ctx = await phone(browser, baseURL!, testInfo);
    try {
      await signInWith(ctx, baseURL!, session, eventId);
      const page = await ctx.newPage();
      watchPageErrors(page, errors, "member");
      const walk = journey(page, "player-member");
      walk.start();

      await page.goto("/me");
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
      walk.note("opens the app, signed in: Today");
      await toTheCard(walk, page);
      await scoreOneHole(walk, page, stageId, member.id);
      await seeWhereTheyStand(walk, page, member.name);

      const f = await reportAndHold(walk, testInfo);
      // CONTROL: the counter saw the walk — three screens at least (Today, the card, the Board).
      expect(f.screens, `the counter missed screens: ${f.route.join(" → ")}`).toBeGreaterThanOrEqual(3);
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("J6: a GUEST opens their player link, scores one hole and sees where they stand", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];

    // SETUP, not counted: the organizer makes the guest's link on Entries and hands it over.
    let code = "";
    const desk = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    try {
      await signIn(desk, baseURL!, club, eventId);
      const d = await desk.newPage();
      watchPageErrors(d, errors, "organizer");
      await d.goto(`/registration?bust=${Date.now()}`);
      await d.waitForLoadState("networkidle").catch(() => {});
      const button = d.getByRole("button", { name: `Player link for ${GUEST}`, exact: true });
      await button.scrollIntoViewIfNeeded();
      if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
      const panel = d.locator("[data-player-link]");
      await expect(panel.getByTestId("player-link-status")).not.toHaveText("Checking…", { timeout: 20_000 });
      await panel.getByRole("button", { name: "Show QR", exact: true }).click();
      const shown = panel.getByTestId("player-link-code");
      await expect(shown).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, { timeout: 20_000 });
      code = (await shown.innerText()).replace(/-/g, "");
    } finally {
      await desk.close();
    }

    // THE GUEST's phone: no account, no app — the link, tapped from the message it came in.
    const ctx = await phone(browser, baseURL!, testInfo);
    try {
      const page = await ctx.newPage();
      watchPageErrors(page, errors, "guest");
      const walk = journey(page, "player-guest");
      walk.start();

      await page.goto(`/p#${code}`);
      walk.note("opens the player link the organizer sent");
      const open = page.getByRole("button", { name: "Open my card" });
      await expect(open).toBeEnabled({ timeout: 20_000 });
      await walk.press(open, "“Open my card”");
      await page.waitForURL(/\/me$/, { timeout: 30_000 });
      await expect(page.getByTestId("guest-event")).toBeVisible({ timeout: 20_000 });
      await toTheCard(walk, page);
      await scoreOneHole(walk, page, stageId, guestId);
      await seeWhereTheyStand(walk, page, GUEST);

      const f = await reportAndHold(walk, testInfo);
      // CONTROL: the counter saw the walk — four screens at least (the link, Today, the card, the Board).
      expect(f.screens, `the counter missed screens: ${f.route.join(" → ")}`).toBeGreaterThanOrEqual(4);
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("J4b: a MEMBER, signed out on a new browser, opens the app's link, logs in, scores one hole and sees where they stand", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const member = players[2];
    // They entered through the sign-up link two weeks ago: an account with a proved address and a password.
    await prisma.user.create({ data: { email: member.email, name: member.name, password: hashed(PASSWORD), emailVerifiedAt: new Date() } });
    await prisma.account.create({ data: { eventId, name: member.name, email: member.email, role: "player" } });

    const ctx = await phone(browser, baseURL!, testInfo);
    try {
      const page = await ctx.newPage();
      watchPageErrors(page, errors, "member, signed out");
      const walk = journey(page, "player-member-signed-out");
      walk.start();

      // The app's address, from the club's message, on a browser with no cookies at all.
      await page.goto("/me");
      await landingSettled(page);
      walk.note("opens the app's link, signed out: asked to log in");
      const tab = page.getByRole("tab", { name: "Log in", exact: true }).locator("visible=true").first();
      if ((await tab.count()) && (await tab.getAttribute("aria-selected")) !== "true") await walk.press(tab, "the “Log in” tab");
      await walk.type(visible(page, "#login-email"), member.email, "Email");
      await walk.type(page.getByPlaceholder("Your password").locator("visible=true").first(), PASSWORD, "Password");
      await walk.press(page.getByRole("button", { name: "Log in", exact: true }).locator("visible=true").first(), "“Log in”");
      await page.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      // Wherever the log-in lands, the person goes on from there: Today is where they were going.
      if (new URL(page.url()).pathname !== "/me") {
        await walk.press(sections(page).getByRole("link", { name: /Today/ }), "the “Today” tab");
        await page.waitForURL(/\/me$/, { timeout: 30_000 });
      }
      await toTheCard(walk, page);
      await scoreOneHole(walk, page, stageId, member.id);
      await seeWhereTheyStand(walk, page, member.name);

      const f = await reportAndHold(walk, testInfo);
      // CONTROL: the counter saw the log-in — two boxes typed into at least.
      expect(f.boxes, "the counter missed the log-in").toBeGreaterThanOrEqual(2);
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("J5: a whole card on one bar of signal, signed, and the final standing", async ({ browser, baseURL }, testInfo) => {
    // A player on a course holds a phone: walked at phone size, where the pad is drawn as they see it.
    test.skip(testInfo.project.name !== "phone", "walked at phone size: the card on the course");
    test.setTimeout(420_000);
    const errors: string[] = [];
    const member = players[1];
    expect(pars, "the fixture's card has no eighteen pars").toHaveLength(18);
    const { session } = await memberSession(eventId, member.email, member.name);
    const ctx = await phone(browser, baseURL!, testInfo);
    try {
      await signInWith(ctx, baseURL!, session, eventId);
      const page = await ctx.newPage();
      watchPageErrors(page, errors, "member, eighteen holes");
      // ONE BAR: every save takes two seconds to leave.
      await page.route("**/me/card**", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await new Promise((r) => setTimeout(r, 2_000));
        await route.continue().catch(() => {});
      });
      // The chooser ("Use theirs / Keep mine") must never be shown: nobody else touched this card.
      let choosers = 0;
      let watching = true;
      const watch = (async () => {
        let shown = false;
        while (watching) {
          const now = (await page.getByRole("alertdialog").count().catch(() => 0)) > 0;
          if (now && !shown) choosers += 1;
          shown = now;
          await page.waitForTimeout(150).catch(() => {});
        }
      })();

      const walk = journey(page, "player-card-18");
      walk.start();
      await page.goto("/me");
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
      walk.note("opens the app, signed in: Today");
      await toTheCard(walk, page);
      await expect(page.getByText("Hole", { exact: true })).toBeVisible({ timeout: 20_000 });

      for (const [i, rel] of CARD_88.entries()) {
        const hole = i + 1;
        const par = pars[i];
        const strokes = par + rel;
        const box = page.getByLabel(`Strokes on hole ${hole}`, { exact: true });
        // The card moves on by itself after a tap; if it has not, the person presses Next.
        let onIt = true;
        try {
          await expect(box).toBeVisible({ timeout: 3_000 });
        } catch {
          onIt = false;
        }
        if (!onIt) await walk.press(page.getByRole("group", { name: "Holes" }).getByRole("button", { name: /Next/ }), "“Next”");
        await expect(box, `the card is not on hole ${hole}`).toBeVisible({ timeout: 10_000 });
        const word = padWord(rel, par);
        if (word) {
          const pad = page.getByRole("button", { name: new RegExp(`^${strokes}\\s*${escape(word)}$`) });
          await expect(pad).toBeEnabled({ timeout: 20_000 });
          await walk.press(pad, `“${strokes} ${word}” for hole ${hole}`);
        } else {
          // Off the pad: typed into Other, and Enter to go on.
          await walk.type(box, String(strokes), `Other, for hole ${hole}`);
          await walk.key(box, "Enter", `Enter, for hole ${hole}`);
        }
      }
      await expect.poll(() => holesIn(stageId, member.id), { timeout: 60_000, message: "the card's eighteen holes never all reached the server" }).toBe(18);
      walk.note("all eighteen holes are on the server");

      const sign = page.getByRole("button", { name: "Certify my card" });
      await expect(sign, "a complete card cannot be signed").toBeEnabled({ timeout: 30_000 });
      await walk.press(sign, "“Certify my card”");
      await expect
        .poll(async () => (await prisma.scorecard.findFirst({ where: { stageId, playerId: member.id }, select: { status: true } }))?.status, {
          timeout: 60_000,
          message: "the card was not certified",
        })
        .toBe("certified");
      walk.note("the card is certified on the server");
      await seeWhereTheyStand(walk, page, member.name);
      watching = false;
      await watch;
      walk.note(`was shown the “which card is right?” chooser ${choosers} times`);

      const f = await reportAndHold(walk, testInfo);
      expect(choosers, "a player keeping their own card was asked which card was right").toBe(0);
      const stored = await prisma.scorecard.findFirst({ where: { stageId, playerId: member.id }, select: { strokes: true } });
      const total = (JSON.parse(stored?.strokes ?? "[]") as (number | null)[]).reduce<number>((a, b) => a + (b ?? 0), 0);
      // CONTROL: the card the server holds is the card that was walked.
      expect(total, "the stored card is not the 88 that was entered").toBe(pars.reduce((a, b) => a + b, 0) + CARD_88.reduce((a, b) => a + b, 0));
      expect(f.presses, "the counter missed holes").toBeGreaterThanOrEqual(18);
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
