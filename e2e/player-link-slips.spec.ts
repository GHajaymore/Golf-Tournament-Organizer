import { test, expect, type Page, type BrowserContext, type Browser, type TestInfo } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, dayIn, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";
import { CODE_WORDS } from "../src/lib/domain/code-shape";

/**
 * PLAYER LINK SLIPS, PRINTED AT THE DESK (J39/J40 PR 3; design §3.1, A10 to A12).
 *
 * Pressed as the people who would: the STARTER at the desk laptop opens the Print kit, prints a
 * slip for every guest in the field (members and a waiting guest get none), reloads to find "Only
 * new slips" offered first, then — the sheet left on the printer — makes new links for all of them
 * in one press and prints the new slips. A GUEST types the code off their new slip at /p and lands
 * on their Today, which names who the link is for ("Not you? Hand this back to the desk."); the old
 * slip opens nothing. On Entries, a guest's panel says when their slip was printed, and after New
 * link that the printed slip no longer opens. Read back from the database at each step.
 *
 * Actions pressed: printPlayerLinkSlips, newPlayerLinksFor, playerLinkSlipState (as staff), and the
 * link's own openCode (as the guest) and newPlayerLink (as staff).
 *
 * Fixture facts are read from the fixture: the guests are the rows this spec makes (standing
 * "guest", no email); the members are makeEvent's. The round is played today in the club's zone.
 * window.print is replaced in the desk's browser before any page loads, so the sheet stays on screen
 * to be read (a headless print returns at once and may or may not fire afterprint). Service workers
 * are blocked in every context. Memory: two browser contexts, one page each, about 400 MB at most.
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against the markup in
 * PlayerLinkSlips.tsx, PlayerLinkPanel.tsx and PlayerLinkOpener.tsx; CI runs it first.
 */

const ZONE = "UTC";
const MARK = "zz-link-slips";
const GUESTS = ["Robin Vale", "Tamsin Holloway"];
const WAITING = "Idris Penmarch";
const CODE = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

async function guestContext(browser: Browser, baseURL: string, testInfo: TestInfo): Promise<BrowserContext> {
  return browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
}

