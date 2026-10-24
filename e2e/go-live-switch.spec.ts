import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page, type Browser } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { signedInNow } from "../scripts/session-cookie.mjs";
import { landingSettled } from "./landing-settled";
import { LAUNCH_SURFACES, OWNER_CARD, FRONT_DOOR, type LaunchSurface } from "../src/lib/go-live";

/**
 * ONE PRESS CHANGES EVERYTHING HELD FOR LAUNCH, AND ONE PRESS HOLDS IT ALL AGAIN (Ajay, 2026-10-23:
 * "I just need one switch to say let's go live and that should change coming soon or any blockades
 * to online").
 *
 *   held     every page in the inventory says its held words, and none of its live ones
 *   Go live  the owner card lists what will change (from the inventory), asks in a dialog, says so
 *   live     every page says its live words, and none of its held ones; the card says since when
 *   Hold     one press, asked once more, and the front door is held again
 *
 * THE LIST OF PAGES IS NOT WRITTEN HERE. It is `LAUNCH_SURFACES` in `src/lib/go-live.ts`: a place
 * added there with a `probe` is walked both ways by this spec the day it is added. And the sweep's
 * own CONTROL — a "surface" that says the same thing whatever the switch says — must be reported as
 * not following, or a sweep that cannot fail would be reporting the app correct.
 *
 * IT NEEDS A SERVER THAT HOLDS, which no standing server does: dev, CI and the e2e server are not
 * production and are never held (`signInsClosed`). Start one of your own, on your own port:
 *
 *   SIGNIN_ALLOW_EMAILS=zz-go-live-owner@example.invalid OWNER_EMAILS=zz-go-live-owner@example.invalid \
 *   AUTH_SECRET=<a throwaway> NEXT_DIST_DIR=.next-golive NEXT_NO_STANDALONE=1 npm run build && … next start --port <p>
 *
 * Against any other server it does not pretend: it says NOT WALKED and why, and stops.
 *
 * WHAT IT CANNOT SEE: a refused sign-in (a door is a refusal, not a page — held to real rows in
 * `the-launch-switch.audit.test.ts`), the copy to inquiries@ (no mail leaves a test), and /faq's last
 * call to action, drawn only while the contact address is switched off. It writes the shared
 * "signins" row of the development database and puts it back exactly as it was.
 */

test.describe.configure({ mode: "serial" });

