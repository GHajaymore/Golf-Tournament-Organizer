import { test, expect, type Page, type Locator } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A SIDE BET SOMEBODY HAS TO JUDGE: STARTED, JOINED, PAID INTO, WON, TIED,
 * OPENED TO THE WHOLE FIELD AND TAKEN OFF — AND THE WINNER'S MONEY IS RIGHT
 * AT EVERY STEP.
 *
 * Closest to the pin, the long drive, the poker school on the Saturday night:
 * nothing on a card decides these, so the organizer ticks who was in and who
 * took it. All six actions behind that — `addContest`, `requestContestEntry`,
 * `confirmContestEntry`, `setContestEntrants`, `setContestWinners`,
 * `removeContest` — and the two that open a pot to the whole field
 * (`setPotEntryMode`, `setPotExcluded`) were performed by no browser test
 * (the first measured round, 2026-10-13).
 *
 * The figure is the test, as it is for shared costs. A member's Money screen
 * leads with one number, and every step says in advance what it must become:
 *
 *   a bet of 10 a head is started          → nobody is in it; nobody owes anything
 *   I press "I'm in"                       → I have ASKED: the pot is empty and my
 *                                             number has not moved (the control)
 *   the organizer takes my 10              → one in, a pot of 10 — and STILL my
 *                                             number has not moved: an open pot
 *                                             charges nobody
 *   two more are ticked in                 → three in, a pot of 30
 *   I am named the winner                  → I am 20 better off: the pot less my own stake
 *   a second winner is ticked — a tie      → the pot splits: I am 5 better off
 *   the tie is taken back                  → 20 again
 *   the bet is opened to the whole field   → both screens count the same people,
 *                                             the pot is that many stakes, and I am
 *                                             better off by the pot less my own
 *   one of them is taken out               → one fewer on both screens, one stake less
 *   the bet is removed                     → asked first; then my number is EXACTLY
 *                                             what it was before any of this
 *
 * WHAT IT CANNOT SEE: whether the right person was nearest the pin. That is
 * the committee's eye, and the app records the tick.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as {
  eventId: string;
  partialCard: { stageId: string; playerId: string };
};
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const stageId = data.partialCard.stageId;
const meId = data.partialCard.playerId;
const MARK = "zz-bet";
const BET = `${MARK} nearest the flag`;
const STAKE = 1000;
const prisma = new PrismaClient();

const sweep = () => prisma.contest.deleteMany({ where: { eventId: data.eventId, name: { startsWith: MARK } } });
test.afterAll(async () => {
  await sweep();
  await prisma.$disconnect();
});

const theBet = () => prisma.contest.findFirst({ where: { eventId: data.eventId, name: BET }, include: { entrants: true } });
const paidIn = async () => (await theBet())?.entrants.filter((e) => e.confirmed && !e.excluded).length ?? 0;
const winners = async () => ((await theBet())?.entrants.filter((e) => e.won).map((e) => e.playerId) ?? []).sort();

/** "$1,234.56" as cents. */
const cents = (text: string) => {
  const m = /\$([\d,]+)\.(\d\d)/.exec(text);
  if (!m) throw new Error(`no amount in "${text}"`);
  return Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);
};

