import { test, expect, type Page, type BrowserContext, type Browser, type TestInfo } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession, dayIn, NAMES, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * A GUEST TAKES FULL PART, WITH NO EMAIL AND NO APP (J39/J40 PR 1; Ajay, 7 Nov).
 *
 * Pressed as the people who would: the ORGANIZER opens a guest's Player link panel on Entries and
 * hands the link over; the GUEST opens it on a phone with no account and sees their event, their tee
 * time and their card, and enters a hole; a member of ANOTHER event, signed in on their own phone,
 * opens the same link and is offered both, never merged (S4); the organizer replaces the link and
 * turns it off. Read back from the database at each step.
 *
 *   S1  a page load of /p#CODE with no tap records no browser and opens nothing; only the tap does
 *   S5  a waitlisted guest's link opens the waiting card, not the card
 *   S4  a browser holding a sign-in AND the link looks through the link for its own event, and is
 *       offered its own account beside it ("Your own account" / "Open it")
 *       the old link after New link reads "This link no longer works", and the round code still opens
 *       the same player at /play; a turned-off link opens nothing
 *
 * Actions pressed: openPlayerLink, forgetThisPhone, choosePlayerView, playerLinkStatus, showPlayerLink,
 * newPlayerLink, turnOffPlayerLink — and the card's own saveScorecard, as a guest.
 *
 * Fixture facts are read from the fixture: the guest is the row this spec makes (standing "guest", no
 * email), the round's code is the one written here. The round is played today in the club's zone (UTC),
 * so the sheet is the day's. Service workers are blocked in every context (a save spec, for WebKit).
 * Memory: up to four browser contexts, one page each, about 600 MB at most; each closes before the next
 * that does not need it.
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against the markup in
 * PlayerLinkPanel.tsx, PlayerLinkOpener.tsx, GuestLinkControls.tsx and the player shell; CI runs it.
 */

const ZONE = "UTC";
const MARK = "zz-guest-link";
const GUEST = "Robin Vale";
const ROUND_CODE = "ZZGQ4MKT";
const TEE_TIME = "8:10 AM";

async function guestContext(browser: Browser, baseURL: string, testInfo: TestInfo): Promise<BrowserContext> {
  return browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
}

