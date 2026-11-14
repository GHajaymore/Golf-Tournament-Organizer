import { test, expect, type Page, type BrowserContext, type Browser, type TestInfo } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, dayIn, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * A GUEST IN MESSAGES AND NOTICES, WITH NO EMAIL (J39/J40 PR 2).
 *
 * Pressed as the people who would: the ORGANIZER hands a guest their link; the GUEST, on a phone
 * with no account, writes in their round's thread and presses Message the organizer; the
 * organizer reads both in the console (the round post marked "Guest"), answers the desk, and
 * mutes the guest from the Player link panel; the guest's next round post is refused in words
 * while the desk stays open. Then the guest's notices, pressed by the guest: Turn on files a row on
 * the PASS at its current version (never an account's); the toggle asks the SERVER whether this
 * browser is on for this guest (`pushIsOnHere`); Turn off stops this phone; and "Forget me on this
 * phone" stops its notices too while the link stays live (#1133 review, SEC-1).
 * Read back from the database at each step.
 *
 * Actions pressed: sendMessage, readThread, markThreadRead (as the guest and the organizer),
 * muteGuestInMessages (organizer), getVapidPublicKey, savePushSubscription, pushIsOnHere,
 * removePushSubscription and forgetThisPhone (guest), and PR 1's showPlayerLink and openPlayerLink
 * to get there.
 *
 * Push in a headless browser: the browser's push machinery is stubbed in the page
 * (`addInitScript`); nothing in the app is. The test server holds only the PUBLIC VAPID key
 * (playwright.config.ts), so Turn on goes all the way to `savePushSubscription` and nothing is ever
 * sent; the send side is proved against real rows in `a-guest-push-dies-with-its-link.audit.test.ts`.
 *
 * Fixture facts are read from the fixture. Service workers are blocked in every context. Memory:
 * two browser contexts at most, one page each, about 400 MB.
 *
 * NOT RUN ON THE DESKTOP WHERE IT WAS WRITTEN (no browsers there): written against the markup in
 * MessagesClient.tsx, PlayerLinkPanel.tsx and PushToggle.tsx; CI runs it.
 */

const ZONE = "UTC";
const MARK = "zz-guest-msg-spec";
const GUEST = "Robin Vale";
const ENDPOINT = `https://push.example.invalid/${MARK}`;

async function guestContext(browser: Browser, baseURL: string, testInfo: TestInfo): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });
  // The browser's push machinery, stubbed IN THE PAGE: a registration whose subscription is this
  // endpoint, and permission granted. Whether it is ON is the server's answer (`pushIsOnHere`).
  await ctx.addInitScript((endpoint: string) => {
    const sub = { endpoint, toJSON: () => ({ keys: { p256dh: "zz-p256dh", auth: "zz-auth" } }), unsubscribe: async () => true };
    const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
    const sw = { getRegistration: async () => reg, ready: Promise.resolve(reg), register: async () => reg, addEventListener: () => {}, removeEventListener: () => {}, controller: null };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, get: () => sw });
    const w = window as unknown as Record<string, unknown>;
    if (!("PushManager" in w)) w.PushManager = function PushManager() {};
    Object.defineProperty(window, "Notification", { configurable: true, value: Object.assign(function Notification() {}, { permission: "granted", requestPermission: async () => "granted" }) });
  }, ENDPOINT);
  return ctx;
}

