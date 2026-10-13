import { test, expect } from "./coverage";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * A NAMED SIDE BET THAT IS NOT SKINS, FROM START TO GONE (2026-10-11).
 *
 * "Start a side bet" makes a birdie pot among whoever is picked, under a name
 * they choose. Until 2026-10-10 it could be started and then had no screen: it
 * was stored under its name, and both screens that list side games read only
 * the field's own. So it could not be re-priced, could not be taken off, and a
 * player who asked to join stayed pending for good.
 *
 * The fix was proven by render tests. This is the organizer doing it on the
 * real screen, and each step is read back from the row rather than from the
 * page that just wrote it:
 *
 *   start it with three   -> one game under that name, three stakes
 *   reopen the screen     -> it has a card of its own
 *   re-price it           -> the row carries the new stake
 *   take it off           -> REFUSED while anybody has paid in (the control:
 *                            a removal that always works proves nothing
 *                            about the one rule this button has)
 *   take the three out    -> then it goes, and the card with it
 */

const sign = (v: string) =>
  `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

const NAME = "zz Back bar birdies";

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;
const prisma = new PrismaClient();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  club = await seed();
});

test.afterAll(async () => {
  await teardown();
  await prisma.$disconnect();
});

test("the organizer starts a named birdie pot, re-prices it, and takes it off", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one walk of the flow; the screen's phone layout is layout.spec's");
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors, "named side bet");

  const medal = club.events.find((e) => e.slug === "medal");
  expect(medal, "the seeded club lost its live medal").toBeTruthy();
  await context.addCookies([
    { name: "ng_session", value: club.organizer.session, url: baseURL! },
    { name: "ng_active_event", value: sign(medal!.id), url: baseURL! },
  ]);

  const games = () =>
    prisma.sideGame.findMany({
      where: { eventId: medal!.id, groupKey: NAME },
      include: { entrants: true },
    });
  const open = async () => {
    // The screen redraws itself after a save, and that redraw is a navigation of its own. Chromium lets a
    // new address overtake it; Firefox and Safari's engine refuse the newcomer ("NS_BINDING_ABORTED",
    // "interrupted by another navigation") — found the first time this ran on either, 2026-10-13. A person
    // is not in this race: they cannot type an address while a save is still landing. So the spec lets
    // the redraw finish, and asks again if it was still beaten to it.
    await page.waitForLoadState("networkidle").catch(() => {});
    for (let attempt = 1; ; attempt++) {
      try {
        await page.goto(`/group-games?bust=${Date.now()}`);
        break;
      } catch (e) {
        if (attempt >= 3 || !/NS_BINDING_ABORTED|interrupted by another navigation/.test(String(e))) throw e;
        await page.waitForLoadState("load").catch(() => {});
      }
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(new URL(page.url()).pathname, "sent away from Group games — not signed in?").toBe("/group-games");
  };

  // CONTROL: nothing under that name before the walk starts.
  expect(await games()).toHaveLength(0);

  // ── start it with three ────────────────────────────────────────────────
  await open();
  await page.getByRole("button", { name: "Start a side bet" }).click();
  const form = page.locator("section.card", { has: page.locator(".card-title", { hasText: "Start a side bet" }) });
  await form.getByRole("button", { name: "Birdie pot", exact: true }).click();
  await form.getByPlaceholder("Saturday sweep").fill(NAME);
  await form.locator("#side-bet-buyin").fill("5");
  const people = form.locator("button.touch-target[aria-pressed]:not(.btn)");
  expect(await people.count(), "nobody to pick for a side bet on a live medal").toBeGreaterThanOrEqual(3);
  for (let i = 0; i < 3; i++) await people.nth(i).click();
  await form.getByRole("button", { name: "Start it with 3" }).click();

  await expect.poll(async () => (await games()).length, { message: "the bet was never stored" }).toBe(1);
  // The game is stored and then its three stakes: wait for the stakes, not
  // for the row. Reading the instant the row appeared found none of them once.
  await expect
    .poll(async () => (await games())[0]?.entrants.filter((e) => !e.excluded).length, { message: "the three picked were never put in the pot" })
    .toBe(3);
  let [game] = await games();
  expect(game.kind).toBe("birdies");
  expect(game.buyInCents).toBe(500);

  // ── it has a card of its own ───────────────────────────────────────────
  await open();
  const card = page.locator("section.card, div.card", {
    has: page.locator(".card-title", { hasText: `${NAME} — side bet` }),
  });
  await expect(card, "a named bet that is not skins has no card on Group games").toHaveCount(1);
  await expect(card).toContainText("Birdie pot");
  await expect(card).toContainText("In the pot (3)");

  // ── re-price it ────────────────────────────────────────────────────────
  const stake = card.getByLabel("Stake");
  await expect(stake).toHaveValue(/^5(\.00)?$/);
  await stake.fill("7");
  await stake.blur();
  await expect.poll(async () => (await games())[0]?.buyInCents, { message: "the new stake never reached the row" }).toBe(700);
  // And not as a second game beside the first — the field's own birdie pot is
  // keyed on the empty name, which is where a save that dropped the name lands.
  expect(await games()).toHaveLength(1);
  expect(
    await prisma.sideGame.count({ where: { eventId: medal!.id, stageId: game.stageId, kind: "birdies", groupKey: "" } }),
    "the re-price was filed as the whole field's birdie pot",
  ).toBe(0);

  // ── taking it off is refused while anybody has paid in ─────────────────
  await open();
  await card.getByTitle("Take Birdie pot off this round").click();
  await card.getByRole("button", { name: "Take it off" }).click();
  await expect(card).toContainText("3 players have paid into this one");
  expect(await games(), "a pot with three stakes in it was deleted").toHaveLength(1);

  // ── take the three out, and then it goes ───────────────────────────────
  for (let i = 0; i < 3; i++) {
    const inPot = card.locator('button.touch-target[aria-pressed="true"]:not(.btn)');
    const ticked = await inPot.count();
    await inPot.first().click();
    await expect
      .poll(async () => (await games())[0]?.entrants.filter((e) => e.confirmed && !e.excluded).length, {
        message: "a player taken out of the pot is still staked in it",
      })
      .toBe(2 - i);
    // And the SCREEN has caught up, before the next tap. The row is saved a
    // moment before the chip is redrawn; on WebKit that moment is long enough
    // for "the first ticked chip" to still be the one just un-ticked, and the
    // next tap put the same player straight back in (2026-10-11). A person
    // taps what they can see; so does this.
    await expect(inPot, "the chip just un-ticked still reads as ticked").toHaveCount(ticked - 1);
  }
  await open();
  await card.getByTitle("Take Birdie pot off this round").click();
  await card.getByRole("button", { name: "Take it off" }).click();
  await expect.poll(async () => (await games()).length, { message: "an empty pot could not be taken off" }).toBe(0);
  await open();
  await expect(page.locator(".card-title", { hasText: `${NAME} — side bet` })).toHaveCount(0);

  [game] = await games();
  expect(game).toBeUndefined();
  expect(errors, "the screen threw in the browser").toEqual([]);
});
