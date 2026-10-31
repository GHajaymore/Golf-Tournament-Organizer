import { test, expect } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A ROUND'S PRINTED SIGN, FROM THE ORGANIZER'S SCREEN TO A PLAYER'S THUMB (2026-10-17).
 *
 * Borrowed from how charity days are run elsewhere and settled by the review
 * panel: one sign per round with a QR code and the code in large letters. The
 * QR opens `/play#CODE`. Walked as the two people who use it:
 *
 *   the organizer opens the signs          → one per round, the round named, a
 *                                             QR, the code, and NO player's name
 *   a player scans it on a fresh phone     → straight to the round's names, no
 *                                             typing; the code is gone from the
 *                                             address
 *   a phone already scoring scans a sign   → asked, never switched: "Keep
 *     for a DIFFERENT round                   scoring this one" leaves it where
 *                                             it was
 *   ...and its own round's sign            → CONTROL: nothing is asked
 *   ...and switches                        → the new code is opened; a code
 *                                             that is no round's is refused in
 *                                             words, as if typed
 *
 * WHAT IT CANNOT SEE: that a phone camera reads the printed square. The QR is
 * drawn module for module from a published encoder (`qr.ts`, and its unit test
 * proves the drawing is the encoder's matrix); reading it off paper in the sun
 * is the real-phone test.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; partialCard: { stageId: string } };
const stageId = data.partialCard.stageId;
const prisma = new PrismaClient();
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

let was: { how: string; accessCode: string } | null = null;
test.beforeAll(async () => {
  const how = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playerAccess: true } })).playerAccess;
  const accessCode = (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { accessCode: true } })).accessCode;
  was = { how, accessCode };
  await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: "both" } });
  // A code to print, without touching one the fixture already had.
  if (!accessCode) await prisma.stage.update({ where: { id: stageId }, data: { accessCode: "ZZQR2346" } });
});
test.afterAll(async () => {
  if (was) {
    await prisma.stage.update({ where: { id: stageId }, data: { accessCode: was.accessCode } });
    await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: was.how } });
  }
  await prisma.$disconnect();
});

test("a round's sign opens its names on a fresh phone, and asks before moving a phone that is already scoring", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const code = (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { accessCode: true } })).accessCode;
  const shown = `${code.slice(0, 4)}-${code.slice(4)}`;
  const field = await prisma.player.findMany({ where: { eventId: data.eventId, status: "confirmed" }, orderBy: { name: "asc" }, select: { name: true } });
  const somebody = field[0].name;

  // ── the organizer's signs ───────────────────────────────────────────────
  // Printed through the Print kit since 2026-10-23: the codes panel is the door to it.
  await page.goto(`/event?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const panel = page.locator("div", { has: page.locator(".card-title", { hasText: /^Round Codes$/ }) }).last();
  await expect(panel.getByRole("link", { name: /Print the signs/ }), "the codes panel has no way to the signs").toHaveAttribute("href", /^\/print\?/);
  await page.goto(`/print?round=${stageId}&docs=spare&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  // Two spare signs since 30 Oct, the first tee's and the clubhouse's: the same sign twice.
  const signs = page.locator("#pk-pages .pk-sparecard").filter({ hasText: shown });
  await expect(signs, "no sign carries the round's code").toHaveCount(2, { timeout: 20_000 });
  const sign = signs.first();
  await expect(sign.locator("svg path"), "the sign has no QR drawn").toHaveCount(1);
  await expect(sign).toContainText("Scan to enter your score");
  await expect(page.getByRole("button", { name: /^Print 1 sheet$/ })).toBeVisible();
  const link = await sign.getAttribute("data-link");
  expect(link, "the sign's QR is not the round's /play link").toBe(`${new URL(baseURL!).origin}/play#${shown}`);
  // Nobody's name on a sign left in a cart.
  // Kept with the run, so the sign can be looked at without a printer.
  await sign.screenshot({ path: test.info().outputPath("sign.png") });
  const signText = await sign.locator("xpath=ancestor::article[@data-card]").innerText();
  for (const p of field) expect(signText, `a player's name is printed on the sign: ${p.name}`).not.toContain(p.name);

  // ── a fresh phone scans it ──────────────────────────────────────────────
  const phone = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const player = await phone.newPage();
    watchPageErrors(player, errors);
    await player.goto(link!);
    await expect(player.getByRole("button", { name: somebody }), "the sign did not open the round's names").toBeVisible({ timeout: 20_000 });
    await expect(player.getByLabel("Round code"), "the scanned phone was still asked to type the code").toHaveCount(0);
    expect(new URL(player.url()).hash, "the code was left on the address").toBe("");

    // Tapping a name is the player's own act; the sign never does it.
    await player.getByRole("button", { name: somebody }).click();
    // Scoring as them: their own screen, headed by their name. Waited for, or the next step leaves
    // before the sign-in lands and walks a phone with no session (Firefox, 2026-10-17).
    const scoring = player.getByRole("heading", { level: 1, name: somebody });
    await expect(scoring, "tapping the name did not start the session").toBeVisible({ timeout: 20_000 });
    const asked = player.getByRole("region", { name: "A sign for another round" });

    // CONTROL: the same round's sign, scanned again, asks nothing.
    await player.goto("about:blank");
    await player.goto(link!);
    await player.waitForLoadState("networkidle").catch(() => {});
    // Still scoring as them — a phone that had lost its session would pass "nothing asked" too.
    await expect(scoring, "the phone's own round's sign lost its session").toBeVisible({ timeout: 20_000 });
    await expect(asked, "the phone's own round's sign asked to switch").toHaveCount(0);

    // A sign for another round: asked, not switched.
    const other = code === "ZZQR2347" ? "ZZQR2348" : "ZZQR2347";
    const otherLink = `${new URL(baseURL!).origin}/play#${other.slice(0, 4)}-${other.slice(4)}`;
    await player.goto("about:blank");
    await player.goto(otherLink);
    await expect(asked, "a sign for another round moved the phone without asking").toBeVisible({ timeout: 20_000 });
    await expect(asked).toContainText("This phone is scoring");
    await player.screenshot({ path: test.info().outputPath("asked.png") });
    await asked.getByRole("button", { name: "Keep scoring this one" }).click();
    await expect(asked).toHaveCount(0);
    await expect(player.getByLabel("Round code"), "keeping the round left it anyway").toHaveCount(0);
    await expect(scoring, "keeping the round lost the session").toBeVisible();

    // And switching opens the new code — which is nobody's round, so it is refused as if typed.
    await player.goto("about:blank");
    await player.goto(otherLink);
    await asked.getByRole("button", { name: "Switch to that round" }).click();
    await expect(player.getByText(/That code isn.t valid/), "switching did not open the sign's code").toBeVisible({ timeout: 20_000 });
  } finally {
    await phone.close();
  }

  expect(errors, "a screen threw").toEqual([]);
});