async function openEntries(page: Page) {
  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function openPanel(page: Page) {
  const button = page.getByRole("button", { name: `Player link for ${GUEST}`, exact: true });
  await button.scrollIntoViewIfNeeded();
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  const panel = page.locator("[data-player-link]");
  await expect(panel.getByTestId("player-link-status")).not.toHaveText("Checking…", { timeout: 20_000 });
  return panel;
}

async function compose(page: Page, body: string) {
  await page.getByRole("textbox").last().fill(body);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test.describe("a guest in messages and notices", () => {
  let club: Club;
  let eventId = "";
  let guestId = "";

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Spring Outing", { status: "live", stages: [{ playedOn: dayIn(ZONE) }], players: 2 });
    eventId = made.event.id;
    guestId = (await prisma.player.create({ data: { eventId, name: GUEST, email: "", standing: "guest", handicap: 14.2, seed: 3, status: "confirmed" } })).id;
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("the guest writes to the round and the organizer, is marked Guest, is muted, and turns their own notices on, off and forgotten", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const errors: string[] = [];

    // 1. The ORGANIZER hands the link over.
    const desk = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    await signIn(desk, baseURL!, club, eventId);
    const deskPage = await desk.newPage();
    watchPageErrors(deskPage, errors, "organizer");
    await openEntries(deskPage);
    let panel = await openPanel(deskPage);
    await panel.getByRole("button", { name: "Show QR", exact: true }).click();
    const shown = panel.getByTestId("player-link-code");
    await expect(shown).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, { timeout: 20_000 });
    const code = (await shown.innerText()).replace(/-/g, "");

    // 2. The GUEST's phone opens it with a tap.
    const phone = await guestContext(browser, baseURL!, testInfo);
    try {
      const g = await phone.newPage();
      watchPageErrors(g, errors, "guest");
      await g.goto(`/p#${code}`);
      await g.getByRole("button", { name: "Open my card" }).click();
      await g.waitForURL(/\/me$/, { timeout: 30_000 });

      // 3. Messages, from the header: a post to their round, and Message the organizer.
      await g.getByRole("link", { name: /^Messages/ }).click();
      await g.waitForURL(/\/me\/messages/, { timeout: 30_000 });
      await expect(g.getByRole("combobox", { name: "…or send to one person" }), "a link starts no direct thread (D7): no picker").toHaveCount(0);
      await g.getByRole("button", { name: "New message" }).click();
      await compose(g, "zz Is the range open before we tee off?");
      await expect
        .poll(async () => (await prisma.message.findFirst({ where: { body: "zz Is the range open before we tee off?" }, select: { authorKey: true } }))?.authorKey, { timeout: 20_000 })
        .toBe(`guest:${guestId}`);
      await g.goto(`/me/messages?bust=${Date.now()}`);
      await g.getByRole("button", { name: /^Message the organi[sz]er$/ }).click();
      await compose(g, "zz Can I bring a trolley?");
      await expect
        .poll(async () => (await prisma.thread.findFirst({ where: { scopeKey: `desk:${guestId}` }, select: { id: true } }))?.id ?? "", { timeout: 20_000 })
        .not.toBe("");

      // 4. The ORGANIZER reads both: the desk under the guest's name, the round post marked Guest.
      await deskPage.goto(`/messages?bust=${Date.now()}`);
      await deskPage.waitForLoadState("networkidle").catch(() => {});
      await deskPage.getByRole("button", { name: new RegExp(`^${GUEST}`) }).first().click();
      await expect(deskPage.getByText("zz Can I bring a trolley?")).toBeVisible({ timeout: 20_000 });
      await compose(deskPage, "zz Trolleys are fine.");
      await expect
        .poll(async () => prisma.message.count({ where: { body: "zz Trolleys are fine.", thread: { scopeKey: `desk:${guestId}` } } }), { timeout: 20_000 })
        .toBe(1);
      await deskPage.goto(`/messages?bust=${Date.now()}`);
      await deskPage.getByRole("button").filter({ hasText: "zz Is the range open" }).first().click();
      const post = deskPage.getByText("zz Is the range open before we tee off?");
      await expect(post).toBeVisible({ timeout: 20_000 });
      await expect(deskPage.locator("[data-guest-marker]").first(), "a guest's post is marked Guest (S8)").toHaveText("Guest");

      // 5. The ORGANIZER mutes the guest in messages; on the record.
      await openEntries(deskPage);
      panel = await openPanel(deskPage);
      await panel.getByRole("button", { name: "Mute in messages", exact: true }).click();
      await expect(panel.getByRole("button", { name: "Unmute in messages", exact: true })).toBeVisible({ timeout: 20_000 });
      expect((await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guestId } })).mutedAt).not.toBeNull();
      expect(await prisma.auditLog.count({ where: { eventId, action: "player-link.muted" } })).toBe(1);

      // 6. The guest's next round post is refused in words; the desk stays open.
      await g.goto(`/me/messages?bust=${Date.now()}`);
      await g.getByRole("button", { name: "New message" }).click();
      await compose(g, "zz One more thing for everyone");
      await expect(g.getByText("Your organizer has turned off your posts here.", { exact: false })).toBeVisible({ timeout: 20_000 });
      expect(await prisma.message.count({ where: { body: "zz One more thing for everyone" } })).toBe(0);

      // 7. Notices, pressed by the GUEST: Turn on files the row on the PASS, at its current version,
      //    and never an account's (#1133 review: the turn-on step).
      const pass = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guestId } });
      const today = async () => {
        await g.goto(`/me?bust=${Date.now()}`);
        await g.waitForLoadState("networkidle").catch(() => {});
        // Today keeps the toggle behind its "more" extender when there is more to show: open it.
        for (const s of await g.locator("details:not([open]) > summary").all()) await s.click().catch(() => {});
      };
      const guestRows = () => prisma.playerPassPush.count({ where: { passId: pass.id, endpoint: ENDPOINT, passVersion: pass.version } });
      await today();
      await g.getByRole("button", { name: "Turn on", exact: true }).click();
      await expect(g.getByText("Tee-time alerts are on.")).toBeVisible({ timeout: 20_000 });
      await expect.poll(guestRows, { timeout: 20_000 }).toBe(1);
      expect(await prisma.pushSubscription.count({ where: { endpoint: ENDPOINT } }), "a guest's Turn on filed an account's row").toBe(0);
      // A reload asks the SERVER (`pushIsOnHere`), and it says on.
      await today();
      await expect(g.getByText("Tee-time alerts are on.")).toBeVisible({ timeout: 20_000 });

      // 8. Turn off: this phone stops (the row goes).
      await g.getByRole("button", { name: "Turn off", exact: true }).click();
      await expect.poll(async () => prisma.playerPassPush.count({ where: { endpoint: ENDPOINT } }), { timeout: 20_000 }).toBe(0);

      // 9. On again, then "Forget me on this phone": the link leaves the phone AND its notices stop
      //    there (#1133 review, SEC-1), although the link itself is still live at the same version.
      await today();
      await g.getByRole("button", { name: "Turn on", exact: true }).click();
      await expect.poll(guestRows, { timeout: 20_000 }).toBe(1);
      await g.getByRole("button", { name: "Forget me on this phone" }).click();
      await g.getByRole("button", { name: "Forget", exact: true }).click();
      await g.waitForURL(/\/p(\?|#|$)/, { timeout: 30_000 });
      await expect
        .poll(async () => prisma.playerPassPush.count({ where: { endpoint: ENDPOINT } }), { timeout: 20_000, message: "a forgotten phone kept the guest's notices" })
        .toBe(0);
      const still = await prisma.playerPass.findUniqueOrThrow({ where: { playerId: guestId } });
      expect([still.version, still.revokedAt], "Forget revokes nothing").toEqual([pass.version, null]);
    } finally {
      await phone.close();
      await desk.close();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
