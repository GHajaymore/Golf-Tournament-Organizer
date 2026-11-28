import { test, expect, type Page, type BrowserContext, type Browser, type TestInfo } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, signInWith, memberSession, dayIn, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";
import { keepCardOf } from "./keep-on-play";
import { CODE_WORDS } from "../src/lib/domain/code-shape";

/**
 * ONE CODE BOX (plan row 4c, simplicity cut 1; design "One code box" §6, Security items 4 and 5).
 *
 * A player is handed one of two codes — a ROUND code (8 characters, `ABCD-EFGH`) or a guest's
 * PERSONAL player link code (12, `K7QM-2XRA-9DTP`) — and may type either into either box. Pressed as
 * the people who would, signed out unless said:
 *
 *   1  a GUEST types their personal code, lower case with dashes, into /play's box: Today at /me with
 *      their tee time, and a hole entered on My card reaches the server
 *   2  a PLAYER types the round code into /p's box: /play with the round's groups, a group confirmed,
 *      a hole entered (no extra press: /p hands the code on after a `#`)
 *   3  the installed app's path: /start lands a signed-out phone on /p, which takes a ROUND code
 *   4  a wrong 8 and a wrong 12, each at /play and at /p: the SAME sentence in all four cells, and it
 *      neither blames the club ("isn't valid") nor sends them for a new link
 *   5  6 digits from an email at each box: "not a code", and no server action is posted at all
 *   6  a MEMBER signed in to another event types the guest's code at /play: Today says whose card
 *      opened ("looking as …, through a player link") with "Your own account" beside it (S4)
 *   7  with JavaScript off, a personal code posted at /play opens Today (the plain form, in a body)
 *   8  /play#<12 characters> opens nothing and posts nothing: a personal code opens only on a press
 *
 * The ORGANIZER makes the guest's link the real way (Entries → Player link → Show QR); the code is
 * read off the panel. Actions pressed: openCode (the boxes and the tap), openCodeForm (step 7, no
 * script), claimPlayerSlot (step 2's confirmation), showPlayerLink (staff).
 *
 * Fixture facts are read from the fixture: the guest is the row this spec makes (standing "guest", no
 * email); the members are makeEvent's, named from the rows; the round's code is the one written here.
 * The round is played today in the club's zone (UTC). Service workers are blocked in every context (a
 * save spec, for WebKit: run with `E2E_ENGINE=webkit` and a server started with `E2E_PLAIN_HTTP=1`,
 * the design's step 9). Memory: one browser context at a time beside the organizer's, one page each,
 * about 400 MB at most; each closes before the next opens.
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against the markup in
 * PlayClient.tsx, PlayerLinkOpener.tsx, PlayerLinkPanel.tsx and keep-on-play.ts; CI runs it first.
 */

const ZONE = "UTC";
const MARK = "zz-one-box";
const GUEST = "Robin Vale";
const ROUND_CODE = "ZZWB7KQX";
const TEE_TIME = "8:20 AM";
/** Right shape, opens nothing: an 8 of the round alphabet, and a 12 of Crockford's. */
const WRONG_EIGHT = "ZZWB-7KQ2";
const WRONG_TWELVE = "ZZ00-ZZ00-ZZ00";

async function freshPhone(browser: Browser, baseURL: string, testInfo: TestInfo, javaScriptEnabled = true): Promise<BrowserContext> {
  return browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] }, javaScriptEnabled });
}

/** How many POSTs from this page carried `needle` (the code) in their body: an action posted with it. */
function postsCarrying(page: Page, needle: string): () => number {
  let n = 0;
  const bare = needle.replace(/-/g, "").toUpperCase();
  page.on("request", (r) => {
    const body = (r.method() === "POST" ? r.postData() ?? "" : "").replace(/-/g, "").toUpperCase();
    if (body.includes(bare)) n += 1;
  });
  return () => n;
}

/** The refusal beside a box: inside the page's own main, never the route announcer (also an alert). */
const refusal = (page: Page) => page.locator('main [role="alert"]');

