import { createHmac } from "node:crypto";
import { test, expect, type Locator, type Page } from "./coverage";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { pressReopen } from "./end-early";
import { signedInNow } from "../scripts/session-cookie.mjs";
import * as rf from "./rounds-fixture";
import { PrizesScreen } from "./console/prizes";
import { MoneyScreen } from "./console/money";

/**
 * WHAT MONEY OFFERED IS REFUSED IN WORDS ONCE THE TOURNAMENT IS COMPLETED; THE LEDGER IS NOT; REOPEN GIVES IT BACK
 * (state machine PR L; backlog B95; Ajay, 19 Nov 2026).
 *
 * `locked-setup-refuses-in-words.spec.ts` presses ONE money control (Add a prize). The rest of what a tournament OFFERS
 * — a skins game, a side game, a contest, how money is handled, a game started from a player's Money — was held by the
 * audit test (`a-money-locks-at-completion.audit.test.ts`) and the source sweep, and no browser pressed them. This does,
 * as the people who would.
 *
 * Each press is made on a screen DRAWN while the tournament was live (so the control is offered) and completed "in
 * another tab" (the database), then pressed. The refusal must be said where the press was — in the viewport, in the
 * money lock's words — with the screen still there, the banner caught up (Reopen as a link, never a committee
 * correction), and nothing written:
 *
 *   Prizes & payouts   Skins · Save the buy-in                   → "change a skins game"
 *                      Skins · Remove this pot                   → "remove a skins game"
 *                      Side games · a stake                      → "change a side game"
 *                      Side games · Take Birdie pot off          → "remove a side game"
 *                      Side games · how a pot is entered         → "change how a pot is entered"
 *                      Side games · Add a game, Start this game  → "add a contest"
 *                      Side games · Remove this game             → "remove a contest"
 *                      Money in this tournament · a mode         → "change how money is handled"
 *   A player's Money   Start a side game · Start it with 2       → "change a skins game"
 *
 * THE LEDGER IS NOT BEHIND IT: on the completed tournament the organizer names a contest's winner and a player adds a
 * shared expense — both written. THEN REOPEN, pressed on the dashboard as the organizer would: the status is live
 * again and the skins buy-in Save that was refused is saved.
 *
 * Its own club, marked zz-b95, invented names, `@example.invalid`, removed in a `finally`. One size: the refusal is the
 * server's answer, the same at every width. Nothing here stubs a request, so no service worker is in the way.
 */

const prisma = new PrismaClient();
const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;
const MARK = "zz-b95";
const WALKED = ["desktop"];

