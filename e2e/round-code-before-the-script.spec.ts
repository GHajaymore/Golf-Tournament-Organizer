import { test, expect, type Page, type Browser } from "./coverage";
import { PrismaClient } from "@prisma/client";

/**
 * THE ROUND CODE WORKS BEFORE THE PAGE'S SCRIPT HAS ARRIVED (2026-10-25).
 *
 * On slow 3G the code box was drawn at 1.8 s and Continue could not be pressed until 7.8 s: it
 * waited for the whole of the page's script (`round-code-on-3g.spec.ts` times it). So the code
 * box and the list of names are real forms that take a press from the first paint: held on the
 * page until its script is live (`HeldBeforeLoad`), or — with no script, or none ten seconds
 * after the press — posted the plain way, and the server draws the next step. This walks each
 * path as the player on one bar would:
 *
 *   - WITH JAVASCRIPT OFF: the code, the refusals in words beside Continue (a code that is not
 *     a round's, and an empty box), the names, and the card drawn for the name tapped;
 *   - WITH THE SCRIPT HELD BACK, then let through: Continue pressed before the page is live is
 *     held on the SAME page (no plain post, which would start the scripts again) and taken up
 *     when it is live — through to a score that says Sent and that the server holds (the honest
 *     card's read-back, on this path);
 *   - WITH THE SCRIPT NEVER COMING: the held press goes as the plain post after ten seconds, the
 *     code and then the name, to a card drawn by the server;
 *   - THE SPRITE IS IN THE PAGE ONCE: the icons are drawn into the document and are not sent a
 *     second time in the page's data for React (37 KB of this page's 44 KB, before).
 *
 * WHAT IT CANNOT SEE: a press made in the instant React takes the page over (it is either side of
 * that line here, never on it), and anything about time — `round-code-on-3g.spec.ts` has that.
 *
 * Its own club, tournament, round and three invented players, deleted afterwards.
 */

const prisma = new PrismaClient();
const MARK = "zz-roundcode";
const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
const CODE = "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const NAMES = ["Hesper Quillon", "Tamsin Rookwood", "Barnaby Thistlecombe"];
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const ids = { org: "", event: "", stage: "", players: {} as Record<string, string> };

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
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross", holes: 18, accessCode: CODE },
  });
  ids.stage = stage.id;
  const flight = await prisma.group.create({ data: { eventId: event.id, name: `${MARK} flight`, position: 0 } });
  for (const [i, name] of NAMES.entries()) {
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

async function onServer(name: string): Promise<(number | null)[]> {
  const card = await prisma.scorecard.findFirst({ where: { stageId: ids.stage, playerId: ids.players[name] }, select: { strokes: true } });
  const raw = card ? (JSON.parse(card.strokes) as (number | null)[]) : [];
  return Array.from({ length: 18 }, (_, i) => raw[i] ?? null);
}

async function phone(browser: Browser, baseURL: string | undefined, use: { viewport?: { width: number; height: number } | null; userAgent?: string }, javaScriptEnabled = true) {
  return browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    viewport: use.viewport ?? { width: 393, height: 851 },
    userAgent: use.userAgent,
    isMobile: true,
    hasTouch: true,
    javaScriptEnabled,
  });
}

/**
 * Whether React has taken the page over: a control it drew carries its fiber. Not a hidden box: the
 * fields React writes into a form for its plain post are never taken over, live or not.
 */
const isLive = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('main button, main input:not([type="hidden"])');
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
  });

