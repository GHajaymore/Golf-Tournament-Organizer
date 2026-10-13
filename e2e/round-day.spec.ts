import { test, expect } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * ROUND DAY: WHERE THE HOLES ARE CUT, AND THE TIME ALLOWED.
 *
 * The morning of a round the committee walks the course, writes down where
 * each hole has been cut — "22 on, 6 from the right" — and decides how long a
 * round should take. It is typed in once, on the tee sheet screen, and the
 * point of typing it is that every player then has it on their phone on every
 * tee, and it prints on every card.
 *
 * Neither `setPinSheet` nor `setPaceMinutes` was performed by any browser test
 * (the first measured round, 2026-10-13). The notation had unit tests. Nothing
 * had typed a pin into the form and then looked at a player's card.
 *
 *   two holes are set and saved       → the screen says how many, the row holds them
 *   a player opens their card         → hole 1 and hole 2 each show their OWN pin,
 *                                        in the short code and said aloud in full;
 *                                        a hole nobody set shows none (the control)
 *   61 paces on                       → refused in words, and nothing is changed
 *   the sheet is emptied              → "cleared", and the player's card shows no pin
 *   the time allowed is changed       → kept, shown again on reload, and in the log
 *
 * WHAT IT CANNOT SEE: the printed card. The same sheet feeds it; a printout is
 * a person's to check.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; partialCard: { stageId: string } };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const stageId = data.partialCard.stageId;
const prisma = new PrismaClient();
let was: { pinSheet: string; paceMinutes: number } | null = null;

test.beforeAll(async () => {
  was = await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { pinSheet: true, paceMinutes: true } });
});
// The fixture is every later spec's: the round is handed back as it was found.
test.afterAll(async () => {
  if (was) await prisma.stage.update({ where: { id: stageId }, data: was });
  await prisma.$disconnect();
});

