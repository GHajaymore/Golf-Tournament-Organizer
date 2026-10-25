import { test, expect, type Page, type BrowserContext, type Browser } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * THE HONEST CARD (2026-10-25): every hole says where its score is, and the words are true.
 *
 * A player on a round code, on a phone, as on the first tee. The card's saves are held back at
 * the network (`page.route` on the save's POST) or the phone is put offline, so what is on the
 * phone and what is on the server can be told apart — next door to the server they arrive
 * together and no test can see which word was right.
 *
 *   three holes tapped, the saves held      → each hole reads "On your phone" within 100 ms of
 *                                             its tap, measured in the page, with the score in
 *                                             the phone's own storage by then — and the server
 *                                             does NOT have them yet
 *   the saves let go                        → each turns "Sent", and the card read back from
 *                                             the database says exactly what the phone says, on
 *                                             every hole marked Sent and on none that is not
 *   a fourth hole held while three are sent → both marks on one strip (the screenshot)
 *   no signal for three holes               → each is "On your phone" within 100 ms; the card
 *                                             says nothing alarming for one or two, and at three
 *                                             says they are only on this phone and what to do;
 *                                             signal back, all Sent, read back
 *   the committee closes the round          → the next hole is "Not sent", and the server's own
 *                                             sentence is at the hole, with what to do
 *
 * WHAT IT CANNOT SEE: a real phone's storage under pressure (private browsing is a unit test of
 * the wording), the signed-in card and the group card (the same queue and the same marks —
 * `pending-card.test.ts` holds the mapping; `offline.spec` and `slow-signal-scoring.spec` walk
 * `/me/card`), and the long outage by the clock (half an hour; the unit test holds it).
 *
 * Its own club, tournament, round and three invented players, deleted afterwards.
 */

const prisma = new PrismaClient();
const MARK = "zz-honestcard";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const CODE = "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const HELD = "Juniper Ashgrove";
const OFFLINE = "Orrin Fellwater";
const REFUSED = "Wilhelmina Thorncastle";
const ids = { org: "", event: "", stage: "", players: {} as Record<string, string> };
const TAP_BUDGET_MS = 100;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `${MARK} society`, kind: "society" } });
  ids.org = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${MARK} Autumn Medal`,
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${MARK}-${CODE}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(360)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      scoreApproval: "staff",
    },
  });
  ids.event = event.id;
  ids.stage = (
    await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: 18, accessCode: CODE },
    })
  ).id;
  const flight = await prisma.group.create({ data: { eventId: event.id, name: `${MARK} flight`, position: 0 } });
  for (const [i, name] of [HELD, OFFLINE, REFUSED].entries()) {
    const p = await prisma.player.create({
      data: { eventId: event.id, groupId: flight.id, name, email: `${MARK}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
    });
    ids.players[name] = p.id;
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

/** The card as the database holds it, one value a hole. */
async function onServer(name: string): Promise<(number | null)[]> {
  const card = await prisma.scorecard.findFirst({ where: { stageId: ids.stage, playerId: ids.players[name] }, select: { strokes: true } });
  const raw = card ? (JSON.parse(card.strokes) as (number | null)[]) : [];
  return Array.from({ length: 18 }, (_, i) => raw[i] ?? null);
}

async function phone(browser: Browser, baseURL: string | undefined, use: { viewport?: { width: number; height: number } | null; userAgent?: string }) {
  return browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    viewport: use.viewport ?? { width: 393, height: 851 },
    userAgent: use.userAgent,
    isMobile: true,
    hasTouch: true,
  });
}

/** The round code typed and the player's own name tapped, as on the first tee — then the card. */
async function enter(page: Page, name: string) {
  await page.goto("/play");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByLabel("Round code").fill(CODE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByLabel("Strokes on hole 1")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Par$/ }).first()).toBeEnabled({ timeout: 30_000 });
}

/** Every save from this page waits at the network until `let go` — a phone whose saves cannot get out. */
async function holdSaves(page: Page) {
  let release: () => void = () => {};
  let gate = new Promise<void>((r) => (release = r));
  let held = 0;
  await page.route(
    (url) => url.pathname === "/play",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      held += 1;
      await gate;
      await route.continue().catch(() => {});
    },
  );
  return {
    letGo: () => release(),
    holdAgain: () => {
      gate = new Promise<void>((r) => (release = r));
    },
    held: () => held,
  };
}

const chips = (page: Page) => page.locator(".hole-nav-btn");
const syncOf = (page: Page, hole: number) => chips(page).nth(hole - 1).getAttribute("data-sync");

/**
 * Tap Par on the hole on screen and time, IN THE PAGE, how long until that hole reads "On your
 * phone" AND its score is in the phone's own storage. Both, because the mark without the copy
 * would be a word, and the copy without the mark would be a player left guessing.
 */
