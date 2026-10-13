import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A POT THE CARDS SETTLE — THE BIRDIE POT: STAKED, ASKED INTO, PAID INTO AND
 * TAKEN OFF.
 *
 * Low gross, low net, birdies, eagles, twos: nobody names a winner, the cards
 * do. What a person does is put their name down and hand over the stake, and
 * `requestSideGameEntry` and `confirmSideGameEntry` — the ask and the taking
 * of the money — were performed by no browser test (round 1 on the frozen app,
 * 2026-10-13). The skins pot and the named-winner bets each have their walk;
 * this is the third kind of pot and the last.
 *
 * The same sentence runs through all three: NOBODY IS IN THE POT UNTIL THEIR
 * MONEY IS.
 *
 *   the birdie pot is staked at 5          → on a player's Money: 5 a head, nobody in
 *   a player presses "I'm in"              → they have ASKED: still nobody in, and
 *                                             a pot of nothing (the control)
 *   the organizer takes their 5            → one in, a pot of 5, "You're in"
 *   the game is taken off with money in it → refused in words: the money comes
 *                                             out first, and the game stays
 *   the player is taken out, then the game → gone from both screens
 *
 * WHAT IT CANNOT SEE: who made the birdies. The audit suite holds what the pot
 * pays against cards; a pot is paid only when the round is final.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; partialCard: { stageId: string; playerId: string } };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const stageId = data.partialCard.stageId;
const prisma = new PrismaClient();

let before: string[] = [];
const newGames = () => prisma.sideGame.findMany({ where: { eventId: data.eventId, id: { notIn: before } }, include: { entrants: true } });
test.beforeAll(async () => {
  before = (await prisma.sideGame.findMany({ where: { eventId: data.eventId }, select: { id: true } })).map((g) => g.id);
});
/** Whatever this made, and nothing the fixture had. */
test.afterAll(async () => {
  await prisma.sideGame.deleteMany({ where: { eventId: data.eventId, id: { notIn: before } } });
  await prisma.$disconnect();
});

test("a birdie pot is staked, asked into, paid into, refused removal with money in it, and taken off", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  const me = await prisma.player.findUniqueOrThrow({ where: { id: data.partialCard.playerId }, select: { name: true } });
  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  try {
    const desk = await organizer.newPage();
    const phone = await member.newPage();
    watchPageErrors(desk, errors);
    watchPageErrors(phone, errors);

    const sideBets = async () => {
      await desk.goto(`/prizes?round=${stageId}&bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
      const c = desk.locator("section.card", { has: desk.locator(".card-kicker", { hasText: "You name the winner" }) }).first();
      await expect(c, "the prizes screen has no side-bets card").toBeVisible();
      return c;
    };
    /** The pot's own block on the organizer's card, once it has a stake. */
    const pot = async () => {
      const card = await sideBets();
      const b = card
        .locator("div", { has: desk.getByRole("button", { name: /^Take Birdie pot off this round$|^Take it off$/ }) })
        .filter({ hasText: /In the pot/i })
        .last();
      await expect(b, "the staked birdie pot is not on the organizer's screen").toBeVisible();
      return b;
    };
    const line = async (p: Page) => {
      await p.goto(`/me/money?bust=${Date.now()}`);
      await p.waitForLoadState("networkidle").catch(() => {});
      const more = p.locator("summary", { hasText: /^More:/ });
      if (await more.count()) await more.first().click();
      return p.locator("section", { hasText: "Pots on the scores" }).locator("div", { hasText: /Birdie pot/ }).filter({ has: p.getByRole("button") }).last();
    };

    // ── staked ──────────────────────────────────────────────────────────────
    const card = await sideBets();
    // The stake boxes run in the order the games are listed: low gross, low net, birdies, eagles, twos.
    const stake = card.locator("label", { hasText: "Stake" }).nth(2).locator("input");
    await stake.fill("5");
    await stake.press("Enter");
    await expect.poll(async () => (await newGames()).map((g) => [g.kind, g.buyInCents]), { timeout: 20_000, message: "the stake was not stored" }).toHaveLength(1);
    const [game] = await newGames();
    expect(game.kind, "CONTROL: the third stake box is not the birdie pot's").toMatch(/birdie/i);
    expect(game.buyInCents).toBe(500);
    expect(game.entrants).toEqual([]);

    // ── a player asks: an ask is not a stake ────────────────────────────────
    let mine = await line(phone);
    await expect(mine, "a player cannot see the birdie pot to ask into it").toBeVisible();
    await expect(mine).toContainText("$5.00 each · $0.00 pot · 0 in");
    await mine.getByRole("button", { name: /^I(’|')m in$/ }).click();
    await expect.poll(async () => (await newGames())[0]?.entrants.map((e) => e.confirmed), { timeout: 20_000, message: "the ask was not recorded" }).toEqual([false]);
    mine = await line(phone);
    await expect(mine.getByRole("button"), "the player's screen does not say they have asked").toHaveText("Asked to join");
    await expect(mine, "CONTROL: an ask put money in the pot").toContainText("$0.00 pot · 0 in");

    // ── the organizer takes the money ───────────────────────────────────────
    let block = await pot();
    await expect(block).toContainText(/Asked to join — take their money \(1\)/i);
    await block.getByRole("button", { name: `${me.name} · $5.00` }).click();
    await expect.poll(async () => (await newGames())[0]?.entrants.map((e) => e.confirmed), { timeout: 20_000, message: "taking the money did not put the player in the pot" }).toEqual([true]);
    mine = await line(phone);
    await expect(mine.getByRole("button"), "the player's screen does not say they are in").toHaveText(/^You(’|')re in$/);
    await expect(mine).toContainText("$5.00 pot · 1 in");

    // ── taken off with money in it: refused, in words ───────────────────────
    block = await pot();
    await block.getByRole("button", { name: "Take Birdie pot off this round" }).click();
    await block.getByRole("button", { name: "Take it off" }).click();
    // Read where it is said — the sentence belongs to this press and is gone on a reload.
    await expect(desk.getByText("1 player has paid into this one. Take them out of the pot first"), "the refusal does not say why, or what to do").toBeVisible({ timeout: 20_000 });
    expect((await newGames()).length, "a game with money in its pot was taken off").toBe(1);

    // ── the money out, then the game ────────────────────────────────────────
    block = await pot();
    await block.locator('button[aria-pressed="true"]', { hasText: me.name }).first().click();
    await expect.poll(async () => (await newGames())[0]?.entrants.filter((e) => e.confirmed && !e.excluded).length, { timeout: 20_000, message: "the player was not taken out of the pot" }).toBe(0);
    block = await pot();
    await block.getByRole("button", { name: "Take Birdie pot off this round" }).click();
    await block.getByRole("button", { name: "Take it off" }).click();
    await expect.poll(async () => (await newGames()).length, { timeout: 20_000, message: "the game was not taken off" }).toBe(0);
    await phone.goto(`/me/money?bust=${Date.now()}`);
    await phone.waitForLoadState("networkidle").catch(() => {});
    await expect(phone.locator("main").getByText("Birdie pot"), "a game taken off is still on a player's screen").toHaveCount(0);

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([organizer, member].map((c) => c.close()));
  }
});