const DONE = (what: string) => `Locked because the tournament is completed. Reopen it on the dashboard to ${what}.`;

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("every offer-side control on a completed tournament is refused in words; the ledger still works; Reopen gives the offer back", async ({ browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "one size: the refusal is the server's answer, the same at every width");
  test.setTimeout(420_000);
  const errors: string[] = [];
  const names = { org: `${MARK} club`, event: `${MARK} medal`, organizer: `${MARK}-organizer@example.invalid`, member: `${MARK}-member@example.invalid` };
  const sweep = async () => {
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  };
  const fresh = () => browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
  const contexts: Awaited<ReturnType<typeof fresh>>[] = [];

  try {
    await sweep();

    // ── the fixture: a live medal in its own club, a skins game, a side game and a contest with people in them ──
    const organizer = await prisma.user.create({ data: { email: names.organizer, name: "Zz Organizer", password: "x:unusable", emailVerifiedAt: new Date() } });
    const memberUser = await prisma.user.create({ data: { email: names.member, name: "Zz Ada Fernsby", password: "x:unusable", emailVerifiedAt: new Date() } });
    const org = await prisma.organization.create({
      data: {
        name: names.org,
        kind: "club",
        timeZone: "Europe/London",
        locale: "en-GB",
        members: { create: [{ userId: organizer.id, role: "owner" }, { userId: memberUser.id, role: "member" }] },
      },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: names.event,
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        status: "live",
        launchedAt: new Date(),
        moneyMode: "split",
        shareToken: `${MARK}-${Date.now()}`,
        customPars: JSON.stringify(new Array(18).fill(4)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    const eventId = event.id;
    const stage = await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" } });
    const people: { id: string; name: string }[] = [];
    for (const [i, name] of ["Zz Ada Fernsby", "Zz Bram Oakhurst", "Zz Cleo Marrow"].entries()) {
      // The first is the member: a player is matched to a person by the email on the list.
      const email = i === 0 ? names.member : `${MARK}-player-${i}@example.invalid`;
      const p = await prisma.player.create({ data: { eventId, name, email, seed: i + 1, status: "confirmed", handicap: 10 + i } });
      people.push({ id: p.id, name });
    }
    const [ada, bram] = people;
    await prisma.account.create({ data: { eventId, email: names.organizer, name: "Zz Organizer", role: "admin" } });
    const pot = await prisma.skinsPot.create({ data: { eventId, stageId: stage.id, net: true, scope: "full", groupKey: "", buyInCents: 500 } });
    await prisma.skinsEntry.createMany({ data: [ada, bram].map((p) => ({ potId: pot.id, playerId: p.id })) });
    await prisma.sideGame.create({ data: { eventId, stageId: stage.id, kind: "birdies", buyInCents: 500, groupKey: "", createdBy: "zz" } });
    const contest = await prisma.contest.create({ data: { eventId, stageId: stage.id, kind: "closest-pin", name: `${MARK} closest`, hole: 7, buyInCents: 500, createdBy: "zz" } });
    await prisma.contestEntry.createMany({ data: [ada, bram].map((p) => ({ contestId: contest.id, playerId: p.id })) });
    await prisma.prize.create({ data: { eventId, position: 1, category: `${MARK} Best gross`, amount: 0 } });

    const setStatus = (status: "live" | "completed") => prisma.event.update({ where: { id: eventId }, data: { status } });
    /** Everything a refused offer-side press could have written. */
    const snapshot = async () => {
      const [prizes, contests, sideGames, pots, entries, ev] = await Promise.all([
        prisma.prize.findMany({ where: { eventId }, select: { id: true, category: true, amount: true }, orderBy: { id: "asc" } }),
        prisma.contest.findMany({ where: { eventId }, select: { id: true, name: true, entryMode: true, buyInCents: true }, orderBy: { id: "asc" } }),
        prisma.sideGame.findMany({ where: { eventId }, select: { id: true, buyInCents: true, entryMode: true }, orderBy: { id: "asc" } }),
        prisma.skinsPot.findMany({ where: { eventId }, select: { id: true, buyInCents: true }, orderBy: { id: "asc" } }),
        prisma.skinsEntry.count({ where: { pot: { eventId } } }),
        prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { moneyMode: true } }),
      ]);
      return { prizes, contests, sideGames, pots, entries, ev };
    };

    const desk = await fresh();
    contexts.push(desk);
    await desk.addCookies([
      { name: "ng_session", value: sign(signedInNow(organizer.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(eventId), url: baseURL! },
    ]);
    const phone = await fresh();
    contexts.push(phone);
    await phone.addCookies([
      { name: "ng_session", value: sign(signedInNow(memberUser.id)), url: baseURL! },
      { name: "ng_active_event", value: sign(eventId), url: baseURL! },
    ]);
    const page = await desk.newPage();
    const mine = await phone.newPage();
    watchPageErrors(page, errors, "organizer");
    watchPageErrors(mine, errors, "member");

    const open = async (p: Page, path: string) => {
      await p.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
      await p.waitForLoadState("networkidle").catch(() => {});
    };
    const LOCK_LINE = /Locked because the tournament is completed\./;

    /**
     * Draw the screen while the tournament is live, complete it "in another tab", press, and read the answer: said and
     * in view, the screen still there, the banner caught up with Reopen (never a correction), and nothing written.
     */
    const pressedAfterCompletion = async (step: {
      label: string;
      on: Page;
      path: string;
      heading: RegExp;
      said: string;
      press: (p: Page) => Promise<void>;
      /** The banner's own line: the organizer's names the scope; a player's is the sentence alone. */
      reopenOnBanner: boolean;
    }) => {
      await setStatus("live");
      await open(step.on, step.path);
      await expect(step.on.getByRole("region", { name: "Locked" }), `${step.label}: the screen was drawn locked`).toHaveCount(0);
      const before = await snapshot();
      await setStatus("completed");
      await step.press(step.on);
      const said = step.on.getByText(step.said).first();
      await expect(said, `${step.label}: the refusal was not said`).toBeVisible({ timeout: 20_000 });
      await expect(said, `${step.label}: the refusal was said off screen`).toBeInViewport();
      await expect(step.on.getByRole("heading", { level: 1, name: step.heading }), `${step.label}: the screen was replaced by an error page`).toBeVisible();
      const banner = step.on.getByRole("region", { name: "Locked" });
      await expect(banner, `${step.label}: the screen did not catch up with the lock`).toContainText(LOCK_LINE, { timeout: 20_000 });
      await expect(banner.getByRole("button", { name: "Make a committee correction" }), `${step.label}: a committee correction is offered for a lock it cannot open`).toHaveCount(0);
      if (step.reopenOnBanner) await expect(banner.getByRole("link", { name: "Reopen it on the dashboard" }), `${step.label}: Reopen is not offered on the banner`).toBeVisible();
      expect(await snapshot(), `${step.label}: written while locked`).toEqual(before);
    };

    const sideGamesCard = () => page.locator("section.card", { has: page.locator(".card-title", { hasText: "Side games" }) }).first();
    const skinsCard = () => page.locator("div.card", { has: page.getByText(/^Skins — net/) }).first();
    const prizes = { path: "/prizes", heading: /^Prizes & payouts$/, on: page, reopenOnBanner: true };

    await pressedAfterCompletion({
      ...prizes,
      label: "Skins · Save the buy-in",
      said: DONE("change a skins game"),
      press: async () => {
        await skinsCard().getByLabel(/^Buy-in/).fill("9");
        await skinsCard().getByRole("button", { name: "Save", exact: true }).click();
      },
    });

    await pressedAfterCompletion({
      ...prizes,
      label: "Skins · Remove this pot",
      said: DONE("remove a skins game"),
      press: async () => {
        await skinsCard().getByRole("button", { name: "Remove this pot" }).click();
        await skinsCard().getByRole("button", { name: "Remove the pot" }).click();
      },
    });

    await pressedAfterCompletion({
      ...prizes,
      label: "Side games · the Birdie pot's stake",
      said: DONE("change a side game"),
      press: async () => {
        const box = sideGamesCard().getByLabel("Stake for Birdie pot");
        await box.fill("9");
        // A stake saves when its box is left.
        await box.press("Tab");
      },
    });

    await pressedAfterCompletion({
      ...prizes,
      label: "Side games · Take Birdie pot off this round",
      said: DONE("remove a side game"),
      press: async () => {
        await sideGamesCard().getByRole("button", { name: "Take Birdie pot off this round" }).click();
        await sideGamesCard().getByRole("button", { name: "Take it off" }).click();
      },
    });

    await pressedAfterCompletion({
      ...prizes,
      label: "Side games · how a pot is entered",
      said: DONE("change how a pot is entered"),
      // A contest starts on "Players opt in"; the other is pressed.
      press: async () => {
        await sideGamesCard().getByRole("button", { name: "Everyone in the field" }).first().click();
      },
    });

    await pressedAfterCompletion({
      ...prizes,
      label: "Side games · Add a game · Start this game",
      said: DONE("add a contest"),
      press: async () => {
        const card = sideGamesCard();
        await card.getByRole("button", { name: "Add a game" }).click();
        await card.getByLabel("Name", { exact: true }).fill(`${MARK} long drive`);
        await card.getByLabel("Stake per player").fill("5");
        await card.getByRole("button", { name: "Start this game" }).click();
      },
    });

    await pressedAfterCompletion({
      ...prizes,
      label: "Side games · Remove this game",
      said: DONE("remove a contest"),
      press: async () => {
        await sideGamesCard().getByRole("button", { name: "Remove this game" }).click();
        await sideGamesCard().getByRole("button", { name: "Remove the game" }).click();
      },
    });

    await pressedAfterCompletion({
      ...prizes,
      label: "Money in this tournament · Tournament kitty",
      said: DONE("change how money is handled"),
      press: async (p) => {
        // A plain radio, so pressed itself; refused, it stays where it was, so no "now checked" is asked of it.
        await p.getByRole("radio", { name: /Tournament kitty/ }).click();
      },
    });

    await pressedAfterCompletion({
      label: "A player's Money · Start a side game",
      on: mine,
      path: "/me/money",
      heading: /^Money$/,
      // A member cannot reopen, so the app's words name who can: "Ask the Organizer to reopen it".
      said: DONE("change a skins game").replace("Reopen it", "Ask the Organizer to reopen it"),
      reopenOnBanner: false,
      press: async (p) => {
        // The game starter sits under the screen's one extender.
        const more = p.locator("summary", { hasText: /^More:/ });
        if (await more.count()) await more.first().click();
        await p.getByRole("button", { name: "Start a side game" }).click();
        const card = p.locator("section.card", { has: p.getByText("Start a side game", { exact: true }) }).first();
        await card.getByLabel("What to call it").fill(`${MARK} sweep`);
        await card.getByRole("button", { name: new RegExp(ada.name) }).click();
        await card.getByRole("button", { name: new RegExp(bram.name) }).click();
        await card.getByRole("button", { name: "Start it with 2" }).click();
      },
    });
    expect(await prisma.skinsPot.count({ where: { eventId, groupKey: `${MARK} sweep` } }), "a player's side game was started on a completed tournament").toBe(0);

    // ── THE LEDGER IS NOT BEHIND IT: still completed, a winner is named and a shared cost is added ──
    await setStatus("completed");
    await open(page, "/prizes");
    const winners = (): Locator => page.locator("div", { has: page.locator(":scope > .card-kicker", { hasText: /^Winner/ }) }).last();
    await winners().getByRole("button", { name: new RegExp(ada.name) }).click();
    await expect
      .poll(async () => (await prisma.contestEntry.findFirstOrThrow({ where: { contestId: contest.id, playerId: ada.id } })).won, {
        message: "naming a contest's winner was refused on a completed tournament (the ledger is not locked)",
      })
      .toBe(true);

    await open(mine, "/me/money");
    await mine.getByRole("button", { name: "Add an expense" }).click();
    await mine.getByLabel("What was it for?").fill(`${MARK} minibus`);
    await mine.getByLabel("Amount", { exact: true }).fill("30");
    await mine.getByRole("button", { name: "Save expense" }).click();
    await expect
      .poll(() => prisma.expense.count({ where: { eventId, description: `${MARK} minibus` } }), {
        message: "adding a shared expense was refused on a completed tournament (the ledger is not locked)",
      })
      .toBe(1);

    // ── REOPEN, as the organizer presses it, and the refused control works again ──
    await pressReopen(page);
    await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status, { message: "Reopen did not make the tournament live" }).toBe("live");
    await open(page, "/prizes");
    await expect(page.getByRole("region", { name: "Locked" }), "Prizes & payouts is still locked after Reopen").toHaveCount(0);
    await skinsCard().getByLabel(/^Buy-in/).fill("9");
    await skinsCard().getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(async () => (await prisma.skinsPot.findUniqueOrThrow({ where: { id: pot.id } })).buyInCents, { message: "the skins Save did not work again after Reopen" })
      .toBe(900);

    expect(errors, errors.join("\n")).toEqual([]);
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await sweep();
  }
});

// R8a: the same refusals on the redesigned Prizes & side games (`consoleUrl("/prizes", "build")`), deleted at R17 with the old screen.
test.describe("@redesign", () => {
  test("on a completed tournament the new screen refuses the offer in words beside the press and writes nothing; the ledger works; Reopen gives the offer back", async ({ page, context, baseURL }, testInfo) => {
    test.skip(!["desktop", "phone"].includes(testInfo.project.name), "walked at laptop and phone size");
    test.setTimeout(240_000);
    const errors: string[] = [];
    watchPageErrors(page, errors, "organizer");
    const mark = `zz-r8a-done-${testInfo.project.name}`;
    const club = await rf.makeClub(mark);
    try {
      const { event, stages, players } = await rf.makeEvent(club, "Spring Medal", {
        status: "live",
        stages: [{}],
        players: 4,
        event: { launchedAt: new Date(), moneyMode: "split" },
      });
      const cat = `${mark} Best gross`;
      await rf.prisma.prize.create({ data: { eventId: event.id, position: 1, category: cat, amount: 0 } });
      await rf.signIn(context, baseURL!, club, event.id);
      const screen = new PrizesScreen(page);
      const setStatus = (status: "live" | "completed") => rf.prisma.event.update({ where: { id: event.id }, data: { status } });
      const snapshot = async () => ({
        prizes: await rf.prisma.prize.count({ where: { eventId: event.id } }),
        mode: (await rf.prisma.event.findUniqueOrThrow({ where: { id: event.id } })).moneyMode,
      });
      const LOCK_LINE = /Locked because the tournament is completed\./;
      /** Drawn live (so the controls are offered, the money fold open), completed "in another tab", then pressed. */
      const drawnLiveThenCompleted = async () => {
        await setStatus("live");
        await screen.open(stages[0].id);
        await screen.openMoneySetup();
        await setStatus("completed");
      };
      const refusedBesidePress = async (what: string, before: Awaited<ReturnType<typeof snapshot>>) => {
        const said = page.getByText(`Locked because the tournament is completed. Reopen it on the dashboard to ${what}.`).first();
        await expect(said, `the refusal to ${what} was not said`).toBeVisible({ timeout: 20_000 });
        await expect(said, `the refusal to ${what} was said off screen`).toBeInViewport();
        await expect(page.getByRole("region", { name: "Locked" }), "the screen did not catch up with the lock").toContainText(LOCK_LINE, { timeout: 20_000 });
        expect(await snapshot(), `written while locked (${what})`).toEqual(before);
      };

      // ── a prize is added: refused ──
      await drawnLiveThenCompleted();
      let before = await snapshot();
      await page.getByLabel("Category").fill(`${mark} Long drive`);
      await page.getByLabel(/^Amount \(/).fill("10");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await refusedBesidePress("change the prizes", before);

      // ── how money is handled, pressed inside the fold: refused ──
      await drawnLiveThenCompleted();
      before = await snapshot();
      const fold = await screen.openMoneySetup();
      await fold.getByRole("radio", { name: /Tournament kitty/ }).click();
      await refusedBesidePress("change how money is handled", before);

      // ── the ledger is not behind it: a prize is awarded on the completed tournament ──
      // With Winners & money shown the winner is picked THERE (R8b); Prizes & side games draws the offer only.
      await setStatus("completed");
      await screen.open(stages[0].id);
      await expect(page.getByLabel(`Winner of ${cat}`), "the winner picker is drawn on the offer screen too").toHaveCount(0);
      const money = new MoneyScreen(page);
      await money.open(stages[0].id);
      await money.winnerOf(cat).selectOption(players[0].id);
      await expect
        .poll(async () => (await rf.prisma.prize.findFirstOrThrow({ where: { eventId: event.id, category: cat } })).winnerId, { timeout: 20_000, message: "awarding a prize was refused on a completed tournament (the ledger is not locked)" })
        .toBe(players[0].id);
      await page.reload();
      await expect(money.winnerOf(cat), "the award is not on Winners & money after a reload").toHaveValue(players[0].id);

      // ── Reopen, and the offer works again, and is kept ──
      await pressReopen(page);
      await expect.poll(async () => (await rf.prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status, { message: "Reopen did not make the tournament live" }).toBe("live");
      await screen.open(stages[0].id);
      await page.getByLabel("Category").fill(`${mark} Long drive`);
      await page.getByLabel(/^Amount \(/).fill("10");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect.poll(() => rf.prisma.prize.count({ where: { eventId: event.id } }), { timeout: 20_000, message: "adding a prize did not work again after Reopen" }).toBe(2);
      await page.reload();
      await expect(screen.amountFor(`${mark} Long drive`), "the prize is not on the new screen after a reload").toHaveValue("10");
    } finally {
      await rf.dropClub(mark);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