async function tapAndTime(page: Page): Promise<{ hole: number; ms: number }> {
  const pad = await page.getByRole("button", { name: /Par$/ }).first().elementHandle();
  expect(pad, "no Par button on the hole").not.toBeNull();
  return pad!.evaluate(
    (el, budget) =>
      new Promise<{ hole: number; ms: number }>((resolve) => {
        const strip = [...document.querySelectorAll(".hole-nav-btn")];
        const at = strip.findIndex((c) => c.getAttribute("aria-current") === "true");
        const kept = () =>
          Object.keys(localStorage).some((k) => {
            if (!k.startsWith("tourneyhq:pending-card:")) return false;
            try {
              return (JSON.parse(localStorage.getItem(k) ?? "[]") as unknown[])[at] != null;
            } catch {
              return false;
            }
          });
        const marked = () => document.querySelectorAll(".hole-nav-btn")[at]?.getAttribute("data-sync") === "phone";
        let done = false;
        const t0 = performance.now();
        const look = () => {
          if (done) return;
          if (marked() && kept()) {
            done = true;
            observer.disconnect();
            resolve({ hole: at + 1, ms: Math.round((performance.now() - t0) * 10) / 10 });
          } else if (performance.now() - t0 > budget * 30) {
            done = true;
            observer.disconnect();
            resolve({ hole: at + 1, ms: Infinity });
          } else requestAnimationFrame(look);
        };
        const observer = new MutationObserver(look);
        observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-sync"] });
        (el as HTMLElement).click();
        look();
      }),
    TAP_BUDGET_MS,
  );
}

/** The next hole's pad is up (the card moves on by itself after a score). */
async function onHole(page: Page, hole: number) {
  await expect(page.getByLabel(`Strokes on hole ${hole}`)).toBeVisible({ timeout: 10_000 });
}