test("the committee sets the pins and the time allowed, and a player's card shows each hole's own pin", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  await prisma.stage.update({ where: { id: stageId }, data: { pinSheet: "", paceMinutes: 0 } });

  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  try {
    const sheet = await organizer.newPage();
    const phone = await member.newPage();
    watchPageErrors(sheet, errors);
    watchPageErrors(phone, errors);

    const openSheet = async () => {
      // The round is named: left to itself this screen opens on the next round nobody has started, which
      // is the right default for drawing a sheet and is not the round the member's card is in.
      await sheet.goto(`/foursomes?round=${stageId}&bust=${Date.now()}`);
      await sheet.waitForLoadState("networkidle").catch(() => {});
      const panel = sheet.locator(`section[aria-labelledby="${stageId}-roundday"]`);
      await expect(panel, "the tee sheet screen has no round-day panel for the round the member is playing").toBeVisible();
      return panel;
    };
    /** The member's card, one hole at a time, on the hole asked for. */
    const onHole = async (n: number) => {
      await phone.goto(`/me/card?bust=${Date.now()}`);
      await phone.waitForLoadState("networkidle").catch(() => {});
      await phone.locator("label.seg-opt", { hasText: "By hole" }).click();
      await phone.getByRole("button", { name: new RegExp(`^Hole ${n},`) }).click();
    };
    const pinOnPhone = phone.getByText(/^Pin: /);
    const stored = async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { pinSheet: true } })).pinSheet;

    // ── CONTROL: no pins yet, on the form or on the phone ───────────────────
    let panel = await openSheet();
    await expect(panel.getByLabel("Hole 1: paces on")).toHaveValue("");
    await onHole(1);
    await expect(pinOnPhone, "a player's card shows a pin before anybody set one").toHaveCount(0);

    // ── two holes are set ───────────────────────────────────────────────────
    await panel.getByLabel("Hole 1: paces on").fill("22");
    await panel.getByLabel("Hole 1: side").selectOption("R");
    await panel.getByLabel("Hole 1: paces from the right edge").fill("6");
    await panel.getByLabel("Hole 2: paces on").fill("18");
    await panel.getByRole("button", { name: "Save pin sheet" }).click();
    await expect(panel.getByRole("status"), "the pin sheet did not say it was saved").toContainText(/^Saved — 2 of \d+ holes set\.$/, { timeout: 20_000 });

    const kept = JSON.parse(await stored()) as Array<{ on: number; side: string; off?: number } | null>;
    expect(kept[0], "hole 1's pin is not in the round's row as it was typed").toMatchObject({ on: 22, side: "R", off: 6 });
    expect(kept[1]).toMatchObject({ on: 18, side: "C" });
    expect(kept.slice(2).every((p) => p === null), "a hole nobody set has a pin").toBe(true);
    const logged = await prisma.auditLog.findFirst({ where: { eventId: data.eventId, action: "pin-sheet" }, orderBy: { createdAt: "desc" } });
    expect(logged?.detail ?? "", "the log does not say the pin sheet was set").toMatch(/^Pin sheet set for .+ \(2 holes\)$/);

    // And they are still there when the screen is opened again.
    panel = await openSheet();
    await expect(panel.getByLabel("Hole 1: paces on")).toHaveValue("22");
    await expect(panel.getByLabel("Hole 1: side")).toHaveValue("R");
    await expect(panel.getByLabel("Hole 1: paces from the right edge")).toHaveValue("6");
    await expect(panel.getByLabel("Hole 2: paces on")).toHaveValue("18");

    // ── the player's card: each hole its own pin ────────────────────────────
    await onHole(1);
    await expect(pinOnPhone, "hole 1 on a player's card does not say where its pin is").toHaveText("Pin: 22 paces on, 6 from the right");
    await expect(phone.getByText("22 / 6R", { exact: true }), "hole 1 does not show the short code a pin sheet uses").toBeVisible();
    await onHole(2);
    await expect(pinOnPhone, "hole 2 shows the wrong pin, or none").toHaveText("Pin: 18 paces on, centre");
    await onHole(3);
    await expect(pinOnPhone, "CONTROL: a hole nobody set shows a pin on the player's card").toHaveCount(0);

    // ── a position that cannot be: refused, and nothing changed ─────────────
    const before = await stored();
    await panel.getByLabel("Hole 3: paces on").fill("61");
    await panel.getByRole("button", { name: "Save pin sheet" }).click();
    await expect(panel.getByRole("alert"), "61 paces on was not refused in words").toContainText("Paces on must be a whole number from 1 to 60");
    expect(await stored(), "a refused pin sheet changed what was stored").toBe(before);

    // ── emptied ─────────────────────────────────────────────────────────────
    panel = await openSheet();
    await panel.getByLabel("Hole 1: paces on").fill("");
    await panel.getByLabel("Hole 1: side").selectOption("C");
    await panel.getByLabel("Hole 2: paces on").fill("");
    await panel.getByRole("button", { name: "Save pin sheet" }).click();
    await expect(panel.getByRole("status")).toHaveText("Pin sheet cleared.", { timeout: 20_000 });
    expect(await stored(), "a cleared pin sheet is still stored").toBe("");
    await onHole(1);
    await expect(pinOnPhone, "a player's card still shows a pin after the sheet was cleared").toHaveCount(0);

    // ── the time allowed ────────────────────────────────────────────────────
    const pace = panel.getByLabel("Time allowed");
    await expect(pace, "CONTROL: the round starts on the club's default time").toHaveValue("0");
    await pace.selectOption("255");
    await expect.poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { paceMinutes: true } })).paceMinutes, { timeout: 20_000, message: "the time allowed never reached the round" }).toBe(255);
    const paceLog = await prisma.auditLog.findFirst({ where: { eventId: data.eventId, action: "pace-set" }, orderBy: { createdAt: "desc" } });
    expect(paceLog?.detail ?? "", "the log does not say the time allowed was changed").toMatch(/^Time allowed for .+: 4h 15m$/);
    panel = await openSheet();
    await expect(panel.getByLabel("Time allowed"), "the time allowed was not kept").toHaveValue("255");

    expect(errors, "a screen threw while the round day was set").toEqual([]);
  } finally {
    await Promise.all([organizer, member].map((c) => c.close()));
  }
});
