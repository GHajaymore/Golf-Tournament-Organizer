import { test, expect, type Page, type BrowserContext } from "./coverage";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND CODE ON A SLOW 3G CONNECTION, TIMED FROM A COLD /play TO A CARD THAT TAKES A SCORE
 * (2026-10-25).
 *
 * The honest card's third promise, and the testing panel's number: a round code opens a card
 * within two seconds on 3G. Every other spec opens a card next door to the server, where the whole
 * page is there in a few hundred milliseconds; on the first tee it comes down one bar of signal.
 * This throttles the browser's own network to slow 3G as Chrome's DevTools define it — 400 kbit/s
 * each way, 400 ms of latency on every request — and times the round code the way a player meets
 * it, from the moment the link is opened:
 *
 *   the code page, cold                 → the box is on screen, and Continue can be pressed
 *   Continue                            → the field's names are on screen
 *   their own name tapped               → the card is on screen, and its pad can be TAPPED
 *                                         (a pad drawn before its script is a picture of one —
 *                                         `usePageIsLive` keeps it disabled until it works)
 *
 * TWO PLAYERS, because the two are different requests:
 *
 *   - THE QUICK THUMB types the code the instant the box is drawn. On this connection the page's
 *     script is seconds behind its picture, so Continue is pressed before it, and the code and the
 *     name go as plain form posts (`redeemRoundCodeForm`, `claimPlayerSlotForm`). Until
 *     2026-10-25 Continue could not be pressed until the whole script was in — 7.8 s on this
 *     throttle, measured — so this is the case that was slow. Asserted: Continue is pressable the
 *     moment the box is drawn, and within two seconds of opening the link; the whole flow is
 *     printed, with what it could not get under, and held to a ceiling so it cannot creep back.
 *   - THE PLAYER WHO READ THE CODE OFF THE SHEET first, by which time the page is live. Asserted,
 *     as before: under two seconds from the tap on their name to a pad that takes a score.
 *
 * Each prints its figures and what came down the wire, so a run says where the time went rather
 * than only whether there was too much of it.
 *
 * WHAT IT CANNOT SEE: a real phone's CPU (Playwright's Chromium on a desktop parses the script in a
 * fraction of a phone's time, so this is the network's share of the wait and no more), a radio
 * that has to wake up, packet loss, and HTTP/2's priorities — DevTools' throttle shares the line
 * between every request alike, so the style sheet waits behind the scripts here as it would not on
 * Vercel. And the fonts: a Windows build hints none, so on this machine they are found late; on
 * Linux (CI, production) they are hinted and start early. Chromium only: the throttle is the
 * DevTools protocol's.
 *
 * Its own club, tournament, round and two invented players, deleted afterwards.
 */

const prisma = new PrismaClient();
const MARK = "zz-roundcode-3g";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const randomCode = () => "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const CODE = randomCode();
const NAMES = ["Juniper Ashgrove", "Orrin Fellwater"];
const ids = { org: "", event: "" };

/** Slow 3G, as Chrome's DevTools preset has it: 400 kbit/s each way, 400 ms a request. */
const SLOW_3G = { offline: false, latency: 400, downloadThroughput: (400 * 1000) / 8, uploadThroughput: (400 * 1000) / 8 };
/** The panel's number. */
const TARGET_MS = 2_000;
/**
 * THE QUICK THUMB'S WHOLE FLOW, held as a ceiling rather than the target, because the target is not
 * reachable on this throttle by any page that needs a script to take a score: the framework alone
 * is about 104 KB compressed, two seconds of this line before a byte of the app, and the fonts are
 * another 105 KB beside it. Measured on 2026-10-25 (Windows build), before → after the forms worked
 * without the script: Continue 8.3 → 1.9 s, the names 9.2 → 3.3 s, the card drawn 10.6 → 5.8 s,
 * and the pad taking a score 10.6 → 10.3 s — the plain posts move the player on, and each one
 * leaves a page whose half-fetched scripts and fonts start again on the next. Lower this when the
 * run says it can come down.
 */
const QUICK_CEILING_MS = 12_000;

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
  for (const [i, name] of NAMES.entries()) {
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
const wire = (w: Record<string, number>) => Object.entries(w).map(([k, n]) => `${k} ${kb(n)}`).join(", ");

/** Whether React has taken this box over yet — the page's script has arrived and is running. */
const isLive = (page: Page) =>
  page.evaluate(() => {
    const box = document.getElementById("play-round-code");
    return !!box && Object.keys(box).some((k) => k.startsWith("__reactFiber$"));
  });

async function phone(browser: import("@playwright/test").Browser, baseURL: string | undefined, testInfo: import("@playwright/test").TestInfo) {
  const u = testInfo.project.use;
  return browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    viewport: u.viewport ?? { width: 393, height: 851 },
    userAgent: u.userAgent,
    isMobile: true,
    hasTouch: true,
  });
}