async function openEntries(page: Page) {
  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** The panel under the guest's row, opened; its status line read. */
async function openPanel(page: Page) {
  const button = page.getByRole("button", { name: `Player link for ${GUEST}`, exact: true });
  await button.scrollIntoViewIfNeeded();
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  const panel = page.locator("[data-player-link]");
  await expect(panel.getByTestId("player-link-status")).not.toHaveText("Checking…", { timeout: 20_000 });
  return panel;
}

async function typeCode(page: Page, typed: string) {
  await page.goto("/p");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Or type the code from your organizer").fill(typed);
  await page.getByRole("button", { name: "Open", exact: true }).click();
}

test.describe("a guest takes full part by a player link", () => {
  let club: Club;
  let eventId = "";
  let stageId = "";
  let guestId = "";
  let otherSession = "";

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Spring Outing", {
      status: "live",
      stages: [{ playedOn: dayIn(ZONE) }],
      players: 3,
      // Round codes on as well, so the day's other way in is there to prove it still works.
      event: { playerAccess: "both", scoreEntryBy: "players" },
    });
    eventId = made.event.id;
    stageId = made.stages[0].id;
    const guest = await prisma.player.create({
      data: { eventId, name: GUEST, email: "", standing: "guest", handicap: 14.2, seed: 4, status: "confirmed" },
    });
    guestId = guest.id;
    await prisma.stage.update({
      where: { id: stageId },
      data: {
        accessCode: ROUND_CODE,
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [{ name: "Group 1", startHole: 1, time: TEE_TIME, playerIds: [made.players[0].id, made.players[1].id, guestId] }],
        }),
      },
    });
    // A member of ANOTHER event of the club, signed in on their own phone: S4's browser that holds both.
    const other = await makeEvent(club, "Monday Medal", { status: "live", stages: [{ playedOn: dayIn(ZONE) }], players: 1 });
    // An address of their own: makeEvent numbers entries per event, so p0 would also be the first event's p0.
    const otherEmail = `${MARK}-other-member@example.invalid`;
    await prisma.player.update({ where: { id: other.players[0].id }, data: { email: otherEmail } });
    otherSession = (await memberSession(other.event.id, otherEmail, NAMES[0])).session;
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("handed over, opened on a tap, scored, offered beside a sign-in, replaced and turned off", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const devices = () => prisma.playerPassDevice.count({ where: { pass: { playerId: guestId } } });

    // 1. The ORGANIZER opens the guest's panel on Entries: not made yet; Show QR makes it and shows the code.
    const desk = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    await signIn(desk, baseURL!, club, eventId);
    const deskPage = await desk.newPage();
    watchPageErrors(deskPage, errors, "organizer");
    await openEntries(deskPage);
    let panel = await openPanel(deskPage);
    await expect(panel.getByTestId("player-link-status")).toHaveText("Not made yet");
    await panel.getByRole("button", { name: "Show QR", exact: true }).click();
    const shown = panel.getByTestId("player-link-code");
    await expect(shown).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, { timeout: 20_000 });
    const code1 = (await shown.innerText()).replace(/-/g, "");
    await expect(panel.getByRole("img", { name: `QR code for ${GUEST}'s player link` })).toBeVisible();
    await expect(panel.getByTestId("player-link-status")).toHaveText("Not opened yet");
    // On the record, never with the code.
    const handed = await prisma.auditLog.findFirst({ where: { eventId, action: "player-link.handed" } });
    expect(handed?.detail).toContain("player link shown");
    expect(handed?.detail ?? "").not.toContain(code1);

    // 2. The GUEST's phone. S1: the link LOADED, nobody tapped — nothing is opened, no browser recorded.
    const phoneA = await guestContext(browser, baseURL!, testInfo);
    const a = await phoneA.newPage();
    watchPageErrors(a, errors, "guest");
    await a.goto(`/p#${code1}`);
    const tap = a.getByRole("button", { name: "Open my card" });
    await expect(tap).toBeEnabled({ timeout: 20_000 });
    expect(a.url(), "the code is stripped from the address at once").not.toContain(code1);
    expect(await devices(), "a page load recorded a browser (S1)").toBe(0);
    expect((await prisma.playerPass.findUnique({ where: { playerId: guestId } }))?.lastOpenedAt, "a page load opened the link (S1)").toBeNull();
    // The tap opens it.
    await tap.click();
    await a.waitForURL(/\/me$/, { timeout: 30_000 });
    expect(await devices()).toBe(1);
    await expect(a.getByTestId("guest-event")).toHaveText(`${MARK} Spring Outing`);
    await expect(a.getByText(TEE_TIME, { exact: false }).first()).toBeVisible();
    // One event: no Events tab, no switcher, no messages button, no sign-out — forget instead.
    await expect(a.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Events" })).toHaveCount(0);
    await expect(a.getByRole("navigation", { name: "Tournament" })).toHaveCount(0);
    await expect(a.getByRole("button", { name: "Forget me on this phone" })).toBeVisible();

    // 3. S5: waitlisted, the link opens the waiting card and nothing else.
    await prisma.player.update({ where: { id: guestId }, data: { status: "waitlisted" } });
    await a.goto(`/me/card?bust=${Date.now()}`);
    await expect(a.getByText("Your entry is waiting for the organizer.", { exact: false })).toBeVisible();
    await prisma.player.update({ where: { id: guestId }, data: { status: "confirmed" } });

    // 4. Confirmed again: the guest keeps their own card. One hole, and it is on the server.
    await a.goto(`/me/card?bust=${Date.now()}`);
    await a.waitForLoadState("networkidle").catch(() => {});
    await expect(a.getByText("Hole", { exact: true })).toBeVisible({ timeout: 20_000 });
    await a.getByRole("button", { name: /^4Par$|Par$/ }).first().click();
    await expect
      .poll(async () => {
        const card = await prisma.scorecard.findFirst({ where: { stageId, playerId: guestId }, select: { strokes: true } });
        return card ? (JSON.parse(card.strokes) as (number | null)[]).some((n) => n != null) : false;
      }, { timeout: 30_000, message: "the guest's hole never reached the server" })
      .toBe(true);

    // 5. S4: a member of another event, SIGNED IN on their own phone, types the same code.
    const phoneB = await guestContext(browser, baseURL!, testInfo);
    await signInWith(phoneB, baseURL!, otherSession, "");
    const b = await phoneB.newPage();
    watchPageErrors(b, errors, "signed-in member");
    await typeCode(b, `${code1.slice(0, 4).toLowerCase()}-${code1.slice(4, 8).toLowerCase()} ${code1.slice(8)}`);
    await b.waitForURL(/\/me$/, { timeout: 30_000 });
    const line = b.getByTestId("player-view-switch");
    await expect(line).toContainText(`You're looking as ${GUEST}, through a player link.`);
    await expect(b.getByTestId("guest-event")).toHaveText(`${MARK} Spring Outing`);
    await line.getByRole("button", { name: "Your own account" }).click();
    await b.waitForURL(/\/me$/, { timeout: 30_000 });
    await expect(b.getByTestId("player-view-switch")).toContainText(`This phone also holds a player link for ${GUEST}.`);
    await expect(b.getByTestId("guest-event")).toHaveCount(0);
    await b.getByTestId("player-view-switch").getByRole("button", { name: "Open it" }).click();
    await b.waitForURL(/\/me$/, { timeout: 30_000 });
    await expect(b.getByTestId("guest-event")).toHaveText(`${MARK} Spring Outing`);
    expect(await devices()).toBe(2);
    // The first phone is told.
    await a.goto(`/me?bust=${Date.now()}`);
    await expect(a.getByText("Your link was opened on another phone or browser on", { exact: false })).toBeVisible();
    // Forget me on this phone: the link leaves this browser only; the account stays signed in.
    await b.getByRole("button", { name: "Forget me on this phone" }).click();
    await b.getByRole("button", { name: "Forget", exact: true }).click();
    await b.waitForURL(/\/p$/, { timeout: 30_000 });
    await b.goto(`/me?bust=${Date.now()}`);
    await expect(b.getByTestId("player-view-switch")).toHaveCount(0);
    await expect(b.getByTestId("guest-event")).toHaveCount(0);
    await phoneB.close();

    // 6. The ORGANIZER sees where it stands, and makes a NEW LINK (it asks first).
    await openEntries(deskPage);
    panel = await openPanel(deskPage);
    await expect(panel.getByTestId("player-link-status")).toContainText("Opened on 2 phones or browsers");
    await panel.getByRole("button", { name: "New link", exact: true }).click();
    await panel.getByRole("button", { name: "New link", exact: true }).click();
    await expect(shown).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, { timeout: 20_000 });
    const code2 = (await shown.innerText()).replace(/-/g, "");
    expect(code2).not.toBe(code1);
    expect(await devices(), "the old link's browsers are forgotten with it").toBe(0);

    // 7. The old phone is out; the round code still opens the same player at /play.
    await a.goto(`/me?bust=${Date.now()}`);
    await a.waitForURL(/\/p\?ended=1$/, { timeout: 30_000 });
    await expect(a.getByText("This link no longer works. Ask your organizer for a new one.")).toBeVisible();
    await phoneA.close();
    const codeHolder = await guestContext(browser, baseURL!, testInfo);
    try {
      const c = await codeHolder.newPage();
      await c.goto("/play");
      await c.waitForLoadState("networkidle").catch(() => {});
      await c.getByLabel("Round code").fill(ROUND_CODE);
      await c.getByRole("button", { name: "Continue" }).click();
      await expect(c.getByRole("button", { name: new RegExp(GUEST) }).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await codeHolder.close();
    }

    // 8. TURN OFF LINK: the new code opens nothing either.
    await panel.getByRole("button", { name: "Turn off link", exact: true }).click();
    await panel.getByRole("button", { name: "Turn off link", exact: true }).click();
    await expect(panel.getByTestId("player-link-status")).toHaveText("Turned off. The old link no longer opens.", { timeout: 20_000 });
    const phoneC = await guestContext(browser, baseURL!, testInfo);
    try {
      const c = await phoneC.newPage();
      await typeCode(c, code2);
      // Not getByRole("alert"): Next's route announcer is an alert too.
      await expect(c.locator('p[role="alert"]')).toContainText("This link no longer works.");
      expect(c.url()).not.toMatch(/\/me$/);
    } finally {
      await phoneC.close();
    }
    await desk.close();

    for (const action of ["player-link.handed", "player-link.opened", "player-link.new", "player-link.off"]) {
      expect(await prisma.auditLog.count({ where: { eventId, action } }), `no "${action}" line on the record`).toBeGreaterThan(0);
    }
    const lines = await prisma.auditLog.findMany({ where: { eventId, action: { startsWith: "player-link." } }, select: { detail: true } });
    for (const l of lines) for (const c of [code1, code2]) expect(l.detail, "a code reached the record").not.toContain(c);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