async function openPrintKit(page: Page) {
  await page.goto(`/print?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const card = page.getByTestId("link-slips");
  await expect(card.getByRole("heading", { name: "Player link slips" })).toBeVisible({ timeout: 20_000 });
  return card;
}

/** The slips on the sheet, name and dashed code, in the order printed. */
async function readSheet(page: Page): Promise<Array<{ name: string; code: string }>> {
  const sheet = page.getByTestId("link-slips-sheet");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  // The printer is asked only once the QR codes are drawn.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed?: number }).__printed ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
  const slips = sheet.getByTestId("link-slip");
  const out: Array<{ name: string; code: string }> = [];
  for (let i = 0; i < (await slips.count()); i += 1) {
    const s = slips.nth(i);
    await expect(s.getByRole("img")).toBeVisible();
    out.push({ name: await s.getByTestId("link-slip-name").innerText(), code: await s.getByTestId("link-slip-code").innerText() });
  }
  return out;
}

test.describe("player link slips at the desk", () => {
  let club: Club;
  let eventId = "";
  const ids = new Map<string, string>();

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Spring Outing", { status: "live", stages: [{ playedOn: dayIn(ZONE) }], players: 2 });
    eventId = made.event.id;
    let seed = 10;
    for (const name of GUESTS) {
      const p = await prisma.player.create({ data: { eventId, name, email: "", standing: "guest", handicap: 14.2, seed: seed++, status: "confirmed" } });
      ids.set(name, p.id);
    }
    await prisma.player.create({ data: { eventId, name: WAITING, email: "", standing: "guest", handicap: 20, seed: seed++, status: "waitlisted" } });
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("printed for every guest, reprinted only new, replaced after a lost sheet, opened from the slip", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    const passOf = (name: string) => prisma.playerPass.findUnique({ where: { playerId: ids.get(name)! } });

    // 1. The STARTER at the desk: the Print kit offers a slip for each of the two confirmed guests.
    const desk = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    await desk.addInitScript(() => {
      const w = window as unknown as { __printed?: number; print: () => void };
      w.print = () => {
        w.__printed = (w.__printed ?? 0) + 1;
      };
    });
    await signIn(desk, baseURL!, club, eventId);
    const deskPage = await desk.newPage();
    watchPageErrors(deskPage, errors, "desk");
    let card = await openPrintKit(deskPage);
    await card.getByRole("button", { name: `Print slips (${GUESTS.length})`, exact: true }).click();
    const first = await readSheet(deskPage);
    expect(first.map((s) => s.name), "members and the waiting guest get no slip").toEqual(GUESTS);
    for (const s of first) expect(s.code).toMatch(CODE);
    for (const name of GUESTS) {
      const pass = await passOf(name);
      expect(pass?.slipPrintedVersion, `${name}'s slip was not stamped`).toBe(pass?.version);
    }
    const printedLine = await prisma.auditLog.findFirst({ where: { eventId, action: "player-link.slips" }, select: { detail: true } });
    expect(printedLine?.detail).toMatch(/^Player link slips printed by .+ \(2\)$/);
    for (const s of first) expect(printedLine?.detail ?? "").not.toContain(s.code.replace(/-/g, ""));
    await deskPage.getByTestId("link-slips-sheet").getByRole("button", { name: "Done", exact: true }).click();
    await expect(deskPage.getByTestId("link-slips-sheet")).toHaveCount(0);

    // 2. Back on the Print kit: everything printed, so "Only new slips" comes first and has nothing.
    card = await openPrintKit(deskPage);
    await expect(card.getByRole("button", { name: "Only new slips (0)", exact: true })).toBeDisabled();
    await expect(card.getByRole("button", { name: `All slips (${GUESTS.length})`, exact: true })).toBeEnabled();

    // 3. The sheet was left on the printer: new links for all, one press and a confirm, then print the new ones.
    const renew = `Make new links for all ${GUESTS.length}`;
    await card.getByRole("button", { name: renew, exact: true }).click();
    await card.getByRole("button", { name: renew, exact: true }).click();
    await expect(card.getByRole("status").filter({ hasText: "The old slips no longer open." })).toBeVisible({ timeout: 20_000 });
    for (const name of GUESTS) expect((await passOf(name))?.version, `${name}'s link was not replaced`).toBe(2);
    await card.getByRole("button", { name: "Print the new slips", exact: true }).click();
    const second = await readSheet(deskPage);
    expect(second.map((s) => s.name)).toEqual(GUESTS);
    for (let i = 0; i < GUESTS.length; i += 1) expect(second[i].code, "a new slip carries the old code").not.toBe(first[i].code);
    await deskPage.getByTestId("link-slips-sheet").getByRole("button", { name: "Done", exact: true }).click();

    // 4. The GUEST types the code off their new slip: their Today names who the link is for.
    const phone = await guestContext(browser, baseURL!, testInfo);
    const g = await phone.newPage();
    watchPageErrors(g, errors, "guest");
    const typeCode = async (typed: string) => {
      await g.goto("/p");
      await g.waitForLoadState("networkidle").catch(() => {});
      await g.getByLabel("Or type the code from your organizer").fill(typed);
      await g.getByRole("button", { name: "Open", exact: true }).click();
    };
    await typeCode(first[0].code);
    // Not getByRole("alert") on the page: Next's route announcer is an alert too.
    // One code box: a replaced code is told the one sentence for a code that opens nothing.
    await expect(g.locator('p[role="alert"]')).toContainText(CODE_WORDS.opensNothing, { timeout: 20_000 });
    await typeCode(second[0].code);
    await g.waitForURL(/\/me$/, { timeout: 30_000 });
    await expect(g.getByTestId("guest-not-you")).toHaveText(`${GUESTS[0]} · ${MARK} Spring Outing. Not you? Hand this back to the desk.`);
    await expect(g.getByRole("button", { name: "Forget me on this phone" })).toBeVisible();
    await phone.close();

    // 5. On Entries, the second guest's panel says when the slip was printed; after New link, that it no longer opens.
    await deskPage.goto(`/registration?bust=${Date.now()}`);
    await deskPage.waitForLoadState("networkidle").catch(() => {});
    const open = deskPage.getByRole("button", { name: `Player link for ${GUESTS[1]}`, exact: true });
    await open.scrollIntoViewIfNeeded();
    if ((await open.getAttribute("aria-expanded")) !== "true") await open.click();
    const panel = deskPage.locator(`[data-player-link="${ids.get(GUESTS[1])}"]`);
    await expect(panel.getByTestId("player-link-slip")).toContainText("Slip printed on", { timeout: 20_000 });
    await panel.getByRole("button", { name: "New link", exact: true }).click();
    await panel.getByRole("button", { name: "New link", exact: true }).click();
    await expect(panel.getByTestId("player-link-slip")).toHaveText(/Their printed slip no longer opens\./, { timeout: 20_000 });
    await desk.close();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
