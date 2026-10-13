import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * THE KITTY: MONEY IN, MONEY OUT, AND WHAT IS LEFT — TO THE CENT.
 *
 * A society that collects one pot and pays its prizes out of it keeps a kitty
 * rather than a settle-up, and the treasurer reads three figures off it: what
 * came in, what went out, what is left. `addFundLine` and `removeFundLine`
 * were performed by no browser test (the first measured round, 2026-10-13).
 * And the amount on a line is the one amount in the app the SERVER reads from
 * text — the reader that took a German club's "12,50" for 1,250.00 until that
 * same night.
 *
 * Every figure below is worked out here and then read off the screen:
 *
 *   no amount                       → the line cannot be recorded (the control)
 *   240 in, entry fees              → In is 240 more, and so is what is left
 *   300.50 out, the trophy          → Out is 300.50 more; the kitty is now SHORT
 *                                     by the difference, and says so
 *   the trophy line is removed      → asked first; then not short any more
 *   the fees line is removed        → the three figures are EXACTLY what they
 *                                     were before any of this
 *
 * and, as a club that writes its money the German way:
 *
 *   12,50 in                        → stored as twelve euros fifty, and written
 *                                     back "12,50 €"
 *
 * WHAT IT CANNOT SEE: whether the treasurer typed the right figure.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const MARK = "zz-kitty";
const prisma = new PrismaClient();
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });
test.describe.configure({ mode: "serial" });

let modeWas = "";
const sweep = () => prisma.tournamentFund.deleteMany({ where: { eventId: data.eventId, description: { startsWith: MARK } } });
test.beforeAll(async () => {
  modeWas = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { moneyMode: true } })).moneyMode;
  await prisma.event.update({ where: { id: data.eventId }, data: { moneyMode: "float" } });
  await sweep();
});
/** The fixture's tournament is every later spec's: how it keeps its money goes back as it was. */
test.afterAll(async () => {
  await sweep();
  await prisma.event.update({ where: { id: data.eventId }, data: { moneyMode: modeWas } });
  await prisma.$disconnect();
});

const lines = () => prisma.tournamentFund.findMany({ where: { eventId: data.eventId, description: { startsWith: MARK } }, orderBy: { createdAt: "asc" } });

/** The kitty card, freshly loaded. */
async function kitty(page: Page) {
  await page.goto(`/prizes?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const card = page.locator("section.card", { has: page.locator(".card-title", { hasText: /^The kitty$/ }) }).first();
  await expect(card, "a tournament that keeps a kitty does not show it").toBeVisible();
  return card;
}

/** Its three figures in cents: in, out, and what is left (negative when it is short). */
async function figures(page: Page) {
  const card = await kitty(page);
  const tile = async (heading: RegExp) => {
    const t = card.locator(".stat-grid > div", { has: page.locator(".card-kicker", { hasText: heading }) }).first();
    const text = await t.innerText();
    const m = /([\d.,]+)/.exec(text.replace(/[^\d.,\n]/g, " ").split("\n").find((l) => /\d/.test(l)) ?? "");
    expect(m, `the kitty's figure is not an amount: ${text}`).not.toBeNull();
    return { cents: Math.round(Number(m![1].replace(/,/g, "")) * 100), text };
  };
  const left = await tile(/^(Left over|Short by)$/i);
  return { in: (await tile(/^In$/i)).cents, out: (await tile(/^Out$/i)).cents, left: /short by/i.test(left.text) ? -left.cents : left.cents };
}

async function record(page: Page, direction: "in" | "out", what: string, amount: string) {
  const card = await kitty(page);
  await card.getByRole("button", { name: direction === "in" ? "Money in" : "Money out", exact: true }).click();
  await card.getByLabel("What was it for?").fill(what);
  await card.getByLabel("Amount", { exact: true }).fill(amount);
  await card.getByRole("button", { name: direction === "in" ? "Record money in" : "Record money out" }).click();
}

