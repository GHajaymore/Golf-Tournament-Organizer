import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

/**
 * SHARED COSTS: A BILL ADDED, CHANGED, SETTLED, UNSETTLED AND TAKEN AWAY —
 * AND THE MONEY COMES BACK TO THE CENT.
 *
 * On a golf trip somebody pays for the buggies and somebody else for dinner,
 * and the app's job is to say who owes whom. It records money; it never moves
 * it. Five actions do all of that — `addExpense`, `updateExpense`,
 * `removeExpense`, `recordSettlement`, `removeSettlement` — and the first
 * measured round (2026-10-13) found no browser test performing any of them.
 * They had been tried by the wrong person (and refused); nobody had done them
 * as the right one and read the figure afterwards.
 *
 * The figure is the test. A member's Money screen leads with one number —
 * what they are owed, or owe — and every step below says in advance what that
 * number must become, from arithmetic done here rather than read off the app:
 *
 *   a bill is added, paid by me, split evenly   → I am owed the bill less my own share more
 *   it is changed to half                       → and that moves by half
 *   a handover to me is marked settled          → I am owed that much less; it is listed
 *                                                  as settled, with who recorded it
 *   that is undone                              → I am owed it again
 *   the bill is removed                         → and the number is EXACTLY what it was
 *                                                  before any of this
 *
 * The last line is the one a constant error cannot survive: whatever was added
 * must come off again to the cent (CLAUDE.md: an error that shifts every row
 * by the same amount is invisible to the eye).
 *
 * And the controls: a bill with no amount cannot be saved; one press of Remove
 * or Undo asks first and changes nothing.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const MARK = "zz-costs";
const BILL = `${MARK}: buggy hire for the day`;
const prisma = new PrismaClient();
const startedAt = new Date();

/** Whatever this spec left behind, if it stopped half way: the fixture's own money is every later spec's. */
async function sweep() {
  await prisma.expense.deleteMany({ where: { eventId: data.eventId, description: { startsWith: MARK } } });
  await prisma.settlement.deleteMany({ where: { eventId: data.eventId, settledAt: { gte: startedAt } } });
}
test.afterAll(async () => {
  await sweep();
  await prisma.$disconnect();
});

/** "$1,234.56" as cents. */
const cents = (text: string) => {
  const m = /\$([\d,]+)\.(\d\d)/.exec(text);
  if (!m) throw new Error(`no amount in "${text}"`);
  return Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
};