async function atPlay(page: Page, typed: string) {
  await page.goto(`/play?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel(CODE_WORDS.boxLabel).fill(typed);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function atP(page: Page, typed: string) {
  await page.goto(`/p?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Or type the code from your organizer").fill(typed);
  await page.getByRole("button", { name: "Open", exact: true }).click();
}

test.describe("one code box: either code in either box", () => {
  let club: Club;
  let eventId = "";
  let stageId = "";
  let guestId = "";
  let member = { id: "", name: "" };
  let otherSession = "";
  let personal = "";

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Spring Outing", {
      status: "live",
      stages: [{ playedOn: dayIn(ZONE) }],
      players: 2,
      event: { playerAccess: "both", scoreEntryBy: "players" },
    });
    eventId = made.event.id;
    stageId = made.stages[0].id;
    member = { id: made.players[0].id, name: made.players[0].name };
    const guest = await prisma.player.create({
      data: { eventId, name: GUEST, email: "", standing: "guest", handicap: 14.2, seed: 3, status: "confirmed" },
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
    // A member of ANOTHER event of the club, for step 6: an address of their own.
    const other = await makeEvent(club, "Monday Medal", { status: "live", stages: [{ playedOn: dayIn(ZONE) }], players: 1 });
    const otherEmail = `${MARK}-other-member@example.invalid`;
    await prisma.player.update({ where: { id: other.players[0].id }, data: { email: otherEmail } });
    otherSession = (await memberSession(other.event.id, otherEmail, other.players[0].name)).session;
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("a round code and a personal code each open from either box, and every wrong one says one sentence", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const cardHas = (playerId: string) => async () => {
      const card = await prisma.scorecard.findFirst({ where: { stageId, playerId }, select: { strokes: true } });
      return card ? (JSON.parse(card.strokes) as (number | null)[]).some((n) => n != null) : false;
    };

    // 0. The ORGANIZER makes the guest's link the real way and reads its code off the panel.
    const desk = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    await signIn(desk, baseURL!, club, eventId);
    const deskPage = await desk.newPage();
    watchPageErrors(deskPage, errors, "organizer");
    await deskPage.goto(`/registration?bust=${Date.now()}`);
    await deskPage.waitForLoadState("networkidle").catch(() => {});
    const linkButton = deskPage.getByRole("button", { name: `Player link for ${GUEST}`, exact: true });
    await linkButton.scrollIntoViewIfNeeded();
    await linkButton.click();
    const panel = deskPage.locator("[data-player-link]");
    await expect(panel.getByTestId("player-link-status")).not.toHaveText("Checking…", { timeout: 20_000 });
    await panel.getByRole("button", { name: "Show QR", exact: true }).click();
    const shown = panel.getByTestId("player-link-code");
    await expect(shown).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, { timeout: 20_000 });
    personal = await shown.innerText();
    await desk.close();

    // 1. A GUEST types their personal code into /play's box — lower case, dashes — and lands on Today.
    {
      const phone = await freshPhone(browser, baseURL!, testInfo);
      const page = await phone.newPage();
      watchPageErrors(page, errors, "guest at /play");
      await page.goto(`/play?bust=${Date.now()}`);
      // The box says it takes either code.
      await expect(page.getByText(CODE_WORDS.boxHint)).toBeVisible({ timeout: 20_000 });
      await atPlay(page, personal.toLowerCase());
      await page.waitForURL(/\/me$/, { timeout: 30_000 });
      await expect(page.getByTestId("guest-event")).toHaveText(`${MARK} Spring Outing`);
      await expect(page.getByText(TEE_TIME, { exact: false }).first()).toBeVisible();
      await expect(page.getByTestId("guest-not-you")).toContainText(GUEST);
      // No play session was made: the link is not a round code.
      expect((await phone.cookies()).map((c) => c.name)).not.toContain("ng_play");
      await page.goto(`/me/card?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByText("Hole", { exact: true })).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: /Par$/ }).first().click();
      await expect.poll(cardHas(guestId), { timeout: 30_000, message: "the guest's hole never reached the server" }).toBe(true);
      await phone.close();
    }

    // 2. A PLAYER types the ROUND code into /p's box: on to /play's groups, one confirmation, a hole.
    {
      const phone = await freshPhone(browser, baseURL!, testInfo);
      const page = await phone.newPage();
      watchPageErrors(page, errors, "player at /p");
      await atP(page, `${ROUND_CODE.slice(0, 4)}-${ROUND_CODE.slice(4)}`);
      await page.waitForURL(/\/play/, { timeout: 30_000 });
      expect(page.url(), "the round code left /p in an address a server logs").not.toMatch(/[?&]code=/);
      await keepCardOf(page, member.name);
      await expect(page.getByRole("button", { name: /Par$/ }).first()).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: /Par$/ }).first().click();
      await expect.poll(cardHas(member.id), { timeout: 30_000, message: "the player's hole never reached the server" }).toBe(true);
      await phone.close();
    }

    // 3. The installed app's path: /start sends a signed-out phone to /p, which takes a ROUND code.
    {
      const phone = await freshPhone(browser, baseURL!, testInfo);
      const page = await phone.newPage();
      watchPageErrors(page, errors, "installed app");
      await page.goto("/start");
      await page.waitForURL(/\/p(\?|$)/, { timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.getByLabel("Or type the code from your organizer").fill(ROUND_CODE.toLowerCase());
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await page.waitForURL(/\/play/, { timeout: 30_000 });
      await expect(page.getByText(/^Tap your group to start scoring.$/)).toBeVisible({ timeout: 20_000 });
      await phone.close();
    }

    // 4. Wrong codes of both shapes, in both boxes: ONE sentence, the same in all four cells.
    {
      const phone = await freshPhone(browser, baseURL!, testInfo);
      const page = await phone.newPage();
      watchPageErrors(page, errors, "wrong codes");
      const said: string[] = [];
      for (const [box, typed] of [
        [atPlay, WRONG_EIGHT],
        [atPlay, WRONG_TWELVE],
        [atP, WRONG_EIGHT],
        [atP, WRONG_TWELVE],
      ] as const) {
        await box(page, typed);
        // A wrong 8 typed at /p goes on to /play first, and is answered there.
        await expect(refusal(page)).toBeVisible({ timeout: 20_000 });
        said.push((await refusal(page).innerText()).trim());
      }
      expect(new Set(said).size, `four cells, more than one sentence: ${JSON.stringify(said)}`).toBe(1);
      expect(said[0]).toContain(CODE_WORDS.opensNothing);
      for (const s of said) expect(s).not.toMatch(/isn't valid|organizer for a new one/);
      await phone.close();
    }

    // 5. Six digits from an email, at each box: "not a code", and nothing is posted to the server.
    {
      const phone = await freshPhone(browser, baseURL!, testInfo);
      const page = await phone.newPage();
      watchPageErrors(page, errors, "six digits");
      const posted = postsCarrying(page, "482913");
      for (const box of [atPlay, atP]) {
        await box(page, "482913");
        await expect(refusal(page)).toContainText(CODE_WORDS.notACode);
      }
      expect(posted(), "a code of no shape was posted to the server").toBe(0);
      await phone.close();
    }

    // 6. A MEMBER signed in to another event types the guest's code at /play: Today says whose card opened.
    {
      const phone = await freshPhone(browser, baseURL!, testInfo);
      await signInWith(phone, baseURL!, otherSession, "");
      const page = await phone.newPage();
      watchPageErrors(page, errors, "signed-in member");
      await atPlay(page, personal);
      await page.waitForURL(/\/me$/, { timeout: 30_000 });
      const line = page.getByTestId("player-view-switch");
      await expect(line).toContainText(`You're looking as ${GUEST}, through a player link.`);
      await expect(line.getByRole("button", { name: "Your own account" })).toBeVisible();
      await expect(page.getByTestId("guest-event")).toHaveText(`${MARK} Spring Outing`);
      await phone.close();
    }

    // 7. JavaScript off: the plain form posts the personal code in its body, and the server opens Today.
    {
      const phone = await freshPhone(browser, baseURL!, testInfo, false);
      const page = await phone.newPage();
      await page.goto("/play");
      await page.getByLabel(CODE_WORDS.boxLabel).fill(personal);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL(/\/me$/, { timeout: 30_000 });
      await expect(page.getByTestId("guest-event")).toHaveText(`${MARK} Spring Outing`);
      await phone.close();
    }

    // 8. /play#<a personal code> is no sign's address: the box stays empty and nothing is posted.
    {
      const phone = await freshPhone(browser, baseURL!, testInfo);
      const page = await phone.newPage();
      watchPageErrors(page, errors, "fragment");
      const posted = postsCarrying(page, personal);
      await page.goto(`/play#${personal.replace(/-/g, "")}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByLabel(CODE_WORDS.boxLabel)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByLabel(CODE_WORDS.boxLabel)).toHaveValue("");
      expect(posted(), "a personal code in /play's fragment was posted without a press").toBe(0);
      expect(page.url()).not.toMatch(/\/me$/);
      await phone.close();
    }

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
