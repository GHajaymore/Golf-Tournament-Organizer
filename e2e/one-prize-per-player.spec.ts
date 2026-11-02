import { test, expect, type Locator } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

/**
 * ONE PRIZE PER PLAYER, AS THE SECRETARY RUNS IT (Ajay, 2026-10-21, C1).
 *
 * On Prizes, with three lines of the spec's own — Best gross, Best net and
 * Nearest the pin (a skill prize, which does not count):
 *
 *   the box ticked                       → stored; the lines are drawn gross first
 *   Best gross to the first in line      → stored
 *   Best net to the SAME player          → offered last, saying "has … Best gross";
 *                                          chosen anyway, REFUSED in words, beside
 *                                          the Best net picker, and nothing stored
 *   Best net to the one marked next      → stored, and somebody else
 *   Nearest the pin to the gross winner  → stored: a skill prize does not count
 *   Nearest the pin switched to counting → refused beside it (its winner already
 *                                          has Best gross); the switch stays off
 *
 * WHAT IT CANNOT SEE: whether the club's own terms say one prize per player.
 * That is the committee's to tick; the app keeps the rule once it is ticked.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const MARK = "zz-oneprize";
const GROSS = `${MARK} Best gross`;
const NET = `${MARK} Best net`;
const PIN = `${MARK} Nearest the pin`;
const prisma = new PrismaClient();
const sweep = () => prisma.prize.deleteMany({ where: { eventId: data.eventId, category: { startsWith: MARK } } });
const ruleOff = () => prisma.event.update({ where: { id: data.eventId }, data: { onePrizePerPlayer: false } });
const line = (category: string) => prisma.prize.findFirst({ where: { eventId: data.eventId, category } });

test.afterAll(async () => {
  try {
    await sweep();
    await ruleOff();
  } finally {
    await prisma.$disconnect();
  }
});

/** How far apart two things on the screen are, top to bottom, in pixels. */
async function gapBetween(a: Locator, b: Locator): Promise<number> {
  const [x, y] = [await a.boundingBox(), await b.boundingBox()];
  expect(x && y, "could not measure the refusal or the control pressed").toBeTruthy();
  return Math.max(0, x!.y - (y!.y + y!.height), y!.y - (x!.y + x!.height));
}

test("one prize per player: ticked, the net refused to the gross winner beside the press, given to the next, and nearest the pin still theirs", async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await sweep();
  await ruleOff();
  // Added NET first and gross LAST, so "gross first" has to be the screen's doing.
  const top = (await prisma.prize.aggregate({ where: { eventId: data.eventId }, _max: { position: true } }))._max.position ?? 0;
  await prisma.prize.createMany({
    data: [
      { eventId: data.eventId, category: NET, position: top + 1, countsForOnePrize: true },
      { eventId: data.eventId, category: PIN, position: top + 2, countsForOnePrize: false },
      { eventId: data.eventId, category: GROSS, position: top + 3, countsForOnePrize: true },
    ],
  });

  await page.goto(`/prizes?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});

  // ── the box ticked ──────────────────────────────────────────────────────
  const box = page.getByLabel("One prize per player", { exact: true });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect
    .poll(async () => (await prisma.event.findUnique({ where: { id: data.eventId } }))?.onePrizePerPlayer, { timeout: 20_000, message: "the box was not stored" })
    .toBe(true);
  await expect(page.getByText("Award the gross prizes first; a player who wins one is skipped for the net.")).toBeVisible();

  const picker = (category: string) => page.getByLabel(`Winner of ${category}`).locator("visible=true");
  // Gross first: the gross line is drawn above the net one although it was added last.
  await expect(picker(GROSS)).toBeVisible({ timeout: 20_000 });
  const [grossAt, netAt] = [await picker(GROSS).boundingBox(), await picker(NET).boundingBox()];
  expect(grossAt!.y, "the gross line is not drawn before the net under one prize per player").toBeLessThan(netAt!.y);

  // ── Best gross to the first in line ─────────────────────────────────────
  const firstInLine = picker(GROSS).locator("option", { hasText: "next in line" });
  const grossWinner = await firstInLine.getAttribute("value");
  expect(grossWinner, "nobody is marked next in line for Best gross").toBeTruthy();
  await picker(GROSS).selectOption(grossWinner!);
  await expect.poll(async () => (await line(GROSS))?.winnerId, { timeout: 20_000, message: "Best gross was not awarded" }).toBe(grossWinner);
  const grossName = (await prisma.player.findUnique({ where: { id: grossWinner! } }))!.name;

  // ── Best net: the gross winner is offered last, saying why ──────────────
  const held = picker(NET).locator(`option[value="${grossWinner}"]`);
  await expect(held, "the gross winner is not marked on the Best net picker").toHaveText(new RegExp(`has ${GROSS}$`), { timeout: 20_000 });
  const values = await picker(NET).locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(values[values.length - 1], "the gross winner is not put out of the way on the Best net picker").toBe(grossWinner);

  // …and chosen anyway: refused, in words, beside the press.
  await picker(NET).selectOption(grossWinner!);
  const refused = page.getByRole("alert").filter({ hasText: `${grossName} already has ${GROSS}. This tournament gives one prize per player — choose the next player.` });
  await expect(refused, "the second placing prize was not refused in words").toBeVisible({ timeout: 20_000 });
  await expect(refused, "the refusal is not on the screen of the person who chose").toBeInViewport();
  expect(await gapBetween(refused, picker(NET)), "the refusal is not said beside the Best net picker").toBeLessThanOrEqual(200);
  expect((await line(NET))?.winnerId, "the refused award was stored").toBeNull();
  await expect(picker(NET), "the picker shows a winner the server refused").toHaveValue("");

  // ── Best net to the one marked next ─────────────────────────────────────
  const next = await picker(NET).locator("option", { hasText: "next in line" }).getAttribute("value");
  expect(next, "nobody is marked next in line for Best net").toBeTruthy();
  expect(next).not.toBe(grossWinner);
  await picker(NET).selectOption(next!);
  await expect.poll(async () => (await line(NET))?.winnerId, { timeout: 20_000, message: "Best net was not given to the next player" }).toBe(next);
  await expect(refused, "the refusal outlived the award that put it right").toHaveCount(0);

  // ── Nearest the pin: a skill prize, so the gross winner may take it ─────
  await expect(picker(PIN).locator("option", { hasText: "has " }), "a skill prize sets players aside").toHaveCount(0);
  await picker(PIN).selectOption(grossWinner!);
  await expect.poll(async () => (await line(PIN))?.winnerId, { timeout: 20_000, message: "nearest the pin was refused to the gross winner" }).toBe(grossWinner);

  // ── …and switching it to counting is refused, beside it ─────────────────
  const counts = page.getByLabel(`${PIN}: counts toward one prize per player`).locator("visible=true");
  await expect(counts).not.toBeChecked();
  // A click, not `check()`: the switch is meant to fall back unticked when refused.
  await counts.click();
  const switchRefused = page.getByRole("alert").filter({ hasText: `${grossName} already has ${GROSS}, so ${PIN} can't count as well.` });
  await expect(switchRefused, "a switch that would make a clash was not refused").toBeVisible({ timeout: 20_000 });
  expect(await gapBetween(switchRefused, counts), "the switch's refusal is not said beside it").toBeLessThanOrEqual(200);
  expect((await line(PIN))?.countsForOnePrize, "the refused switch was stored").toBe(false);
  await expect(counts, "the switch shows a value the server refused").not.toBeChecked();

  expect(errors, "the prizes screen threw").toEqual([]);
});