/** The one number the screen leads with, signed: owed is positive, owing negative. */
async function standing(page: Page): Promise<number> {
  await page.goto(`/me/money?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const head = (await page.locator("main").innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
  const at = head.findIndex((l) => /^You(’|')re owed$|^You owe$|^All square$|^You(’|')re square$/.test(l));
  expect(at, `the Money screen does not lead with where I stand:\n${head.slice(0, 8).join("\n")}`).toBeGreaterThanOrEqual(0);
  if (/square/i.test(head[at])) return 0;
  return (/owed/.test(head[at]) ? 1 : -1) * cents(head[at + 1]);
}

test("a member adds a bill, changes it, settles and unsettles a handover, and removes the bill — and the money comes back to the cent", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  await sweep();

  const before = await standing(page);
  const billsBefore = await prisma.expense.count({ where: { eventId: data.eventId } });

  // ── a bill with no amount cannot be saved ─────────────────────────────────
  await page.getByRole("button", { name: "Add an expense" }).click();
  const what = page.getByLabel("What was it for?");
  const amount = page.getByLabel("Amount", { exact: true });
  const save = page.getByRole("button", { name: "Save expense" });
  await what.fill(BILL);
  await expect(save, "CONTROL: a bill with no amount can be saved").toBeDisabled();
  await amount.fill("0");
  await expect(save, "CONTROL: a bill of nothing can be saved").toBeDisabled();

  // ── added: paid by me, split evenly between everybody it is shared with ───
  const payer = page.getByLabel("Who paid");
  const me = await payer.inputValue();
  expect(me, "the form does not start with me as the one who paid").toBeTruthy();
  const sharers = await page.getByRole("checkbox", { name: /^Shares for |^Include / }).count();
  // However many share it, a bill of ten each divides without a cent left over.
  const people = sharers || (await prisma.player.count({ where: { eventId: data.eventId, status: "confirmed" } }));
  expect(people, "nobody to share a bill with").toBeGreaterThan(1);
  const bill = people * 1000;
  await amount.fill((bill / 100).toFixed(2));
  await save.click();
  await expect(page.getByRole("button", { name: "Add an expense" }), "the bill was not saved: the form is still open").toBeVisible({ timeout: 20_000 });

  const stored = await prisma.expense.findMany({ where: { eventId: data.eventId, description: BILL }, include: { shares: true } });
  expect(stored.length, "the bill was stored more or fewer times than once").toBe(1);
  expect(stored[0].amountCents).toBe(bill);
  expect(stored[0].paidBy, "the bill is not recorded as paid by me").toBe(me);
  expect(stored[0].shares.length, "the bill is not shared between everybody on the form").toBe(people);
  expect(stored[0].shares.some((s) => s.playerId === me), "I am not one of those sharing my own bill").toBe(true);

  // I paid all of it and owe a share of it: I am owed the rest.
  const afterAdd = await standing(page);
  expect(afterAdd - before, `adding a bill of ${bill} cents between ${people} moved what I am owed by the wrong amount`).toBe(bill - bill / people);

  // ── changed to half ──────────────────────────────────────────────────────
  await page.locator("summary", { hasText: /^More:/ }).click();
  const line = page.locator("details", { hasText: BILL }).last();
  await line.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Amount", { exact: true }).fill((bill / 200).toFixed(2));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Add an expense" }), "the change was not saved").toBeVisible({ timeout: 20_000 });
  expect((await prisma.expense.findFirstOrThrow({ where: { eventId: data.eventId, description: BILL } })).amountCents, "the bill's new amount is not stored").toBe(bill / 2);
  expect(await prisma.expense.count({ where: { eventId: data.eventId } }), "changing a bill made a second one").toBe(billsBefore + 1);
  const afterEdit = await standing(page);
  expect(afterEdit - before, "halving the bill did not halve what it added to what I am owed").toBe((bill - bill / people) / 2);

  // ── a handover TO me is marked settled ───────────────────────────────────
  const settledBefore = await prisma.settlement.count({ where: { eventId: data.eventId } });
  const mine = page.locator("div", { has: page.getByRole("button", { name: "Mark settled" }) }).filter({ hasText: /\bYou\s*\$/ }).last();
  await expect(mine, "nobody is shown owing me anything, though I am owed").toBeVisible();
  const handed = cents(await mine.innerText());
  await mine.getByRole("button", { name: "Mark settled" }).click();
  await expect.poll(() => prisma.settlement.count({ where: { eventId: data.eventId } }), { timeout: 20_000, message: "the handover was not recorded" }).toBe(settledBefore + 1);
  const settlement = await prisma.settlement.findFirstOrThrow({ where: { eventId: data.eventId, settledAt: { gte: startedAt } }, orderBy: { settledAt: "desc" } });
  expect(settlement.cents, "the handover was recorded for a different amount from the one on the screen").toBe(handed);
  expect(settlement.toPlayerId, "the handover is not recorded as paid to me").toBe(me);
  expect(settlement.recordedBy, "the handover does not say who recorded it").toBeTruthy();
  const afterSettle = await standing(page);
  expect(afterSettle, "being handed money did not reduce what I am owed by that much").toBe(afterEdit - handed);

  // It is listed as settled, with who said so.
  await page.locator("summary", { hasText: /^More:/ }).click();
  const done = page.locator("div", { hasText: `recorded by ${settlement.recordedBy}` }).filter({ has: page.getByRole("button", { name: /Undo/ }) }).last();
  await expect(done, "the handover is not listed as settled with who recorded it").toBeVisible();

  // ── and undone: one press asks, and nothing has changed yet ──────────────
  await done.getByRole("button", { name: /Undo/ }).first().click();
  expect(await prisma.settlement.count({ where: { eventId: data.eventId } }), "one press undid a settlement without asking").toBe(settledBefore + 1);
  await done.getByRole("button", { name: "Undo it" }).click();
  await expect.poll(() => prisma.settlement.count({ where: { eventId: data.eventId } }), { timeout: 20_000, message: "the settlement was not undone" }).toBe(settledBefore);
  expect(await standing(page), "undoing the handover did not put back what I am owed").toBe(afterEdit);

  // ── the day on the bill reads as a date (2026-10-21) ─────────────────────
  // It was printed as the database keeps it, "2026-05-14", under handovers dated "May 14, 2026",
  // and on a phone it broke across two lines at the hyphen. A day somebody typed is already a day.
  await prisma.expense.updateMany({ where: { eventId: data.eventId, description: BILL }, data: { spentOn: "2026-05-14" } });
  await page.reload();

  // ── the bill is removed: asked first, then gone ──────────────────────────
  await page.locator("summary", { hasText: /^More:/ }).click();
  const again = page.locator("details", { hasText: BILL }).last();
  await expect(again, "the bill's day is not written as a date").toContainText(/May 14, 2026|14 May 2026|14\. Mai 2026/);
  expect(await again.innerText(), "the bill's day is printed as the database keeps it").not.toContain("2026-05-14");
  await again.getByRole("button", { name: "Remove" }).click();
  expect(await prisma.expense.count({ where: { eventId: data.eventId, description: BILL } }), "one press removed a bill without asking").toBe(1);
  await again.getByRole("button", { name: "Yes, remove it" }).click();
  await expect.poll(() => prisma.expense.count({ where: { eventId: data.eventId, description: BILL } }), { timeout: 20_000, message: "the bill was not removed" }).toBe(0);
  expect(await prisma.expenseShare.count({ where: { expenseId: stored[0].id } }), "the removed bill's shares are still stored").toBe(0);

  // ── to the cent ──────────────────────────────────────────────────────────
  expect(await standing(page), "after adding, changing, settling, undoing and removing, what I am owed is not what it was").toBe(before);
  expect(await prisma.expense.count({ where: { eventId: data.eventId } })).toBe(billsBefore);

  expect(errors, "the Money screen threw").toEqual([]);
});
