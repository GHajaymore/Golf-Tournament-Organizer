import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A SKINS POT: A PLAYER ASKS IN, THE ORGANIZER TAKES THE MONEY, OTHERS ARE
 * ADDED, AND THE POT IS TAKEN OFF.
 *
 * Skins is the commonest side game there is, and the pot is other people's
 * money: who is in it decides who can win it and what it is worth. Four of the
 * five actions behind it — `requestSkinsEntry`, `confirmSkinsEntry`,
 * `setSkinsEntrants`, `removeSkinsPot` — were performed by no browser test (the
 * first measured round, 2026-10-13).
 *
 * The rule the whole thing turns on is one sentence: NOBODY IS IN THE POT
 * UNTIL THEIR MONEY IS. A player putting their name down is an ask; the pot
 * and its size count only what somebody has collected. So:
 *
 *   the stake is set at 5                 → the pot is 5 a head, and empty
 *   a player presses "I'm in"             → they have ASKED: the pot is still
 *                                            empty and worth nothing (the control)
 *   the organizer takes their 5           → one in, a pot of 5, and the
 *                                            player's screen says "You're in"
 *   two more are ticked as paid           → three in, a pot of 15, on both screens
 *   the pot is removed                    → asked first, told how many paid;
 *                                            then gone from both screens
 *
 * WHAT IT CANNOT SEE: who wins a skin. That is the scoring, and the scenario
 * tournaments and the audit suite hold it against the Rules.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; partialCard: { stageId: string } };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const stageId = data.partialCard.stageId;
const prisma = new PrismaClient();

type Pot = Awaited<ReturnType<typeof pots>>[number];
const pots = () => prisma.skinsPot.findMany({ where: { eventId: data.eventId }, include: { entrants: true } });
let was: Pot[] = [];

test.beforeAll(async () => {
  was = await pots();
});
/** The fixture's pots are every later spec's: they are put back row for row. */
test.afterAll(async () => {
  await prisma.skinsPot.deleteMany({ where: { eventId: data.eventId } });
  for (const { entrants, ...pot } of was) {
    await prisma.skinsPot.create({ data: { ...pot, entrants: { create: entrants.map(({ potId: _potId, ...e }) => e) } } });
  }
  await prisma.$disconnect();
});

const thePot = async () => (await pots()).find((p) => p.stageId === stageId && !p.groupKey);
const paid = async () => (await thePot())?.entrants.filter((e) => e.confirmed).length ?? 0;

