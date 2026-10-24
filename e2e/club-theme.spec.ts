import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { openSettingsTab } from "./settings-tabs";

/**
 * THE CLUB PICKS ITS LOOK ONCE, AND THREE SCREENS WEAR IT.
 *
 * Club settings promises that the colours and the light-or-dark ground apply
 * "to every tournament this club runs, on every device anyone opens it on" —
 * the organizer's console, the public board a club sends its members, and the
 * player's own app. `saveOrganizationTheme` was performed by no browser test
 * (round 1 on the frozen app, 2026-10-13). Each surface's colours are swept
 * for contrast; nothing asked whether the three AGREE, which is the class a
 * suite is blind to: every screen right on its own, and one of them still
 * wearing last month's colours.
 *
 * So the look is changed twice, and after each save the same two things are
 * read off all three screens — the ground behind everything and the accent
 * colour — and held against each other:
 *
 *   chosen but not saved          → the public board has not changed (control)
 *   Light, and one scheme, saved  → all three on a light ground, one accent
 *   Dark, and another, saved      → all three on a dark ground, one accent,
 *                                   and not the accent they had a minute ago
 *
 * WHAT IT CANNOT SEE: whether a colour is readable in sunlight. `themes.test`
 * grades every scheme for that, and `legible.spec` reads the rendered text.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; shareToken: string };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const prisma = new PrismaClient();
const FIELDS = { themeKey: true, themeHex: true, themeSecondaryKey: true, themeSecondaryHex: true, themeAppearance: true, themeSetAt: true } as const;

let clubId = "";
let was: Record<string, unknown> = {};
test.beforeAll(async () => {
  clubId = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organizationId: true } })).organizationId!;
  was = await prisma.organization.findUniqueOrThrow({ where: { id: clubId }, select: FIELDS });
});
/** The fixture's club is every later spec's: its look goes back exactly as it was. */
test.afterAll(async () => {
  if (clubId) await prisma.organization.update({ where: { id: clubId }, data: was });
  await prisma.$disconnect();
});
const saved = () => prisma.organization.findUniqueOrThrow({ where: { id: clubId }, select: FIELDS });

/** What a screen is wearing: the ground behind everything, whether that ground is light, and the accent. */
async function wearing(page: Page, url: string) {
  await page.goto(`${url}${url.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  return page.evaluate(() => {
    // Read where the page's content is, not off <body>: the club's look is hung on the screen's own
    // wrapper, and the document underneath keeps the app's default — the first draft of this read
    // <body>, found three dark screens under a light board, and nearly reported it.
    const at = document.querySelector("main") ?? document.body;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;width:0;height:0;background:var(--color-bg);color:var(--color-accent)";
    at.appendChild(probe);
    const seen = getComputedStyle(probe);
    const ground = seen.backgroundColor;
    const accent = seen.color;
    probe.remove();
    const [r, g, b] = (ground.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
    return { ground, light: (r * 299 + g * 587 + b * 114) / 1000 > 140, accent };
  });
}

test("the club's look, changed twice, is worn the same by the console, the public board and a player's phone", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  const anybody = await browser.newContext({ ...device, baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const desk = await organizer.newPage();
    const phone = await member.newPage();
    const world = await anybody.newPage();
    watchPageErrors(desk, errors, "organizer");
    watchPageErrors(phone, errors, "player");
    watchPageErrors(world, errors, "public");
    const everywhere = async () => ({
      console: await wearing(desk, "/dashboard"),
      board: await wearing(world, `/live/${data.shareToken}`),
      player: await wearing(phone, "/me"),
    });
    /** Open the picker, choose a ground and a scheme that is not the one on, and say which scheme it was. */
    const choose = async (ground: "Light" | "Dark") => {
      await desk.goto(`/organization?bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
      await openSettingsTab(desk, "Colour");
      const card = desk.locator(".card", { has: desk.locator(".card-title", { hasText: /^Colour & appearance$/ }) }).first();
      await expect(card, "Club settings has no place to choose the club's look").toBeVisible();
      await card.locator("summary", { hasText: "Change colours" }).click();
      await card.getByRole("button", { name: new RegExp(`^${ground}\\b`) }).click();
      const other = card.locator('button[aria-pressed="false"]').first();
      const name = ((await other.innerText()).split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "").trim();
      await other.click();
      return { card, name };
    };

    const before = await everywhere();

    // ── chosen, not saved: nobody else sees it ──────────────────────────────
    let { card } = await choose("Light");
    expect(await wearing(world, `/live/${data.shareToken}`), "CONTROL: a look that was only tried on is already on the public board").toEqual(before.board);

    // ── Light, saved ────────────────────────────────────────────────────────
    await card.getByRole("button", { name: "Save theme" }).click();
    await expect.poll(async () => (await saved()).themeAppearance, { timeout: 20_000, message: "the look was not stored" }).toBe("light");
    const light = await everywhere();
    expect(light.console.light && light.board.light && light.player.light, `Light was saved and a screen is still dark: ${JSON.stringify(light)}`).toBe(true);
    expect(new Set([light.console.accent, light.board.accent, light.player.accent]).size, `the three screens do not wear one accent: ${JSON.stringify(light)}`).toBe(1);
    expect(new Set([light.console.ground, light.board.ground, light.player.ground]).size, `the three screens do not stand on one ground: ${JSON.stringify(light)}`).toBe(1);
    expect(light.console.accent, "the accent is not a colour").toMatch(/^(#|rgb|hsl|oklch|color)/i);

    // ── Dark, and another scheme, saved ─────────────────────────────────────
    ({ card } = await choose("Dark"));
    await card.getByRole("button", { name: "Save theme" }).click();
    await expect.poll(async () => (await saved()).themeAppearance, { timeout: 20_000, message: "the second look was not stored" }).toBe("dark");
    const dark = await everywhere();
    expect(dark.console.light || dark.board.light || dark.player.light, `Dark was saved and a screen is still light: ${JSON.stringify(dark)}`).toBe(false);
    expect(new Set([dark.console.accent, dark.board.accent, dark.player.accent]).size, `the three screens do not wear one accent: ${JSON.stringify(dark)}`).toBe(1);
    expect(new Set([dark.console.ground, dark.board.ground, dark.player.ground]).size, `the three screens do not stand on one ground: ${JSON.stringify(dark)}`).toBe(1);
    expect(dark.console.accent, "a different scheme was saved and the accent did not change").not.toBe(light.console.accent);

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([organizer, member, anybody].map((c) => c.close()));
  }
});