test("the kitty takes money in and out, says when it is short, and comes back to the cent", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const before = await figures(page);
  expect(before.left, "CONTROL: what is left is not what came in less what went out").toBe(before.in - before.out);

  // ── no amount: nothing to record ────────────────────────────────────────
  let card = await kitty(page);
  await card.getByLabel("What was it for?").fill(`${MARK} entry fees, 24 players`);
  await expect(card.getByRole("button", { name: "Record money in" }), "CONTROL: a line with no amount can be recorded").toBeDisabled();

  // ── 240 in ──────────────────────────────────────────────────────────────
  await record(page, "in", `${MARK} entry fees, 24 players`, "240");
  await expect.poll(async () => (await lines()).length, { timeout: 20_000, message: "the money in was not stored" }).toBe(1);
  expect((await lines())[0]).toMatchObject({ direction: "in", amountCents: 24_000 });
  expect(await figures(page), "240 in did not add 240 to what came in and to what is left").toEqual({ in: before.in + 24_000, out: before.out, left: before.left + 24_000 });

  // ── 300.50 out: short, and it says so ───────────────────────────────────
  await record(page, "out", `${MARK} winner's trophy`, "300.50");
  await expect.poll(async () => (await lines()).length, { timeout: 20_000, message: "the money out was not stored" }).toBe(2);
  expect((await lines())[1]).toMatchObject({ direction: "out", amountCents: 30_050 });
  const short = await figures(page);
  expect(short, "300.50 out did not add 300.50 to what went out, or what is left is not the difference").toEqual({
    in: before.in + 24_000,
    out: before.out + 30_050,
    left: before.left + 24_000 - 30_050,
  });
  card = await kitty(page);
  if (short.left < 0) await expect(card, "a kitty that has paid out more than it took does not say it is short").toContainText(/Short by/i);

  // ── the trophy line removed: asked first ────────────────────────────────
  const trophy = card.locator("div", { hasText: `${MARK} winner's trophy` }).filter({ has: page.getByRole("button", { name: /Remove this line|Remove it/ }) }).last();
  await trophy.getByRole("button", { name: "Remove this line" }).click();
  expect((await lines()).length, "one press removed a line without asking").toBe(2);
  await trophy.getByRole("button", { name: "Remove it" }).click();
  await expect.poll(async () => (await lines()).length, { timeout: 20_000, message: "the line was not removed" }).toBe(1);
  expect((await figures(page)).out, "removing the trophy did not take it back off what went out").toBe(before.out);

  // ── and the fees: to the cent ───────────────────────────────────────────
  card = await kitty(page);
  const fees = card.locator("div", { hasText: `${MARK} entry fees, 24 players` }).filter({ has: page.getByRole("button", { name: /Remove this line|Remove it/ }) }).last();
  await fees.getByRole("button", { name: "Remove this line" }).click();
  await fees.getByRole("button", { name: "Remove it" }).click();
  await expect.poll(async () => (await lines()).length, { timeout: 20_000 }).toBe(0);
  expect(await figures(page), "after all of it the kitty is not what it was").toEqual(before);
  expect(errors, "the kitty threw").toEqual([]);
});

test("a club that writes 12,50 has its kitty line read as 12,50", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const home = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organizationId: true, organization: { select: { locale: true, currency: true } } } });
  await prisma.organization.update({ where: { id: home.organizationId! }, data: { locale: "de-DE", currency: "EUR" } });
  try {
    await record(page, "in", `${MARK} Startgeld`, "12,50");
    await expect.poll(async () => (await lines()).length, { timeout: 20_000, message: "the line was not stored" }).toBe(1);
    expect((await lines())[0].amountCents, "a line typed 12,50 was not stored as twelve euros fifty").toBe(1250);
    const card = await kitty(page);
    await expect(card.locator("div", { hasText: `${MARK} Startgeld` }).last(), "the line is not written back the way the club writes it").toContainText(/12,50\s€/);
    // And with a thousands point, the way a German treasurer writes one: 1.250,00.
    await record(page, "in", `${MARK} Sponsor`, "1.250,00");
    await expect.poll(async () => (await lines()).length, { timeout: 20_000 }).toBe(2);
    expect((await lines())[1].amountCents, "a line typed 1.250,00 was not stored as one thousand two hundred and fifty").toBe(125_000);
    expect(errors, "the kitty threw").toEqual([]);
  } finally {
    await prisma.organization.update({ where: { id: home.organizationId! }, data: { locale: home.organization!.locale, currency: home.organization!.currency } });
    await sweep();
  }
});
