import { test, expect, type Page, type BrowserContext } from "./coverage";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND CODE OPENS A CARD WITHIN TWO SECONDS ON A SLOW 3G CONNECTION (2026-10-25).
 *
 * The honest card's third promise, and the testing panel's number. Every other spec opens a card
 * next door to the server, where the whole page is there in a few hundred milliseconds; on the
 * first tee it comes down one bar of signal. This one throttles the browser's own network to slow
 * 3G as Chrome's DevTools define it — 400 kbit/s each way, 400 ms of latency on every request —
 * and times the round code the way a player meets it:
 *
 *   the code page, cold                 → the box is on screen and Continue can be pressed
 *   Continue                            → the field's names are on screen
 *   their own name tapped               → the card is on screen, and its pad can be TAPPED
 *                                         (a pad drawn before its script is a picture of one —
 *                                         `usePageIsLive` keeps it disabled until it works)
 *
 * The last is the promise, and it is asserted: under two seconds from the tap to a pad that takes
 * a score. The others are printed, with what came down the wire for the card, so a run says where
 * the time went rather than only whether there was too much of it.
 *
 * WHAT IT CANNOT SEE: a real phone's CPU (Playwright's Chromium on a desktop parses the script in a
 * fraction of a phone's time, so this is the network's share of the wait and no more), a radio
 * that has to wake up, and packet loss. Chromium only: the throttle is the DevTools protocol's.
 *
 * Its own club, tournament, round and two invented players, deleted afterwards.
 */

const prisma = new PrismaClient();
const MARK = "zz-honestcard-3g";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const CODE = "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const NAME = "Juniper Ashgrove";
const ids = { org: "", event: "" };

/** Slow 3G, as Chrome's DevTools preset has it: 400 kbit/s each way, 400 ms a request. */
const SLOW_3G = { offline: false, latency: 400, downloadThroughput: (400 * 1000) / 8, uploadThroughput: (400 * 1000) / 8 };
const BUDGET_MS = 2_000;

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Spring Medal`,
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${CODE}`,
      customPars: JSON.stringify([4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5]),
      customYards: JSON.stringify(new Array(18).fill(360)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      scoreApproval: "staff",
    },
  });
  ids.event = event.id;
  await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: 18, accessCode: CODE },
  });
  const flight = await prisma.group.create({ data: { eventId: event.id, name: `${MARK} flight`, position: 0 } });
  for (const [i, name] of [NAME, "Orrin Fellwater"].entries()) {
    await prisma.player.create({
      data: { eventId: event.id, groupId: flight.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
    });
  }
});

test.afterAll(async () => {
  try {
    if (ids.event) await prisma.event.deleteMany({ where: { id: ids.event } });
    if (ids.org) await prisma.organization.deleteMany({ where: { id: ids.org } });
  } finally {
    await prisma.$disconnect();
  }
});

/** Bytes that came down the wire, by kind, from the moment it is called. */
async function onSlow3G(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await cdp.send("Network.emulateNetworkConditions", SLOW_3G);
  const kind = new Map<string, string>();
  const bytes = new Map<string, number>();
  cdp.on("Network.responseReceived", (e) => kind.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => bytes.set(e.requestId, e.encodedDataLength));
  return {
    weighed: () => {
      const w: Record<string, number> = {};
      for (const [id, n] of bytes) w[kind.get(id) ?? "Other"] = (w[kind.get(id) ?? "Other"] ?? 0) + n;
      return w;
    },
    reset: () => {
      kind.clear();
      bytes.clear();
    },
  };
}

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

test("a round code opens a card that takes a score within two seconds on slow 3G", async ({ browser, baseURL, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "the slow-3G throttle is Chromium's DevTools protocol");
  test.skip(testInfo.project.name !== "phone", "timed once, as the phone that has to carry it");
  test.setTimeout(180_000);
  const u = testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    viewport: u.viewport ?? { width: 393, height: 851 },
    userAgent: u.userAgent,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    const net = await onSlow3G(context, page);

    // The code page, cold: nothing of the app is on this phone yet.
    let t = Date.now();
    await page.goto("/play", { waitUntil: "commit" });
    const box = page.getByLabel("Round code");
    await expect(box).toBeVisible({ timeout: 60_000 });
    const codeDrawn = Date.now() - t;
    await box.pressSequentially(CODE);
    const go = page.getByRole("button", { name: "Continue" });
    await expect(go).toBeEnabled({ timeout: 60_000 });
    const codeLive = Date.now() - t;

    t = Date.now();
    await go.click();
    const me = page.getByRole("button", { name: NAME, exact: true });
    await expect(me).toBeVisible({ timeout: 60_000 });
    const namesShown = Date.now() - t;

    // THE PROMISE: from the tap on their own name to a pad that takes a score.
    net.reset();
    t = Date.now();
    await me.click();
    await expect(page.getByLabel("Strokes on hole 1")).toBeVisible({ timeout: 60_000 });
    const cardDrawn = Date.now() - t;
    const pad = page.getByRole("button", { name: /Par$/ }).first();
    await expect(pad).toBeEnabled({ timeout: 60_000 });
    const cardLive = Date.now() - t;
    const w = net.weighed();

    console.log(
      `[3g] the code page drawn ${codeDrawn} ms, Continue pressable ${codeLive} ms · ` +
        `names on screen ${namesShown} ms after Continue · ` +
        `card drawn ${cardDrawn} ms, pad takes a score ${cardLive} ms after the name was tapped · ` +
        `the card brought down ${Object.entries(w).map(([k, n]) => `${k} ${kb(n)}`).join(", ")}`,
    );
    // CONTROL: the throttle was on. A page over 400 ms of latency cannot arrive in less.
    expect(cardDrawn, "the card arrived faster than one slow-3G round trip, so the throttle was not on").toBeGreaterThan(SLOW_3G.latency);
    expect(cardLive, `a round code took ${cardLive} ms to open a card that takes a score on slow 3G`).toBeLessThan(BUDGET_MS);
  } finally {
    await context.close();
  }
});