test.describe("a round code on slow 3G", () => {
  test.beforeEach(async ({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "the slow-3G throttle is Chromium's DevTools protocol");
    test.skip(testInfo.project.name !== "phone", "timed once, as the phone that has to carry it");
    test.setTimeout(180_000);
  });

  test("the quick thumb: Continue works the moment the box is drawn, and the whole flow is timed", async ({ browser, baseURL }, testInfo) => {
    const context = await phone(browser, baseURL, testInfo);
    try {
      const page = await context.newPage();
      const net = await onSlow3G(context, page);

      // Nothing of the app is on this phone yet.
      const opened = Date.now();
      await page.goto("/play", { waitUntil: "commit" });
      const box = page.getByLabel("Round code");
      await expect(box).toBeVisible({ timeout: 60_000 });
      const drawn = Date.now() - opened;
      await box.pressSequentially(CODE);
      const go = page.getByRole("button", { name: "Continue" });
      await expect(go).toBeEnabled({ timeout: 60_000 });
      const pressable = Date.now() - opened;
      // CONTROL: this IS the case that was slow — the page's script had not arrived when the
      // button could be pressed. Were it live already, this test would be timing the other path.
      const liveAtPress = await isLive(page);

      await go.click();
      const me = page.getByRole("button", { name: NAMES[0], exact: true });
      await expect(me).toBeVisible({ timeout: 60_000 });
      const names = Date.now() - opened;

      await me.click();
      await expect(page.getByLabel("Strokes on hole 1")).toBeVisible({ timeout: 60_000 });
      const card = Date.now() - opened;
      const pad = page.getByRole("button", { name: /Par$/ }).first();
      await expect(pad).toBeEnabled({ timeout: 60_000 });
      const ready = Date.now() - opened;
      const w = net.weighed();

      console.log(
        `[3g quick thumb] from opening /play: box drawn ${drawn} ms, Continue pressable ${pressable} ms ` +
          `(page live then: ${liveAtPress ? "yes" : "no"}) · names on screen ${names} ms · card drawn ${card} ms · ` +
          `pad takes a score ${ready} ms (target ${TARGET_MS} ms: ${ready < TARGET_MS ? "met" : `not met by ${ready - TARGET_MS} ms`}) · ` +
          `the whole flow brought down ${wire(w)}`,
      );
      // CONTROL: the throttle was on. A page over 400 ms of latency cannot be drawn in less.
      expect(drawn, "the code page was drawn faster than one slow-3G round trip, so the throttle was not on").toBeGreaterThan(SLOW_3G.latency);
      expect(liveAtPress, "the page's script was already running when Continue could be pressed, so the plain-form path was not timed").toBe(false);
      // THE CODE PAGE'S OWN PROMISE: pressable when it is drawn, not when its script arrives.
      expect(pressable - drawn, `Continue woke ${pressable - drawn} ms after the box was drawn`).toBeLessThan(500);
      expect(pressable, `Continue could be pressed only ${pressable} ms after the link was opened`).toBeLessThan(TARGET_MS + 500);
      expect(ready, `a quick thumb waited ${ready} ms from opening /play for a pad that takes a score`).toBeLessThan(QUICK_CEILING_MS);
    } finally {
      await context.close();
    }
  });

  test("the player who read the code first: from their name to a pad that takes a score within two seconds", async ({ browser, baseURL }, testInfo) => {
    const context = await phone(browser, baseURL, testInfo);
    try {
      const page = await context.newPage();
      const net = await onSlow3G(context, page);

      const opened = Date.now();
      await page.goto("/play", { waitUntil: "commit" });
      const box = page.getByLabel("Round code");
      await expect(box).toBeVisible({ timeout: 60_000 });
      const drawn = Date.now() - opened;
      // Reading the code off the sheet: by the time they type, the page is live.
      await expect.poll(() => isLive(page), { timeout: 60_000 }).toBe(true);
      const live = Date.now() - opened;
      await box.pressSequentially(CODE);
      const go = page.getByRole("button", { name: "Continue" });
      await expect(go).toBeEnabled();

      let t = Date.now();
      await go.click();
      const me = page.getByRole("button", { name: NAMES[1], exact: true });
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
      // The claim's answer can still be closing when the pad wakes; weigh it once it has.
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      const w = net.weighed();

      console.log(
        `[3g read first] the code page drawn ${drawn} ms, live ${live} ms · names on screen ${namesShown} ms after Continue · ` +
          `card drawn ${cardDrawn} ms, pad takes a score ${cardLive} ms after the name was tapped · the card brought down ${wire(w)}`,
      );
      // CONTROL: the throttle was on. A page over 400 ms of latency cannot arrive in less.
      expect(cardDrawn, "the card arrived faster than one slow-3G round trip, so the throttle was not on").toBeGreaterThan(SLOW_3G.latency);
      expect(cardLive, `a round code took ${cardLive} ms to open a card that takes a score on slow 3G`).toBeLessThan(TARGET_MS);
    } finally {
      await context.close();
    }
  });
});