test("a player asks into the skins, the organizer takes the money, two more are added, and the pot is removed", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  // Starts from a pot nobody is in.
  await prisma.skinsEntry.deleteMany({ where: { pot: { eventId: data.eventId, stageId } } });

  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  try {
    const desk = await organizer.newPage();
    const phone = await member.newPage();
    watchPageErrors(desk, errors);
    watchPageErrors(phone, errors);

    /** The club's skins card on the prizes screen: the one with a buy-in box. */
    const card = async () => {
      await desk.goto(`/prizes?round=${stageId}&bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
      const c = desk.locator(".card", { has: desk.getByLabel(/^Buy-in \(/) }).first();
      await expect(c, "the prizes screen has no skins pot to set up").toBeVisible();
      return c;
    };
    /** The pot's line on the player's Money screen: its words, and its button. */
    const line = async (p: Page) => {
      await p.goto(`/me/money?bust=${Date.now()}`);
      await p.waitForLoadState("networkidle").catch(() => {});
      // The pots are below the one number this screen leads with, behind its "More".
      const more = p.locator("summary", { hasText: /^More:/ });
      if (await more.count()) await more.first().click();
      return p.locator("section", { hasText: "Pots on the scores" }).locator("div", { hasText: /Skins/ }).filter({ has: p.getByRole("button") }).last();
    };

    // ── the stake ───────────────────────────────────────────────────────────
    let pot = await card();
    await pot.getByLabel(/^Buy-in \(/).fill("5");
    await pot.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await thePot())?.buyInCents, { message: "the stake was not stored" }).toBe(500);
    expect(await paid()).toBe(0);

    // ── a player asks: an ask is not a stake ────────────────────────────────
    let mine = await line(phone);
    await expect(mine, "a player cannot see the skins pot to ask into it").toBeVisible();
    await expect(mine).toContainText("$5.00 each");
    await expect(mine).toContainText("0 in");
    await mine.getByRole("button", { name: "I’m in" }).or(mine.getByRole("button", { name: "I'm in" })).click();
    await expect.poll(async () => (await thePot())?.entrants.length, { message: "the ask was not recorded" }).toBe(1);
    expect(await paid(), "CONTROL: a player who only asked is counted as having paid").toBe(0);
    mine = await line(phone);
    await expect(mine.getByRole("button"), "the player's screen does not say they have asked").toHaveText("Asked to join");
    await expect(mine, "CONTROL: an ask put money in the pot").toContainText("$0.00 pot");
    await expect(mine).toContainText("0 in");

    // ── the organizer takes the money ───────────────────────────────────────
    pot = await card();
    await expect(pot, "an empty pot is shown with somebody in it").toContainText(/In the pot — 0 players/i);
    const take = pot.getByRole("button", { name: /— take \$5\.00$/ });
    await expect(take, "the organizer is not shown who asked to join").toHaveCount(1);
    await take.click();
    await expect.poll(paid, { message: "taking the money did not put the player in the pot" }).toBe(1);
    pot = await card();
    await expect(pot).toContainText(/In the pot — 1 player(?!s)/i);
    mine = await line(phone);
    await expect(mine.getByRole("button"), "the player's screen does not say they are in").toHaveText(/You(’|')re in/);
    await expect(mine).toContainText("$5.00 pot");
    await expect(mine).toContainText("1 in");

    // ── two more, ticked by whoever collected ───────────────────────────────
    await pot.getByRole("button", { name: "Change", exact: true }).click();
    const boxes = pot.getByRole("checkbox");
    const total = await boxes.count();
    expect(total, "the field is not offered to tick").toBeGreaterThanOrEqual(3);
    let ticked = 0;
    for (let i = 0; i < total; i += 1) if (await boxes.nth(i).isChecked()) ticked += 1;
    // The tick is drawn by its label (the box itself is not on screen), so the label is what a finger presses.
    const names = pot.locator("label.radio");
    for (let i = 0; i < total && ticked < 3; i += 1) {
      if (!(await boxes.nth(i).isChecked())) {
        await names.nth(i).click();
        await expect(boxes.nth(i)).toBeChecked();
        ticked += 1;
      }
    }
    await pot.getByRole("button", { name: "Save who paid in" }).click();
    await expect.poll(paid, { message: "the two ticked were not put in the pot" }).toBe(3);
    pot = await card();
    await expect(pot).toContainText(/In the pot — 3 players/i);
    mine = await line(phone);
    await expect(mine, "the pot on a player's screen is not three stakes of 5").toContainText("$15.00 pot");
    await expect(mine).toContainText("3 in");

    // ── removed: asked first, and told what is at stake ─────────────────────
    await pot.getByRole("button", { name: "Remove this pot" }).click();
    await expect(pot, "removing a pot does not say how many have paid in").toContainText("3 people have paid in.");
    expect(await paid(), "one press removed a pot with money in it").toBe(3);
    await pot.getByRole("button", { name: "Remove the pot" }).click();
    await expect.poll(async () => (await thePot()) ?? null, { message: "the pot was not removed" }).toBeNull();
    await phone.goto(`/me/money?bust=${Date.now()}`);
    await phone.waitForLoadState("networkidle").catch(() => {});
    await expect(phone.locator("main").getByText(/\$15\.00 pot/), "a removed pot is still on a player's screen").toHaveCount(0);

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([organizer, member].map((c) => c.close()));
  }
});