/** The one number the Money screen leads with, signed: owed is positive, owing negative. */
async function standing(page: Page): Promise<number> {
  await page.goto(`/me/money?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const head = (await page.locator("main").innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
  const at = head.findIndex((l) => /^You(’|')re owed$|^You owe$|^All square$|^You(’|')re square$/.test(l));
  expect(at, `the Money screen does not lead with where I stand:\n${head.slice(0, 8).join("\n")}`).toBeGreaterThanOrEqual(0);
  if (/square/i.test(head[at])) return 0;
  return (/owed/.test(head[at]) ? 1 : -1) * cents(head[at + 1]);
}

test("a side game is started, joined, paid into, won, tied, opened to the field and removed — and the winner's money is right throughout", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const device = testInfo.project.use;
  await sweep();
  const me = await prisma.player.findUniqueOrThrow({ where: { id: meId }, select: { name: true } });

  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  try {
    const desk = await organizer.newPage();
    const phone = await member.newPage();
    watchPageErrors(desk, errors);
    watchPageErrors(phone, errors);

    const before = await standing(phone);

    /** The side-bets card on the prizes screen. */
    const sideBets = async () => {
      await desk.goto(`/prizes?round=${stageId}&bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
      const c = desk.locator("section.card", { has: desk.locator(".card-kicker", { hasText: "You name the winner" }) }).first();
      await expect(c, "the prizes screen has no side-bets card").toBeVisible();
      return c;
    };
    /** This bet's own block on that card: the smallest thing holding both its name and its Remove. */
    const bet = async () => {
      const card = await sideBets();
      const b = card.locator("div", { hasText: BET }).filter({ has: desk.getByRole("button", { name: /^Remove (this game|the game)$/ }) }).last();
      await expect(b, "the bet is not on the organizer's screen").toBeVisible();
      return b;
    };
    /** A part of the bet's block, by the small heading over it. */
    const part = (b: Locator, heading: RegExp) => b.locator("div", { has: desk.locator(":scope > .card-kicker", { hasText: heading }) }).last();
    /** The bet's line on the player's Money screen. */
    const line = async () => {
      await phone.goto(`/me/money?bust=${Date.now()}`);
      await phone.waitForLoadState("networkidle").catch(() => {});
      const more = phone.locator("summary", { hasText: /^More:/ });
      if (await more.count()) await more.first().click();
      return phone.locator("section", { hasText: "Decided on the day" }).locator("div", { hasText: BET }).last();
    };

    // ── a stake that is not an amount starts nothing ────────────────────────
    let card = await sideBets();
    await card.getByRole("button", { name: "Add a game" }).click();
    await card.getByLabel("Game", { exact: true }).selectOption({ label: "Closest to the pin" });
    await card.getByLabel("Hole (optional)").fill("7");
    await card.getByLabel("Name", { exact: true }).fill(BET);
    await card.getByLabel("Stake per player").fill("ten");
    await card.getByRole("button", { name: "Start this game" }).click();
    await expect(card, "a stake that is not an amount is not refused in words").toContainText("Enter a stake per player");
    expect(await theBet(), "CONTROL: a bet with no stake was started").toBeNull();

    // ── started ─────────────────────────────────────────────────────────────
    await card.getByLabel("Stake per player").fill("10");
    await card.getByRole("button", { name: "Start this game" }).click();
    await expect.poll(theBet, { timeout: 20_000, message: "the bet was not stored" }).not.toBeNull();
    expect(await theBet()).toMatchObject({ kind: "closest-pin", hole: 7, buyInCents: STAKE, stageId, entryMode: "opt-in" });
    expect(await paidIn(), "a new bet has somebody in it").toBe(0);
    let b = await bet();
    await expect(b).toContainText("hole 7");
    await expect(b).toContainText("$0.00 pot");
    await expect(b).toContainText("$10.00 each");
    await expect(b).toContainText("In the pot (0)");

    // ── I ask: an ask is not a stake ────────────────────────────────────────
    let mine = await line();
    await expect(mine, "a player cannot see the bet to ask into it").toBeVisible();
    await expect(mine).toContainText("hole 7");
    await expect(mine).toContainText("$0.00 pot · 0 in · still open");
    await mine.getByRole("button", { name: /^I(’|')m in$/ }).click();
    await expect.poll(async () => (await theBet())?.entrants.length, { timeout: 20_000, message: "the ask was not recorded" }).toBe(1);
    expect(await paidIn(), "CONTROL: a player who only asked is counted as having paid").toBe(0);
    mine = await line();
    await expect(mine.getByRole("button"), "the player's screen does not say they have asked").toHaveText("Asked to join");
    await expect(mine, "CONTROL: an ask put money in the pot").toContainText("$0.00 pot · 0 in");
    expect(await standing(phone), "CONTROL: asking to join moved what I am owed").toBe(before);

    // ── the organizer takes my stake ────────────────────────────────────────
    b = await bet();
    const asked = part(b, /^Asked to join — take their money \(1\)$/);
    await expect(asked, "the organizer is not shown who asked to join").toBeVisible();
    await asked.getByRole("button", { name: `${me.name} · $10.00` }).click();
    await expect.poll(paidIn, { timeout: 20_000, message: "taking the money did not put the player in the pot" }).toBe(1);
    b = await bet();
    await expect(b).toContainText("In the pot (1)");
    await expect(b).toContainText("$10.00 pot");
    mine = await line();
    await expect(mine.getByRole("button"), "the player's screen does not say they are in").toHaveText(/^You(’|')re in$/);
    await expect(mine).toContainText("$10.00 pot · 1 in · still open");
    expect(await standing(phone), "CONTROL: a bet nobody has won yet charged somebody").toBe(before);

    // ── two more, ticked by whoever collected ───────────────────────────────
    for (let n = 2; n <= 3; n += 1) {
      b = await bet();
      await part(b, /^In the pot/).locator('button[aria-pressed="false"]').first().click();
      await expect.poll(paidIn, { timeout: 20_000, message: `player ${n} was not put in the pot` }).toBe(n);
    }
    b = await bet();
    await expect(b).toContainText("In the pot (3)");
    await expect(b).toContainText("$30.00 pot");
    await expect(b).toContainText("Still open");
    mine = await line();
    await expect(mine, "the pot on a player's screen is not three stakes of 10").toContainText("$30.00 pot · 3 in · still open");

    // ── won ─────────────────────────────────────────────────────────────────
    await part(b, /^Winner/).getByRole("button", { name: me.name, exact: true }).click();
    await expect.poll(winners, { timeout: 20_000, message: "the winner was not recorded" }).toEqual([meId]);
    b = await bet();
    await expect(b, "the organizer is not told what the winner takes").toContainText("$30.00 to the winner.");
    mine = await line();
    await expect(mine, "the player's screen does not name the winner").toContainText(`won by ${me.name}`);
    expect(await standing(phone), "winning a pot of 30 I put 10 into did not leave me 20 better off").toBe(before + 2 * STAKE);

    // ── a tie splits the pot ────────────────────────────────────────────────
    await part(b, /^Winner/).locator('button[aria-pressed="false"]').first().click();
    await expect.poll(async () => (await winners()).length, { timeout: 20_000, message: "the second winner was not recorded" }).toBe(2);
    b = await bet();
    await expect(b).toContainText("Winners — tie, pot splits");
    await expect(b).toContainText("$30.00 split 2 ways.");
    expect(await standing(phone), "half a pot of 30, less my 10, is not 5").toBe(before + STAKE / 2);
    const other = (await winners()).find((id) => id !== meId)!;
    const otherName = (await prisma.player.findUniqueOrThrow({ where: { id: other }, select: { name: true } })).name;
    await part(b, /^Winner/).getByRole("button", { name: otherName, exact: true }).click();
    await expect.poll(winners, { timeout: 20_000, message: "the tie was not taken back" }).toEqual([meId]);
    expect(await standing(phone)).toBe(before + 2 * STAKE);

    // ── opened to the whole field ───────────────────────────────────────────
    b = await bet();
    await b.getByRole("button", { name: "Everyone in the field", exact: true }).click();
    await expect.poll(async () => (await theBet())?.entryMode, { timeout: 20_000, message: "the bet was not opened to the field" }).toBe("opt-out");
    b = await bet();
    // Read as written in the page, not as drawn: the small heading is set in capitals.
    const said = /In the pot \((\d+)\)/.exec((await b.textContent()) ?? "");
    expect(said, "the organizer is not told how many are in").not.toBeNull();
    const everyone = Number(said![1]);
    expect(everyone, "opening a bet to the field put nobody new in it").toBeGreaterThan(3);
    await expect(b, "the organizer's pot is not one stake for each person in it").toContainText(`$${everyone * 10}.00 pot`);
    mine = await line();
    await expect(mine, "the player's screen and the organizer's do not count the same people in the pot").toContainText(`$${everyone * 10}.00 pot · ${everyone} in`);
    expect(await standing(phone), "I am not better off by the whole pot less my own stake").toBe(before + (everyone - 1) * STAKE);

    // ── one of them taken out ───────────────────────────────────────────────
    const out = part(b, /^In the pot/).locator('button[aria-pressed="true"]').filter({ hasNotText: me.name }).last();
    await out.click();
    await expect.poll(async () => (await theBet())?.entrants.filter((e) => e.excluded).length, { timeout: 20_000, message: "nobody was taken out of the pot" }).toBe(1);
    b = await bet();
    await expect(b, "taking somebody out did not make the pot one smaller").toContainText(`In the pot (${everyone - 1})`);
    mine = await line();
    await expect(mine).toContainText(`$${(everyone - 1) * 10}.00 pot · ${everyone - 1} in`);
    expect(await standing(phone), "taking one person out did not take one stake off my winnings").toBe(before + (everyone - 2) * STAKE);

    // ── removed: asked first ────────────────────────────────────────────────
    await b.getByRole("button", { name: "Remove this game" }).click();
    expect(await theBet(), "one press removed a bet with a pot against it").not.toBeNull();
    await b.getByRole("button", { name: "Remove the game" }).click();
    await expect.poll(theBet, { timeout: 20_000, message: "the bet was not removed" }).toBeNull();
    expect(await prisma.contestEntry.count({ where: { contest: { eventId: data.eventId, name: BET } } })).toBe(0);
    await phone.goto(`/me/money?bust=${Date.now()}`);
    await phone.waitForLoadState("networkidle").catch(() => {});
    await expect(phone.locator("main").getByText(BET), "a removed bet is still on a player's screen").toHaveCount(0);

    // ── to the cent ─────────────────────────────────────────────────────────
    expect(await standing(phone), "after all of it, what I am owed is not what it was").toBe(before);
    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await Promise.all([organizer, member].map((c) => c.close()));
  }
});

/**
 * A CLUB THAT WRITES 10,50 HAS ITS STAKE READ AS 10,50.
 *
 * Found by the test above, on its first run (2026-10-13): the stake box is
 * filled in the club's language and was read without it, so a German, French
 * or Spanish club's "5,00" came back as 500.00. `figures-are-read-in-every-
 * language.test.ts` holds the reader over every language and currency; this
 * is the same thing done by a person, in the two boxes of this card:
 *
 *   a bet is started at 10,50              → stored as 10.50, and written back
 *                                             "10,50 €" — not a thousand and fifty
 *   a pot the cards settle is staked 2,50  → stored as 2.50; after a reload the
 *                                             box says 2,50
 *   that box is entered and left untouched → still 2.50 (the control: what the
 *                                             app wrote, the app reads back)
 *   a stake with no figure in it           → refused in words, nothing started
 */
test("a club that writes a decimal comma has its stakes read as it wrote them", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const BET_DE = `${MARK} längster Drive`;
  await sweep();
  const home = await prisma.event.findUniqueOrThrow({
    where: { id: data.eventId },
    select: { organizationId: true, organization: { select: { locale: true, currency: true } } },
  });
  const gamesBefore = (await prisma.sideGame.findMany({ where: { eventId: data.eventId }, select: { id: true } })).map((g) => g.id);
  const newGames = () => prisma.sideGame.findMany({ where: { eventId: data.eventId, id: { notIn: gamesBefore } } });
  await prisma.organization.update({ where: { id: home.organizationId! }, data: { locale: "de-DE", currency: "EUR" } });

  const organizer = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: ORGANIZER });
  try {
    const desk = await organizer.newPage();
    watchPageErrors(desk, errors);
    const sideBets = async () => {
      await desk.goto(`/prizes?round=${stageId}&bust=${Date.now()}`);
      await desk.waitForLoadState("networkidle").catch(() => {});
      const c = desk.locator("section.card", { has: desk.locator(".card-kicker", { hasText: "You name the winner" }) }).first();
      await expect(c, "the prizes screen has no side-bets card").toBeVisible();
      return c;
    };
    const stored = () => prisma.contest.findFirst({ where: { eventId: data.eventId, name: BET_DE } });

    // ── no figure in it: nothing is started ─────────────────────────────────
    let card = await sideBets();
    await card.getByRole("button", { name: "Add a game" }).click();
    await card.getByLabel("Game", { exact: true }).selectOption({ label: "Long drive" });
    await card.getByLabel("Name", { exact: true }).fill(BET_DE);
    await card.getByLabel("Stake per player").fill("zehn");
    await card.getByRole("button", { name: "Start this game" }).click();
    await expect(card, "a stake with no figure in it is not refused in words").toContainText("Enter a stake per player");
    expect(await stored(), "CONTROL: a bet with no stake was started").toBeNull();

    // ── 10,50 is ten and a half ─────────────────────────────────────────────
    await card.getByLabel("Stake per player").fill("10,50");
    await card.getByRole("button", { name: "Start this game" }).click();
    await expect.poll(stored, { timeout: 20_000, message: "the bet was not stored" }).not.toBeNull();
    expect((await stored())!.buyInCents, "a stake typed 10,50 was not stored as ten euros fifty").toBe(1050);
    card = await sideBets();
    await expect(card, "the stake is not written back the way the club writes it").toContainText(/10,50\s€ each/);

    // ── a pot the cards settle: 2,50, and what the app wrote it reads back ──
    const stake = () => card.locator("label", { hasText: "Stake" }).first().locator("input");
    await stake().fill("2,50");
    await stake().press("Enter");
    await expect.poll(async () => (await newGames()).map((g) => g.buyInCents), { timeout: 20_000, message: "a stake typed 2,50 was not stored as two euros fifty" }).toEqual([250]);
    card = await sideBets();
    await expect(stake(), "the box does not say what was stored, the way the club writes it").toHaveValue("2,50");
    await stake().focus();
    await stake().press("Enter");
    await desk.waitForTimeout(1500);
    expect((await newGames()).map((g) => g.buyInCents), "CONTROL: entering the box and leaving it changed the stake").toEqual([250]);
    card = await sideBets();
    await expect(stake()).toHaveValue("2,50");

    expect(errors, "a screen threw").toEqual([]);
  } finally {
    await organizer.close();
    await prisma.organization.update({ where: { id: home.organizationId! }, data: { locale: home.organization!.locale, currency: home.organization!.currency } });
    await prisma.sideGame.deleteMany({ where: { eventId: data.eventId, id: { notIn: gamesBefore } } });
    await sweep();
  }
});
