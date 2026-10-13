import { test, expect } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * THE COMMITTEE STOPS PLAY, AND EVERYBODY IS TOLD (Rule 5.7).
 *
 * Lightning. The secretary presses one button, and what matters is not that
 * the button works but who finds out: the player with the app open on the 7th
 * fairway, the one who opens it a minute later, and the families watching the
 * public board. And then that all of them are told when it is safe again —
 * a suspension nobody can lift is worse than none.
 *
 * Until 2026-10-13 no browser test pressed that button. `suspendPlay`,
 * `resumePlay` and `currentPlayStatus` were three of the 184 actions the first
 * measured round found nothing performing (88 of 272 were). They had unit
 * tests of their words. Nothing had checked that the words reach a screen.
 *
 * What is done here, each step read back from somewhere other than the screen
 * that did it:
 *
 *   the secretary suspends, with a reason   → the row is stamped, and the log says who
 *   a member's OPEN screen                   → shows it without being reloaded
 *   a member who opens the app afterwards    → is told on arrival
 *   the public board, signed out             → says so too
 *   the secretary resumes                    → all three are clear, and the log says so
 *
 * And the control: before any of it, none of the three says play is suspended
 * — a banner that is always there would pass every line above.
 *
 * WHAT IT CANNOT SEE: the notification on a locked phone, and the siren. Those
 * need a real device; this is the screens.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; shareToken: string };
const ORGANIZER = join(process.cwd(), ".e2e", "organizer.json");
const PLAYER = join(process.cwd(), ".e2e", "player.json");
const REASON = "Lightning in the area";
const prisma = new PrismaClient();

/** The fixture is shared by every spec after this one: play is never left suspended, whatever happened above. */
async function playOn() {
  await prisma.event.update({ where: { id: data.eventId }, data: { playSuspendedAt: null, playSuspendedNote: "" } });
}

test.afterAll(async () => {
  await playOn();
  await prisma.$disconnect();
});

test("the secretary suspends play; an open phone, a phone opened later and the public board all say so; and resuming clears them", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  await playOn();
  const errors: string[] = [];
  const device = testInfo.project.use;

  const organizer = await browser.newContext({ ...device, baseURL, storageState: ORGANIZER });
  const member = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  const latecomer = await browser.newContext({ ...device, baseURL, storageState: PLAYER });
  const family = await browser.newContext({ ...device, baseURL, storageState: undefined });
  try {
    const console_ = await organizer.newPage();
    const open = await member.newPage();
    const board = await family.newPage();
    for (const p of [console_, open, board]) watchPageErrors(p, errors);

    const banner = (page: typeof open) => page.getByRole("alert").filter({ hasText: "Play is suspended" });
    const stop = `${REASON}. Stop now and don't play another shot until the`;

    // ── before: nobody is told anything ─────────────────────────────────────
    await open.goto(`/me?bust=${Date.now()}`);
    await open.waitForLoadState("networkidle").catch(() => {});
    await expect(open.locator("h1").first()).toBeVisible();
    await board.goto(`/live/${data.shareToken}?bust=${Date.now()}`);
    await expect(board.locator("h1").first()).toBeVisible();
    await expect(banner(open), "CONTROL: a member is told play is suspended before anybody suspended it").toHaveCount(0);
    await expect(banner(board), "CONTROL: the public board says so before anybody suspended it").toHaveCount(0);

    // ── the secretary stops play ────────────────────────────────────────────
    await console_.goto(`/dashboard?bust=${Date.now()}`);
    await console_.waitForLoadState("networkidle").catch(() => {});
    await console_.getByRole("button", { name: "Suspend play" }).click();
    await console_.getByLabel("Reason (optional)").fill(REASON);
    await console_.getByRole("button", { name: "Suspend play now" }).click();
    await expect(console_.getByRole("alert").filter({ hasText: "Play is suspended" }), "the dashboard does not say play is suspended").toBeVisible({ timeout: 20_000 });
    await expect(console_.getByRole("button", { name: "Resume play" }), "suspended, with no way back on the screen").toBeVisible();

    const stamped = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playSuspendedAt: true, playSuspendedNote: true } });
    expect(stamped.playSuspendedAt, "the tournament is not marked suspended").not.toBeNull();
    expect(stamped.playSuspendedNote).toBe(REASON);
    const logged = await prisma.auditLog.findFirst({ where: { eventId: data.eventId, action: "play-suspended" }, orderBy: { createdAt: "desc" } });
    expect(logged?.detail, "the log does not say play was suspended, or why").toBe(`Play suspended: ${REASON}`);
    expect(logged?.actor, "the log does not say who suspended play").toBeTruthy();

    // ── the member whose screen was already open: told without touching it ──
    // The screen asks every twenty seconds. Nothing here reloads it.
    await expect(banner(open), "an open player screen never noticed that play was suspended").toBeVisible({ timeout: 45_000 });
    await expect(banner(open)).toContainText(stop);

    // ── the member who opens the app afterwards, on any tab ─────────────────
    const late = await latecomer.newPage();
    watchPageErrors(late, errors);
    for (const tab of ["/me", "/me/card", "/me/board"]) {
      await late.goto(`${tab}?bust=${Date.now()}`);
      await expect(banner(late), `${tab} does not tell a member that play is suspended`).toBeVisible({ timeout: 20_000 });
      await expect(banner(late)).toContainText(stop);
    }

    // ── the public board ────────────────────────────────────────────────────
    await board.goto(`/live/${data.shareToken}?bust=${Date.now()}`);
    await expect(banner(board), "the public board does not say play is suspended").toBeVisible({ timeout: 20_000 });
    await expect(banner(board)).toContainText(REASON);

    // ── and it is lifted ────────────────────────────────────────────────────
    await console_.getByRole("button", { name: "Resume play" }).click();
    await expect(console_.getByRole("button", { name: "Suspend play" }), "after resuming, the dashboard still shows play suspended").toBeVisible({ timeout: 20_000 });
    const lifted = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playSuspendedAt: true, playSuspendedNote: true } });
    expect(lifted.playSuspendedAt, "the tournament is still marked suspended").toBeNull();
    expect(lifted.playSuspendedNote).toBe("");
    expect(
      await prisma.auditLog.count({ where: { eventId: data.eventId, action: "play-resumed", createdAt: { gte: logged!.createdAt } } }),
      "the log does not say play was resumed",
    ).toBeGreaterThan(0);

    await expect(banner(open), "an open player screen still says play is suspended after it was resumed").toHaveCount(0, { timeout: 45_000 });
    await late.goto(`/me?bust=${Date.now()}`);
    await expect(late.locator("h1").first()).toBeVisible();
    await expect(banner(late), "a member opening the app is still told play is suspended").toHaveCount(0);
    await board.goto(`/live/${data.shareToken}?bust=${Date.now()}`);
    await expect(board.locator("h1").first()).toBeVisible();
    await expect(banner(board), "the public board still says play is suspended").toHaveCount(0);

    expect(errors, "a screen threw while play was suspended or resumed").toEqual([]);
  } finally {
    await Promise.all([organizer, member, latecomer, family].map((c) => c.close()));
  }
});
