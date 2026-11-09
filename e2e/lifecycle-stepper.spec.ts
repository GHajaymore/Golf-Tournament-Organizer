import type { Page } from "@playwright/test";
import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { statusFixture, prisma } from "./status-fixture";
import { clubToday } from "../src/lib/domain/club-clock";
import { addDays } from "../src/lib/domain/round-dates";

/**
 * THE LIFECYCLE STEPPER, WALKED AS AN ORGANIZER WALKS A TWO-DAY MEDAL (B03; the panel's ruling, 9 Nov).
 *
 * Behind its switch (`?stepper=1` while it is off). A two-round medal is taken from setting up to play
 * over, and at each step the organizer opens the dashboard and reads three things that must be ONE
 * answer — the stepper's current stop (`aria-current="step"`), the status card's button, and the
 * stepper's line on another screen:
 *
 *   setting up        Launch tournament; the stepper on Launch
 *   launched          Publish the tee sheet (a link to the tee sheet); then, the sheet out, NO button —
 *                     "Round 1 tees off …"
 *   day 1             Open score entry, "Round 1 · 4 of 6 cards in" — and never Complete tournament,
 *                     which the machine offers from the first card
 *   every card in     Close Round 1, which opens that round on Rounds & formats
 *   between rounds    Round 2's tee sheet, on Round 2's stop
 *   day 2 → over      Complete tournament, on Results
 *
 * On another screen the stepper is folded to one line (48px at most), with a quiet link to where the
 * job is done — and none on the screen where it is done. At every step the page never scrolls sideways.
 *
 * ON THE CLUB'S CLOCK: the club takes `E2E_TZ` when a run sets it (Pacific/Auckland puts the club a day
 * ahead of the server for half the day), and every day here is `clubToday(zone)` — a stepper that asked
 * the server for "today" would say "tees off" on the club's day 1.
 *
 * WHAT IT CANNOT SEE: the cards are written as rows (approved), not typed — `organizer-medal.spec.ts`
 * types them; every family and stage is held to one answer by `lifecycle-track.test.ts`. Memory: one
 * context, one page, light.
 */

const ZONE = process.env.E2E_TZ || "America/New_York";

async function noSidewaysScroll(page: Page, where: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `${where} scrolls sideways`).toBeLessThanOrEqual(0);
}

/** The dashboard, previewing the stepper: its current stop and the status card's button. */
async function dashboard(page: Page) {
  await page.goto("/dashboard?stepper=1");
  const stepper = page.getByRole("region", { name: "Where this tournament is" });
  await expect(stepper).toBeVisible();
  await noSidewaysScroll(page, "the dashboard");
  return { stepper, current: stepper.locator('[aria-current="step"]') };
}

