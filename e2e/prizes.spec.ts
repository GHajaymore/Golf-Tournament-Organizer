import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

/**
 * A PRIZE: ADDED, RE-PRICED, AWARDED, TAKEN BACK AND REMOVED — AND THE PURSE
 * ADDS UP AT EVERY STEP.
 *
 * The prize list is what a committee reads out at the presentation, and the
 * purse at the top of it is what the treasurer has to find. `updatePrize` and
 * `removePrize` were performed by no browser test (the first measured round,
 * 2026-10-13); adding and awarding were, in passing.
 *
 * Every step says what the purse must be, from arithmetic done here:
 *
 *   no category          → nothing is added (the control)
 *   25 for nearest pin   → the purse is 25 more, and there is one more line
 *   re-priced to 30      → 5 more again — typed and kept with ENTER
 *   a negative amount    → is not a prize: it is stored as nothing, and the
 *                          box says what is stored, not what was typed
 *   awarded              → the winner is on the row, and one more is awarded
 *   the award taken back → and one fewer
 *   removed              → asked first; then the purse is EXACTLY what it was
 *
 * WHAT IT CANNOT SEE: whether the right person won. That is the committee's;
 * the app offers the field in finishing order and records the choice.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const MARK = "zz-prize";
const CAT = `${MARK} Nearest the pin`;
const prisma = new PrismaClient();
const sweep = () => prisma.prize.deleteMany({ where: { eventId: data.eventId, category: { startsWith: MARK } } });

test.afterAll(async () => {
  await sweep();
  await prisma.$disconnect();
});

/** The three figures over the prize list: the purse in cents, the lines, and how many are awarded. */
async function head(page: Page) {
  await page.goto(`/prizes?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const lines = (await page.locator("main").innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
  const after = (label: string) => {
    const at = lines.findIndex((l) => l.toUpperCase() === label);
    expect(at, `the prizes screen has no "${label}" figure`).toBeGreaterThanOrEqual(0);
    return lines[at + 1];
  };
  const purse = /\$([\d,]+)\.(\d\d)/.exec(after("TOTAL PURSE"));
  expect(purse, "the purse is not an amount").not.toBeNull();
  const [awarded, of] = after("AWARDED").split("/").map((n) => Number(n.trim()));
  return { purse: Number(purse![1].replace(/,/g, "")) * 100 + Number(purse![2]), lines: Number(after("PRIZE LINES")), awarded, of };
}
const row = () => prisma.prize.findFirst({ where: { eventId: data.eventId, category: CAT } });

test("the organizer adds a prize, re-prices it, awards it, takes the award back and removes it — and the purse adds up throughout", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await sweep();
  const before = await head(page);

  // ── no category: nothing is added ───────────────────────────────────────
  await page.getByLabel(/^Amount \(/).fill("25");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(600);
  expect(await prisma.prize.count({ where: { eventId: data.eventId } }), "CONTROL: a prize with no name was added").toBe(before.lines);

  // ── added ───────────────────────────────────────────────────────────────
  await page.getByLabel("Category").fill(CAT);
  await page.getByLabel("Detail (optional)").fill("Pro shop credit");
  await page.getByLabel(/^Amount \(/).fill("25");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(row, { timeout: 20_000, message: "the prize was not stored" }).not.toBeNull();
  expect(await row()).toMatchObject({ category: CAT, detail: "Pro shop credit", amount: 25, winnerId: null });
  expect(await head(page), "adding a prize of 25 did not add 25 to the purse and one line").toEqual({ ...before, purse: before.purse + 2500, lines: before.lines + 1, of: before.of + 1 });

  // The row is drawn twice — a table for a wide screen, a list for a narrow one — and one of them is on screen.
  const amount = page.getByLabel(`Amount for ${CAT}`).locator("visible=true");
  const winner = page.getByLabel(`Winner of ${CAT}`).locator("visible=true");

  // ── re-priced, kept with Enter ──────────────────────────────────────────
  await amount.fill("30");
  await amount.press("Enter");
  await expect.poll(async () => (await row())?.amount, { timeout: 20_000, message: "the new amount was not kept" }).toBe(30);
  expect((await head(page)).purse, "re-pricing 25 to 30 did not add 5 to the purse").toBe(before.purse + 3000);

  // ── a negative amount is not a prize: refused beside the box, and the prize keeps its 30 ──
  // (Until 2026-10-21 it was stored as no prize, without a word — the text-box crawl.)
  await amount.fill("-5");
  await amount.press("Enter");
  const refused = page.getByRole("alert").filter({ hasText: "A prize can't be less than nothing." }).locator("visible=true");
  await expect(refused, "a negative prize was not refused in words").toBeVisible({ timeout: 10_000 });
  await expect(refused, "the refusal is not where the box is").toBeInViewport();
  await expect(amount, "the box shows a negative prize that was not stored").toHaveValue("30", { timeout: 10_000 });
  expect((await row())?.amount, "a negative prize changed what was stored").toBe(30);
  expect((await head(page)).purse, "a refused amount changed the purse").toBe(before.purse + 3000);

  // ── awarded, and taken back ─────────────────────────────────────────────
  const first = await winner.locator("option").nth(1).getAttribute("value");
  expect(first, "nobody is offered as a winner").toBeTruthy();
  await winner.selectOption(first!);
  await expect.poll(async () => (await row())?.winnerId, { timeout: 20_000, message: "the award was not recorded" }).toBe(first);
  expect((await head(page)).awarded, "awarding a prize did not count it as awarded").toBe(before.awarded + 1);
  await expect(winner, "the winner is not on the row after a reload").toHaveValue(first!);
  await winner.selectOption("");
  await expect.poll(async () => (await row())?.winnerId, { timeout: 20_000, message: "the award was not taken back" }).toBeNull();
  expect((await head(page)).awarded).toBe(before.awarded);

  // ── removed: asked first ────────────────────────────────────────────────
  const line = page.locator("tr, li", { has: page.getByLabel(`Amount for ${CAT}`) }).locator("visible=true").last();
  await line.getByRole("button", { name: "Remove prize" }).click();
  expect(await row(), "one press removed a prize without asking").not.toBeNull();
  await line.getByRole("button", { name: "Remove it" }).click();
  await expect.poll(row, { timeout: 20_000, message: "the prize was not removed" }).toBeNull();

  // ── to the cent ─────────────────────────────────────────────────────────
  expect(await head(page), "after all of it the purse, the lines and the awards are not what they were").toEqual(before);
  expect(errors, "the prizes screen threw").toEqual([]);
});
