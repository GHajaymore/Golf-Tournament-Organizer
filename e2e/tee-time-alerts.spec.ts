import { test, expect, type Page } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signInWith, memberSession, NAMES, centre } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * A MEMBER TURNS TEE-TIME ALERTS ON, AND OFF AGAIN, FROM THEIR TODAY SCREEN.
 *
 * The card on Today ("Get tee-time alerts") is how a member opts a phone in to web push.
 * Pressing it asks the browser for permission, asks the SERVER for its public key
 * (`getVapidPublicKey`), has the browser subscribe, and hands the subscription back to be kept
 * (`savePushSubscription`); "Turn off" asks the server to forget it (`removePushSubscription`).
 * None of the three was pressed by any browser test, because a test browser has no push service.
 *
 *   before                 the card is offered; nothing is kept for this address
 *   Turn on                the line becomes "Tee-time alerts are on." and ONE row is kept, under the member's own address
 *   Turn off               the card is offered again and the row is gone
 *
 * THE BROWSER'S SIDE IS STOOD IN FOR, THE SERVER'S IS NOT. Chromium's push service (Google's) is
 * unreachable from a CI machine and Safari's needs an installed app, so the page is given a device
 * that grants permission and subscribes to an invented endpoint (`push.example.invalid`) — the
 * same three calls the real one answers. Every server action in the chain is the real one, over
 * the real network, and the row is read from the database. WHAT IT CANNOT SEE: a push arriving
 * on a phone (that needs a real device, and is on the parked list), or the real browser refusing.
 * The server is given only the PUBLIC half of a key (`playwright.config.ts`), so nothing is ever sent.
 *
 * Its own club and member, marked zz-, removed in a finally. Walked at laptop and phone size.
 */

const WALKED = ["desktop", "phone"];

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 20_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

/** A device that can be subscribed: permission granted, one push subscription kept in memory. */
async function giveThePageAPushDevice(page: Page, endpoint: string) {
  await page.addInitScript((endpointOfThisDevice: string) => {
    let kept: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = null;
    const registration = {
      pushManager: {
        getSubscription: async () => kept,
        subscribe: async () => {
          kept = {
            endpoint: endpointOfThisDevice,
            toJSON: () => ({ endpoint: endpointOfThisDevice, keys: { p256dh: "zz-p256dh-key", auth: "zz-auth-secret" } }),
            unsubscribe: async () => {
              kept = null;
              return true;
            },
          };
          return kept;
        },
      },
    };
    const w = window as unknown as Record<string, unknown>;
    if (!("PushManager" in window)) w.PushManager = function PushManager() {};
    Object.defineProperty(navigator.serviceWorker, "getRegistration", { configurable: true, value: async () => registration });
    Object.defineProperty(navigator.serviceWorker, "ready", { configurable: true, get: () => Promise.resolve(registration) });
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
    Notification.requestPermission = async () => "granted";
  }, endpoint);
}

test("a member turns tee-time alerts on from Today, and off again: the server keeps the device, then forgets it", async ({ browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  const mark = `zz-alerts-${testInfo.project.name}`;
  const endpoint = `https://push.example.invalid/${mark}-${Date.now()}`;
  const club = await makeClub(mark);
  try {
    const { event, players } = await makeEvent(club, "Spring Medal", { status: "live", stages: [{}], players: 2 });
    const me = { email: players[0].email!, name: NAMES[0] };
    const { session } = await memberSession(event.id, me.email, me.name);
    const ctx = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: undefined });
    try {
      await signInWith(ctx, baseURL!, session, event.id);
      const page = await ctx.newPage();
      watchPageErrors(page, errors, "member");
      await giveThePageAPushDevice(page, endpoint);
      const kept = () => prisma.pushSubscription.findMany({ where: { endpoint } });

      await page.goto(`/me?bust=${Date.now()}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      // What a player only sometimes wants sits behind one extender on Today.
      const more = page.locator("summary", { hasText: /^More:/ });
      if (await more.count()) await more.first().click();

      const answered = () => page.waitForResponse((r) => r.request().method() === "POST" && "next-action" in r.request().headers(), { timeout: 60_000 });

      await test.step("before: the card offers alerts, and the server holds nothing for this device", async () => {
        await expect(page.getByText("Get tee-time alerts"), "Today does not offer tee-time alerts").toBeVisible({ timeout: 30_000 });
        expect(await kept(), "the fixture's device is already kept").toHaveLength(0);
      });

      await test.step("Turn on: the line says alerts are on, and one row is kept under the member's own address", async () => {
        const on = page.getByRole("button", { name: "Turn on" });
        await centre(on);
        const first = answered();
        await on.click();
        await first;
        await expect(page.getByText("Tee-time alerts are on."), "pressing Turn on did not turn alerts on").toBeVisible({ timeout: 30_000 });
        await expect.poll(async () => (await kept()).length, { message: "the server kept no subscription for the device", timeout: 20_000 }).toBe(1);
        const [row] = await kept();
        expect(row.email, "the subscription is not filed under the member who pressed Turn on").toBe(me.email.toLowerCase());
        expect(row.auth).toBe("zz-auth-secret");
      });

      await test.step("Turn off: the card is offered again and the row is gone", async () => {
        const off = page.getByRole("button", { name: "Turn off" });
        await centre(off);
        const next = answered();
        await off.click();
        await next;
        await expect(page.getByText("Get tee-time alerts"), "pressing Turn off did not offer alerts again").toBeVisible({ timeout: 30_000 });
        await expect.poll(async () => (await kept()).length, { message: "the server still holds the device after Turn off", timeout: 20_000 }).toBe(0);
      });
    } finally {
      await ctx.close().catch(() => {});
    }
  } finally {
    await prisma.pushSubscription.deleteMany({ where: { endpoint } }).catch(() => {});
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