test("the stepper, the dashboard's button and the folded line agree at every step of a two-day medal", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const today = clubToday(ZONE);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "stepper",
    event: { dates: "A two-day medal", startOn: addDays(today, 1), endOn: addDays(today, 2) },
    rounds: [
      { type: "Stroke Play Round", format: "Stroke Play", playedOn: addDays(today, 1) },
      { type: "Stroke Play Round", format: "Stroke Play", playedOn: addDays(today, 2) },
    ],
  });
  const [r1, r2] = f.stageIds;
  try {
    await prisma.organization.update({ where: { id: f.orgId }, data: { timeZone: ZONE } });
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    // SETTING UP: Launch, on the Launch stop.
    let d = await dashboard(page);
    await expect(d.current).toContainText("Launch");
    await expect(d.stepper).toContainText(/Set up · \d+ of \d+ done/);
    await expect(page.getByRole("button", { name: "Launch tournament" })).toBeVisible();

    // LAUNCHED, BEFORE THE FIRST TEE: publish the tee sheet — a link, on the Tee times stop.
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "live", launchedAt: new Date(), configUnlocked: false } });
    d = await dashboard(page);
    await expect(d.current).toContainText("Tee sheet");
    await expect(page.getByRole("link", { name: /Publish the tee sheet/ }).first()).toHaveAttribute("href", "/foursomes");
    await expect(page.getByRole("button", { name: "Complete tournament" })).toHaveCount(0);

    // The sheet out: no button at all, only when it tees off.
    await prisma.stage.update({ where: { id: r1 }, data: { teeSheetPublished: true } });
    d = await dashboard(page);
    await expect(d.current).toContainText("Round 1");
    await expect(d.stepper).toContainText("Round 1 tees off");
    await expect(page.getByRole("button", { name: "Complete tournament" })).toHaveCount(0);

    // DAY 1: four of six cards in — Open score entry, never Complete.
    await prisma.stage.update({ where: { id: r1 }, data: { playedOn: today } });
    for (const playerId of f.playerIds.slice(0, 4)) {
      await prisma.scorecard.create({
        data: {
          eventId: f.eventId, stageId: r1, playerId, strokes: JSON.stringify(new Array(18).fill(4)),
          status: "approved", certifiedBy: "zz", certifiedAt: new Date(), approvedBy: "zz", approvedAt: new Date(),
        },
      });
    }
    d = await dashboard(page);
    await expect(d.current).toContainText("Round 1");
    await expect(d.stepper).toContainText("Round 1 · 4 of 6 cards in");
    await expect(page.getByRole("link", { name: /Open score entry/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete tournament" }), "Complete offered while golf is being played").toHaveCount(0);

    // Folded on another screen: one line, and a quiet link to where the job is done.
    await page.goto("/registration?stepper=1");
    const folded = page.getByRole("region", { name: "Where this tournament is" });
    await expect(folded).toContainText("Round 1 · 4 of 6 cards in");
    expect((await folded.boundingBox())!.height, "the folded stepper is taller than one line").toBeLessThanOrEqual(48);
    await expect(folded.getByRole("link", { name: /Open score entry/ })).toHaveAttribute("href", /\/entry\?stepper=1$/);
    await noSidewaysScroll(page, "Entries");
    // And on Score entry itself, where the job is done, no action.
    await page.goto("/entry?stepper=1");
    await expect(page.getByRole("region", { name: "Where this tournament is" }).getByRole("link")).toHaveCount(0);

    // EVERY CARD IN, ROUND OPEN: Close Round 1, which opens that round.
    for (const playerId of f.playerIds.slice(4)) {
      await prisma.scorecard.create({
        data: {
          eventId: f.eventId, stageId: r1, playerId, strokes: JSON.stringify(new Array(18).fill(4)),
          status: "approved", certifiedBy: "zz", certifiedAt: new Date(), approvedBy: "zz", approvedAt: new Date(),
        },
      });
    }
    d = await dashboard(page);
    await expect(d.current).toContainText("Round 1");
    await expect(page.getByRole("link", { name: /Close Round 1/ }).first()).toHaveAttribute("href", `/stages?round=${r1}`);

    // BETWEEN ROUNDS: Round 1 closed; Round 2's tee sheet, on Round 2's stop.
    await prisma.stage.update({ where: { id: r1 }, data: { closedAt: new Date() } });
    d = await dashboard(page);
    await expect(d.current).toContainText("Round 2");
    await expect(page.getByRole("link", { name: /Publish the tee sheet/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toHaveCount(0);

    // DAY 2, THEN PLAY OVER: every card in and closed — now, and only now, Complete tournament.
    await prisma.stage.update({ where: { id: r2 }, data: { playedOn: today, teeSheetPublished: true } });
    for (const playerId of f.playerIds) {
      await prisma.scorecard.create({
        data: {
          eventId: f.eventId, stageId: r2, playerId, strokes: JSON.stringify(new Array(18).fill(4)),
          status: "approved", certifiedBy: "zz", certifiedAt: new Date(), approvedBy: "zz", approvedAt: new Date(),
        },
      });
    }
    await prisma.stage.update({ where: { id: r2 }, data: { closedAt: new Date() } });
    d = await dashboard(page);
    await expect(d.current).toContainText("Results");
    await expect(d.stepper).toContainText("Every round closed · results not released");
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible();

    // Reading never changed the tournament.
    expect(await f.status()).toBe("live");
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