const prisma = new PrismaClient();
const OWNER = process.env.E2E_GO_LIVE_OWNER ?? "zz-go-live-owner@example.invalid";
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v: string) => `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
const CAPTURE = process.env.GO_LIVE_CAPTURE ?? "";
let ownerCookie = "";
let saved: { value: string } | null = null;

/** Everything a page SAYS — its text (closed menus and folded answers included), its title and description. */
async function said(page: Page, path: string): Promise<string> {
  const res = await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  expect(res?.status(), `${path} answered ${res?.status()}`).toBe(200);
  if (path === "/") await landingSettled(page);
  return page.evaluate(() => {
    const parts: string[] = [document.title];
    for (const m of Array.from(document.querySelectorAll("meta[name='description'], meta[property='og:description']"))) {
      parts.push(m.getAttribute("content") ?? "");
    }
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement?.tagName ?? "") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    while (walk.nextNode()) parts.push(walk.currentNode.nodeValue ?? "");
    return parts.join(" ").replace(/\s+/g, " ");
  });
}

/** What is wrong with one surface, held and live — empty when it follows the switch both ways. */
function verdict(s: LaunchSurface, held: string, live: string): string[] {
  const p = s.probe!;
  const wrong: string[] = [];
  if (!held.includes(p.held)) wrong.push(`${s.id}: held, ${p.path} does not say “${p.held}”`);
  if (held.includes(p.live)) wrong.push(`${s.id}: held, ${p.path} still says the live “${p.live}”`);
  if (!live.includes(p.live)) wrong.push(`${s.id}: live, ${p.path} does not say “${p.live}”`);
  if (live.includes(p.held)) wrong.push(`${s.id}: live, ${p.path} still says the held “${p.held}”`);
  return wrong;
}

/** Every page the inventory names, as the person who would open it. */
async function readAll(browser: Browser, baseURL: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const visitor = await browser.newContext({ baseURL });
  const owner = await browser.newContext({ baseURL });
  await owner.addCookies([{ name: "ng_session", value: ownerCookie, url: baseURL }]);
  try {
    const [v, o] = [await visitor.newPage(), await owner.newPage()];
    for (const s of LAUNCH_SURFACES) {
      if (!s.probe) continue;
      const key = `${s.probe.as ?? "visitor"} ${s.probe.path}`;
      if (!out.has(key)) out.set(key, await said(s.probe.as === "owner" ? o : v, s.probe.path));
    }
  } finally {
    await visitor.close();
    await owner.close();
  }
  return out;
}

const textOf = (pages: Map<string, string>, s: LaunchSurface) => pages.get(`${s.probe!.as ?? "visitor"} ${s.probe!.path}`) ?? "";

async function capture(page: Page, name: string, what: "card" | "door") {
  if (!CAPTURE) return;
  mkdirSync(CAPTURE, { recursive: true });
  const file = join(CAPTURE, `${name}.png`);
  if (what === "card") await page.locator("#accounts").screenshot({ path: file });
  else await page.screenshot({ path: file });
}

test.beforeAll(async () => {
  saved = await prisma.platformSetting.findUnique({ where: { key: "signins" }, select: { value: true } });
  await prisma.user.deleteMany({ where: { email: OWNER } });
  const owner = await prisma.user.create({ data: { email: OWNER, name: "Zz Go-live Owner", password: "x:unusable" } });
  ownerCookie = sign(signedInNow(owner.id));
});

test.afterAll(async () => {
  try {
    // The whole app's switch, back exactly as it was.
    if (saved) await prisma.platformSetting.upsert({ where: { key: "signins" }, update: { value: saved.value }, create: { key: "signins", value: saved.value } });
    else await prisma.platformSetting.deleteMany({ where: { key: "signins" } });
    await prisma.user.deleteMany({ where: { email: OWNER } });
  } finally {
    await prisma.$disconnect();
  }
});

test("one press takes every held page live, and one press holds them all again", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const width = page.viewportSize()?.width ?? 0;
  await prisma.platformSetting.deleteMany({ where: { key: "signins" } });

  // NOT WALKED, AND SAYS SO, on a server that is never held — every standing one.
  const door = await said(page, "/");
  if (!door.includes(FRONT_DOOR.held.heroCta)) {
    testInfo.annotations.push({ type: "NOT WALKED", description: "this server never holds accounts; start one with SIGNIN_ALLOW_EMAILS (see the header)" });
    console.log("[go-live-switch] NOT WALKED: this server never holds accounts — see the spec's header for the server to start.");
    test.skip(true, "this server never holds accounts");
  }
  await capture(page, `front-door-held-${width}`, "door");

  const held = await test.step("held: every page in the inventory, as its reader", async () => readAll(browser, baseURL!));

  await test.step("the owner card says what Go live will do, from the inventory, and asks in a dialog", async () => {
    await page.context().addCookies([{ name: "ng_session", value: ownerCookie, url: baseURL! }]);
    await page.goto(`/owner?bust=${Date.now()}`);
    const card = page.locator("#accounts");
    await expect(card).toContainText(OWNER_CARD.held);
    await expect(card).toContainText(OWNER_CARD.willGoLive);
    // One line per place in the inventory, each saying what that place will show live.
    const lines = card.locator("ul").first().locator("li");
    await expect(lines).toHaveCount(LAUNCH_SURFACES.length);
    for (const [i, s] of LAUNCH_SURFACES.entries()) await expect(lines.nth(i)).toContainText(s.live);
    await capture(page, `owner-card-held-${width}`, "card");

    await card.getByRole("button", { name: OWNER_CARD.goLive }).click();
    const dialog = page.getByRole("dialog", { name: OWNER_CARD.goLiveTitle });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(OWNER_CARD.goLiveNote(LAUNCH_SURFACES.length));
    // A dialog inside the screen, at every width this runs at.
    const box = await dialog.boundingBox();
    const vp = page.viewportSize()!;
    expect(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, `the dialog is not on the screen: ${JSON.stringify(box)}`).toBe(true);
    if (CAPTURE) await page.screenshot({ path: join(CAPTURE, `owner-dialog-${width}.png`) });
    expect(await prisma.platformSetting.findUnique({ where: { key: "signins" } }), "the first press went live without asking").toBeNull();
    await dialog.getByRole("button", { name: OWNER_CARD.goLiveConfirm }).click();
    await expect(card.getByRole("status")).toContainText(OWNER_CARD.wentLive);
    await expect.poll(async () => (await prisma.platformSetting.findUnique({ where: { key: "signins" } }))?.value).toBe("open");
  });

  await test.step("live: the card says since when, and what Hold again would do", async () => {
    await page.goto(`/owner?bust=${Date.now()}`);
    const card = page.locator("#accounts");
    await expect(card).toContainText("Live since ");
    await expect(card).toContainText(OWNER_CARD.willHold);
    const lines = card.locator("ul").first().locator("li");
    for (const [i, s] of LAUNCH_SURFACES.entries()) await expect(lines.nth(i)).toContainText(s.held);
    await capture(page, `owner-card-live-${width}`, "card");
  });

  const live = await test.step("live: every page in the inventory, as its reader", async () => readAll(browser, baseURL!));
  if (CAPTURE) {
    const v = await browser.newContext({ baseURL, viewport: page.viewportSize()! });
    const p = await v.newPage();
    await p.goto(`/?bust=${Date.now()}`);
    await landingSettled(p);
    await capture(p, `front-door-live-${width}`, "door");
    await v.close();
  }

  await test.step("every surface follows the switch both ways", async () => {
    const probed = LAUNCH_SURFACES.filter((s) => s.probe);
    expect(probed.length, "the inventory has lost its probes").toBeGreaterThanOrEqual(12);
    const wrong = probed.flatMap((s) => verdict(s, textOf(held, s), textOf(live, s)));
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  await test.step("CONTROL: a place that ignores the switch is reported", async () => {
    // The round-code button is the same held and live, as it must be — so as a "surface" it fails.
    const deaf: LaunchSurface = { id: "control", where: "", held: "", live: "", before: "wired", probe: { path: "/", held: "I have a round code", live: "I have a round code" } };
    expect(verdict(deaf, textOf(held, deaf), textOf(live, deaf)).length, "the sweep passed a place that ignores the switch").toBeGreaterThan(0);
    // …and it really is on both pages, so the control fails for the right reason.
    expect(textOf(held, deaf)).toContain("I have a round code");
    expect(textOf(live, deaf)).toContain("I have a round code");
  });

  await test.step("Hold again: one press, asked once more, and the front door is held again", async () => {
    await page.goto(`/owner?bust=${Date.now()}`);
    const card = page.locator("#accounts");
    await card.getByRole("button", { name: OWNER_CARD.holdAgain }).click();
    const dialog = page.getByRole("dialog", { name: OWNER_CARD.holdTitle });
    await expect(dialog).toContainText(OWNER_CARD.holdNote);
    await dialog.getByRole("button", { name: OWNER_CARD.holdConfirm }).click();
    await expect(card.getByRole("status")).toContainText(OWNER_CARD.heldAgain);
    await expect.poll(async () => (await prisma.platformSetting.findUnique({ where: { key: "signins" } }))?.value).toBe("held");
    const visitor = await browser.newContext({ baseURL });
    try {
      const again = await said(await visitor.newPage(), "/");
      expect(again).toContain(FRONT_DOOR.held.heroCta);
      expect(again).not.toContain(FRONT_DOOR.live.heroCta);
    } finally {
      await visitor.close();
    }
  });

  if (CAPTURE) {
    writeFileSync(
      join(CAPTURE, `notes-${width}.json`),
      JSON.stringify({ width, project: testInfo.project.name, surfaces: LAUNCH_SURFACES.length, probed: LAUNCH_SURFACES.filter((s) => s.probe).length }, null, 2),
    );
  }
});
