import { test, expect, type Browser, type BrowserContext, type Page, type TestInfo } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession, type Club } from "./rounds-fixture";
import { clubToday } from "../src/lib/domain/club-clock";
import { watchPageErrors } from "./page-errors";
import { journey, type Journey } from "./journey";

/**
 * A PLAYER'S FIRST HOLE, MEASURED (work plan row 0b, steps 1 and 3's measuring half; Ajay, 14 Nov:
 * "I am keep telling to simplify the things while setting up or as a player").
 *
 * Two journeys, walked as the player walks them, through the screens and nothing else, and counted by
 * the same counter as the secretary's first event (`e2e/journey.ts`: distinct screens, presses,
 * characters typed, seconds at the panel's pace):
 *
 *   MEMBER  signed in on their own phone: opens the app (Today) → their card → scores hole 1 →
 *           the Board, where their name stands
 *   GUEST   no email, no app (J39/J40): opens the personal player link the organizer handed over →
 *           "Open my card" → their card → scores hole 1 → the Board, where their name stands
 *
 * Each prints one `JOURNEY {…}` line and its step list (`JOURNEY-STEP …`), for the persona panel.
 * The way to the card is the one the screen offers first: the Today's own button to the card when it
 * draws one, the "My card" tab when it does not — and the step list says which was pressed.
 *
 * WHAT IS NOT COUNTED: the organizer handing the guest their link (Entries → Player link → Show QR) is
 * the organizer's job, done here as setup in its own browser; the guest's journey starts with the link
 * in their hand. A hole is "scored" when the card the server holds has it (read from the database —
 * not a press, and not a screen).
 *
 * NO BUDGET YET: this measures and prints. The place each budget goes is marked "BUDGET".
 *
 * Fixture facts are read from the fixture: the member is the first entry `makeEvent` made, the guest
 * the row made here (standing "guest", no email); the round is played on the club's today
 * (`clubToday(ZONE)`), with a published tee sheet putting both in Group 1. Service workers are blocked
 * in every context (a save spec, for WebKit). Memory: at most three browser contexts at once
 * (organizer, member, guest), one page each, about 450 MB.
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against the markup of the
 * player shell (PlayTabs, /me, /me/card, /me/board), PlayerLinkPanel and PlayerLinkOpener, and the
 * steps `a-guest-takes-full-part.spec.ts` presses; CI runs it.
 */

const ZONE = "UTC";
const GUEST = "Robin Calloway-Marsh";
const TEE_TIME = "8:10 AM";

const stem = (project: string) => `zz-journey-player-${project}`;

async function phone(browser: Browser, baseURL: string, testInfo: TestInfo): Promise<BrowserContext> {
  return browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
}

const sections = (page: Page) => page.getByRole("navigation", { name: "Sections" });

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

/** Hole 1 at par, on the card that is open, and on the server. */
async function scoreOneHole(walk: Journey, page: Page, stageId: string, playerId: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByText("Hole", { exact: true })).toBeVisible({ timeout: 20_000 });
  const par = page.getByRole("button", { name: /Par$/ }).first();
  await expect(par).toBeEnabled({ timeout: 30_000 });
  await walk.press(par, "“Par” for hole 1");
  await expect
    .poll(
      async () => {
        const card = await prisma.scorecard.findFirst({ where: { stageId, playerId }, select: { strokes: true } });
        return card ? (JSON.parse(card.strokes) as (number | null)[]).filter((n) => n != null).length : 0;
      },
      { timeout: 30_000, message: "the hole never reached the server" },
    )
    .toBe(1);
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

test.describe("a player's first hole, measured", () => {
  let club: Club;
  let mark = "";
  let eventId = "";
  let stageId = "";
  let member = { id: "", name: "", email: "" };
  let guestId = "";

  test.beforeAll(async ({}, testInfo) => {
    mark = stem(testInfo.project.name);
    await dropClub(mark);
    club = await makeClub(mark, { timeZone: ZONE });
    const made = await makeEvent(club, "Spring Outing", {
      status: "live",
      stages: [{ playedOn: clubToday(ZONE), scoringBasis: "gross" }],
      players: 3,
      event: { playerAccess: "both", scoreEntryBy: "players" },
    });
    eventId = made.event.id;
    stageId = made.stages[0].id;
    // The member is the fixture's first entry, as the fixture made it.
    const first = made.players[0];
    member = { id: first.id, name: first.name, email: first.email };
    const guest = await prisma.player.create({
      data: { eventId, name: GUEST, email: "", standing: "guest", handicap: 14.2, seed: 4, status: "confirmed" },
    });
    guestId = guest.id;
    await prisma.stage.update({
      where: { id: stageId },
      data: {
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [{ name: "Group 1", startHole: 1, time: TEE_TIME, playerIds: [member.id, made.players[1].id, guestId] }],
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

  test("a MEMBER opens the app, scores one hole and sees where they stand", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
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

      const f = await walk.report(testInfo);
      // CONTROL: the counter saw the walk — three screens at least (Today, the card, the Board).
      expect(f.screens, `the counter missed screens: ${f.route.join(" → ")}`).toBeGreaterThanOrEqual(3);
      // ── BUDGET (work plan row 0b, step 3) ────────────────────────────────────────────────────────
      // Not set yet: MEASURED only. Once CI's JOURNEY lines have given the figures, the screens,
      // presses and characters a member's first hole may take are asserted here, from `f`.
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a GUEST opens their player link, scores one hole and sees where they stand", async ({ browser, baseURL }, testInfo) => {
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

      const f = await walk.report(testInfo);
      // CONTROL: the counter saw the walk — four screens at least (the link, Today, the card, the Board).
      expect(f.screens, `the counter missed screens: ${f.route.join(" → ")}`).toBeGreaterThanOrEqual(4);
      // ── BUDGET (work plan row 0b, step 3) ────────────────────────────────────────────────────────
      // Not set yet: MEASURED only. Once CI's JOURNEY lines have given the figures, the screens,
      // presses and characters a guest's first hole may take are asserted here, from `f`.
    } finally {
      await ctx.close();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