/** Every script of the app is held until `let()` — the page is drawn and nothing in it runs. */
async function holdTheScript(page: Page) {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  await page.route("**/_next/static/**/*.js", async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  return { let: () => open() };
}

const refusal = (page: Page) => page.locator('main [role="alert"]');

test.describe("a round code before the page's script", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "one phone is enough: this is about the script, not the width");
    test.setTimeout(120_000);
  });

  test("with JavaScript off: refusals in words beside Continue, then the names, then the card", async ({ browser, baseURL }, testInfo) => {
    const context = await phone(browser, baseURL, testInfo.project.use, false);
    try {
      const page = await context.newPage();
      await page.goto("/play");
      // CONTROL: nothing of the page's own ran — not even the tiny inline script in the layout.
      expect(await page.evaluate(() => "__thqTyped" in window), "a script ran on a page with JavaScript off").toBe(false);
      const go = page.getByRole("button", { name: "Continue" });
      await expect(go, "Continue cannot be pressed until a script arrives").toBeEnabled();

      // An empty box: the server's words, beside the button.
      await go.click();
      await expect(refusal(page)).toContainText("That doesn't look like a round code");
      // A code that is not a round's: refused in words, and what was typed is still in the box.
      await page.getByLabel("Round code").fill("ZZQQ-QQQQ");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(refusal(page)).toContainText("That code isn't valid. Check it with your organizer.");
      await expect(page.getByLabel("Round code")).toHaveValue("ZZQQ-QQQQ");
      // The refusal is said in the form the press was in, not somewhere else on the page.
      await expect(page.locator("form").filter({ has: page.getByRole("button", { name: "Continue" }) }).getByRole("alert")).toBeVisible();

      // The round's own code: the names, drawn by the server.
      await page.getByLabel("Round code").fill(CODE.toLowerCase());
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: `${MARK} Autumn Medal` })).toBeVisible();
      for (const name of NAMES) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();

      // A name: the session starts and the card is drawn, for that player.
      const documents: string[] = [];
      page.on("response", (r) => {
        if (r.request().resourceType() === "document" && r.frame() === page.mainFrame()) documents.push(`${r.request().method()} ${r.status()}`);
      });
      await page.getByRole("button", { name: NAMES[0], exact: true }).click();
      await expect(page.getByLabel("Strokes on hole 1")).toBeVisible();
      await expect(page.getByText(NAMES[0]).first()).toBeVisible();
      // …and it is a page of its own: the post answered with a redirect, so the card is a GET and a
      // reload of it reopens the card rather than posting the name again.
      expect(documents, "the card is the answer to the post itself, so a reload would post the name again").toEqual(["POST 303", "GET 200"]);
      expect((await context.cookies()).some((c) => c.name.toLowerCase().includes("play")), "no play session cookie was set").toBe(true);
    } finally {
      await context.close();
    }
  });

  test("pressed before the script arrives: the press is held on the same page and taken up when the script lands, through to a score that is Sent", async ({ browser, baseURL }, testInfo) => {
    const context = await phone(browser, baseURL, testInfo.project.use);
    try {
      const page = await context.newPage();
      const script = await holdTheScript(page);
      await page.goto("/play", { waitUntil: "commit" });
      const box = page.getByLabel("Round code");
      await box.waitFor({ timeout: 15_000 });
      await box.pressSequentially(CODE, { delay: 20 });
      // A mark on this page: a plain post would be a new page, without it.
      await page.evaluate(() => ((window as unknown as { __zzSamePage: boolean }).__zzSamePage = true));
      const go = page.getByRole("button", { name: "Continue" });
      await go.click();
      // The press was taken — the button says it is busy — and the page is still not live.
      await expect(go).toHaveAttribute("aria-busy", "true");
      expect(await isLive(page), "the page was live, so this did not test the press before the script").toBe(false);
      await page.waitForTimeout(1_500);
      await expect(page.getByRole("button", { name: NAMES[1], exact: true }), "a held press went on without the script").toHaveCount(0);

      // The script lands: the press is taken up on the same page.
      script.let();
      // CONTROL for the check above: the same question answers yes once the script is in.
      await expect.poll(() => isLive(page), { timeout: 30_000, message: "the page never went live, so `isLive` cannot tell" }).toBe(true);
      const me = page.getByRole("button", { name: NAMES[1], exact: true });
      await expect(me).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => (window as unknown as { __zzSamePage?: boolean }).__zzSamePage), "the held press became a new page").toBe(true);
      await me.click();
      const pad = page.getByRole("button", { name: /Par$/ }).first();
      await expect(pad).toBeEnabled({ timeout: 30_000 });
      await pad.click();
      await expect
        .poll(() => page.locator(".hole-nav-btn").first().getAttribute("data-sync"), { timeout: 20_000, message: "hole 1 never turned Sent" })
        .toBe("sent");
      expect((await onServer(NAMES[1]))[0], "the phone says Sent and the server does not hold hole 1").toBe(PARS[0]);
    } finally {
      await context.close();
    }
  });

  test("if the script never comes, a held press goes as the plain post ten seconds later — the code, then the name", async ({ browser, baseURL }, testInfo) => {
    const context = await phone(browser, baseURL, testInfo.project.use);
    try {
      const page = await context.newPage();
      // Held for the whole test: this page's script never arrives.
      await holdTheScript(page);
      await page.goto("/play", { waitUntil: "commit" });
      const box = page.getByLabel("Round code");
      await box.waitFor({ timeout: 15_000 });
      await box.pressSequentially(CODE, { delay: 20 });
      const pressed = Date.now();
      await page.getByRole("button", { name: "Continue" }).click();
      const me = page.getByRole("button", { name: NAMES[2], exact: true });
      await expect(me).toBeVisible({ timeout: 25_000 });
      const waited = Date.now() - pressed;
      expect(waited, "the held press went before its ten seconds were up").toBeGreaterThan(9_000);
      expect(await isLive(page)).toBe(false);
      await me.click();
      await expect(page.getByLabel("Strokes on hole 1")).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText(NAMES[2]).first()).toBeVisible();
      // A pad drawn before its script is a picture of one, and says so by being disabled.
      await expect(page.getByRole("button", { name: /Par$/ }).first()).toBeDisabled();
    } finally {
      await context.close();
    }
  });

  test("the page carries the icons once, and nothing of the player app's layout", async ({ browser, baseURL, request }, testInfo) => {
    const html = await (await request.get("/play")).text();
    // Escaped in the page's data it would read `id=\"i-bold-check\"`; either way the name is there.
    const copies = html.split("i-bold-check").length - 1;
    expect(copies, "the icon sprite is sent twice: once in the page and again in its data for React").toBe(1);
    // `next/link` in the root not-found page was filed with the player layout's chunks, so /play —
    // which is not in that layout — fetched four of them, 16 KB (2026-10-25).
    expect(html.includes("app/(player)/layout"), "/play asks for a chunk of the player app's layout").toBe(false);
    // CONTROL: the page does name its own chunks in the same place, so the absence above means something.
    expect(html.includes("app/play/page"), "the page names none of its chunks, so the check above reads nothing").toBe(true);
    // CONTROL: it IS in the page — a count of one is not a sprite gone missing.
    const context = await phone(browser, baseURL, testInfo.project.use);
    try {
      const page = await context.newPage();
      await page.goto("/play");
      await expect.poll(() => isLive(page), { timeout: 20_000 }).toBe(true);
      const symbols = await page.evaluate(() => document.querySelectorAll("#thq-icon-sprite symbol").length);
      expect(symbols, "the live page has no icon symbols").toBeGreaterThan(100);
    } finally {
      await context.close();
    }
  });
});