test("a tap is on the phone at once, says so at the hole, and says Sent only when the server holds it", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await phone(browser, baseURL, testInfo.project.use);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, `${HELD}, by the code`);
    await enter(page, HELD);
    const net = await holdSaves(page);

    const taps: Array<{ hole: number; ms: number }> = [];
    for (const hole of [1, 2, 3]) {
      await onHole(page, hole);
      taps.push(await tapAndTime(page));
    }
    console.log(`[honest] saves held: tap to "On your phone" and kept on the phone — ${taps.map((t) => `hole ${t.hole} ${t.ms} ms`).join(", ")}`);
    for (const t of taps) expect(t.ms, `hole ${t.hole} was not on the phone within ${TAP_BUDGET_MS} ms of its tap`).toBeLessThanOrEqual(TAP_BUDGET_MS);
    expect(taps.map((t) => t.hole), "the taps did not land on holes 1, 2 and 3").toEqual([1, 2, 3]);

    // TRUE IN THE OTHER DIRECTION: "On your phone" means the server does NOT have it.
    await expect.poll(() => net.held(), { message: "no save ever tried to leave, so nothing was held" }).toBeGreaterThan(0);
    for (const hole of [1, 2, 3]) expect(await syncOf(page, hole), `hole ${hole}`).toBe("phone");
    expect((await onServer(HELD)).slice(0, 3), "the server has holes the phone says it does not").toEqual([null, null, null]);
    // The words, at the hole: back to the 1st, which has a score.
    await chips(page).nth(0).click();
    await expect(page.locator('[data-hole-sync="phone"]')).toContainText("On your phone");
    await expect(page.getByRole("status").filter({ hasText: /^Sent/ }), "the card line says Sent while every save is held").toHaveCount(0);

    net.letGo();
    for (const hole of [1, 2, 3]) await expect.poll(() => syncOf(page, hole), { timeout: 20_000, message: `hole ${hole} never turned Sent` }).toBe("sent");
    await expect(page.locator('[data-hole-sync="sent"]')).toContainText("Sent");
    await expect(page.getByRole("status").filter({ hasText: "Sent — 3 of 18 holes in" })).toBeVisible();

    // READ BACK: every hole the phone calls Sent is on the server with the score the phone shows;
    // every hole it does not is not.
    const stored = await onServer(HELD);
    for (let hole = 1; hole <= 18; hole += 1) {
      const s = await syncOf(page, hole);
      if (s === "sent") expect(stored[hole - 1], `hole ${hole} reads Sent and the server holds ${stored[hole - 1]}`).toBe(PARS[hole - 1]);
      else expect(stored[hole - 1], `hole ${hole} reads ${s} and the server holds a score`).toBeNull();
    }
    expect(stored.slice(0, 3)).toEqual(PARS.slice(0, 3));

    // Both states on one strip: three sent, the fourth held on the phone.
    net.holdAgain();
    await chips(page).nth(3).click();
    await onHole(page, 4);
    const fourth = await tapAndTime(page);
    console.log(`[honest] a fourth hole while three are sent: ${fourth.ms} ms`);
    expect(fourth.ms).toBeLessThanOrEqual(TAP_BUDGET_MS);
    await chips(page).nth(3).click();
    await expect(page.locator('[data-hole-sync="phone"]')).toBeVisible();
    expect(await syncOf(page, 3)).toBe("sent");
    expect(await syncOf(page, 4)).toBe("phone");
    const shot = testInfo.outputPath("honest-card-both-states.png");
    await page.screenshot({ path: shot });
    await testInfo.attach("honest card, both states", { path: shot, contentType: "image/png" });
    console.log(`[honest] screenshot: ${shot}`);
    net.letGo();
    await expect.poll(() => syncOf(page, 4), { timeout: 20_000 }).toBe("sent");
    expect((await onServer(HELD))[3]).toBe(PARS[3]);
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("with no signal each hole is kept, and a long outage says so — then all of it is Sent and on the server", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const ctx: BrowserContext = await phone(browser, baseURL, testInfo.project.use);
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors, `${OFFLINE}, by the code`);
    // The page's clock, so the minutes a long outage takes can be walked without waiting them out.
    await page.clock.install();
    await enter(page, OFFLINE);
    await ctx.setOffline(true);
    const line = page.getByRole("status").filter({ hasText: /./ }).first();
    const warning = /only on this phone/;

    const taps: Array<{ hole: number; ms: number }> = [];
    for (const hole of [1, 2, 3]) {
      await onHole(page, hole);
      taps.push(await tapAndTime(page));
      // One or two holes in a dead spot is an ordinary day on a course, and three typed in one
      // breath are a player catching up: calm, no warning — "No signal", kept, will send.
      await expect(page.getByRole("status").filter({ hasText: /no signal/i })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("status").filter({ hasText: warning }), `the outage warning is up after ${hole} hole(s) and a few seconds`).toHaveCount(0);
    }
    console.log(`[honest] offline: tap to "On your phone" and kept on the phone — ${taps.map((t) => `hole ${t.hole} ${t.ms} ms`).join(", ")}`);
    for (const t of taps) expect(t.ms, `hole ${t.hole} was not on the phone within ${TAP_BUDGET_MS} ms with no signal`).toBeLessThanOrEqual(TAP_BUDGET_MS);
    // Still nothing out a few minutes later: now it is an outage, and the card says so.
    await page.clock.fastForward("03:00");
    await expect(page.getByRole("status").filter({ hasText: "3 holes are only on this phone" }), "three holes and three minutes with no signal and the card did not say so").toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status").filter({ hasText: /show this card to the committee/i })).toBeVisible();
    expect((await onServer(OFFLINE)).slice(0, 3)).toEqual([null, null, null]);

    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    for (const hole of [1, 2, 3]) await expect.poll(() => syncOf(page, hole), { timeout: 20_000, message: `hole ${hole} never turned Sent` }).toBe("sent");
    await expect(line).toContainText("Sent — 3 of 18 holes in");
    await expect(page.getByRole("status").filter({ hasText: warning })).toHaveCount(0);
    expect((await onServer(OFFLINE)).slice(0, 3), "the phone says Sent and the server does not have the holes").toEqual(PARS.slice(0, 3));
    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test("a save the server refuses says so at the hole, in the server's words, with what to do", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await phone(browser, baseURL, testInfo.project.use);
  try {
    const page = await ctx.newPage();
    await enter(page, REFUSED);
    // At the desk meanwhile, the committee closes the round.
    await prisma.stage.update({ where: { id: ids.stage }, data: { closedAt: new Date() } });
    await onHole(page, 1);
    await tapAndTime(page);
    await expect.poll(() => syncOf(page, 1), { timeout: 20_000, message: "a refused hole never said Not sent" }).toBe("refused");
    await chips(page).nth(0).click();
    const atHole = page.locator('[data-hole-sync="refused"]');
    await expect(atHole).toContainText("Not sent");
    await expect(atHole, "the server's own sentence is not at the hole").toContainText("The committee has closed this round");
    await expect(atHole, "the hole does not say what to do").toContainText(/show this card to the committee/i);
    await expect(atHole).toBeInViewport();
    expect((await onServer(REFUSED))[0], "a refused hole is on the server").toBeNull();
    // Never Sent over a refusal, on the hole or the card's line.
    expect(await syncOf(page, 1)).not.toBe("sent");
    await expect(page.getByRole("status").filter({ hasText: /^Sent/ })).toHaveCount(0);
  } finally {
    await prisma.stage.update({ where: { id: ids.stage }, data: { closedAt: null } }).catch(() => {});
    await ctx.close();
  }
});
