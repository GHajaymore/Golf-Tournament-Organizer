import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8"));

test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });

/**
 * Put the card back afterwards.
 *
 * These tests enter a hole, and the whole point of the feature is that the
 * hole eventually reaches the server — so this spec MUTATES the shared
 * fixture, once per test per viewport. `player.spec` asserts that card's exact
 * shape ("nine of eighteen holes in"), and nine runs of this file quietly took
 * it to eighteen and turned three of its tests red.
 *
 * Restoring here rather than making the other spec tolerate a moving fixture:
 * a test suite where every assertion has to be written around the damage some
 * other file does is one nobody can reason about.
 */
test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    const { stageId, playerId, strokes } = data.partialCard;
    await prisma.scorecard.updateMany({
      where: { stageId, playerId },
      data: { strokes: JSON.stringify(strokes), status: "entered" },
    });
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * A hole entered with no signal must not be lost.
 *
 * The scoring screen wrote on a debounce and kept the strokes nowhere but
 * React state. A scorer behind the 12th with no signal, who then locked their
 * phone or let the tab be evicted, LOST the holes they had entered — and the
 * screen went on showing them, so they had no reason to re-enter anything.
 *
 * That is the worst failure this app can have. A wrong number is correctable
 * by anybody who was there; a hole nobody recorded is gone, and the player
 * finds out at the scorer's table.
 *
 * These run with the network genuinely cut at the browser, not with a mocked
 * fetch — because the thing under test is what the DEVICE keeps when a request
 * cannot leave it, and a stubbed failure would not exercise that at all.
 */

test("a hole entered with no signal is kept on the phone", async ({ page, context }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Hole", { exact: true })).toBeVisible();

  await context.setOffline(true);

  const before = await page.locator('[aria-label*=", complete"]').count();
  await page.getByRole("button", { name: /^4Par$|Par$/ }).first().click();
  await expect(page.locator('[aria-label*=", complete"]')).toHaveCount(before + 1);

  // THE ASSERTION THAT MATTERS: the strokes are on the device, not merely in
  // memory. Reading localStorage is the point — a hole that exists only in a
  // React ref dies with the tab.
  const stored = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) =>
      k.startsWith("tourneyhq:pending-card:"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  expect(stored, "the card was not written to the device").not.toBeNull();
  expect(JSON.parse(stored!).some((n: number | null) => n != null)).toBe(true);

  /**
   * Back online, and WAIT for the hole to land before this test is over.
   *
   * This used to stop at `setOffline(false)`, which starts the replay and does
   * not wait for it. The write was still in flight when the NEXT test loaded
   * the card: that test read the revision as it stood, this one's write landed
   * a moment later, and the next queued card was refused — "This card also
   * changed elsewhere — choose which to keep."
   *
   * Which was true. A queued card is written whole and the server is right to
   * refuse one built on a revision that has moved; the fault was this line
   * leaving a write in flight across a test boundary. It showed up as a
   * timeout on `/saved/i` in the test after this one, on whichever of the three
   * viewports lost the race, so it read as flake rather than as this.
   *
   * The `online` event is dispatched rather than assumed: the drain is what is
   * being waited for, so it has to be provoked deterministically and not left
   * to whether the browser happened to fire one.
   */
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          Object.keys(window.localStorage).filter((k) =>
            k.startsWith("tourneyhq:pending-card:"),
          ).length,
        ),
      { timeout: 20_000 },
    )
    .toBe(0);
});

test("it tells the scorer the truth: kept, not failed", async ({ page, context }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await page.getByRole("button", { name: /^4Par$|Par$/ }).first().click();

  /**
   * The old wording was "Not saved… check your signal and tap a hole again",
   * which is now false in the case that matters most. A scorer told that
   * stands on a tee hunting for a bar of signal instead of playing their shot.
   */
  const status = page.locator('[role="status"]');
  await expect(status).toContainText(/no signal/i, { timeout: 10_000 });
  await expect(status).toContainText(/saved on this phone/i);
  await expect(status).not.toContainText(/not saved/i);

  await context.setOffline(false);
});

test("and sends it by itself when the signal comes back", async ({ page, context }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await page.getByRole("button", { name: /^4Par$|Par$/ }).first().click();
  await expect(page.locator('[role="status"]')).toContainText(/no signal/i, { timeout: 10_000 });

  // Coming back into coverage must not need a tap. A scorer who has walked to
  // the next tee is not looking at the phone, and a queue that waits for
  // attention is a queue that never drains.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.locator('[role="status"]')).toContainText(/saved/i, { timeout: 20_000 });

  // And the device copy is released only once the server has it — until then
  // there would be a moment where neither side holds the scorer's holes.
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          Object.keys(window.localStorage).filter((k) =>
            k.startsWith("tourneyhq:pending-card:"),
          ).length,
        ),
      { timeout: 20_000 },
    )
    .toBe(0);
});

/**
 * The other half of scoring offline: the card can have MOVED while you were gone.
 *
 * A queued card is written whole, so replaying it replaces everything stored —
 * including a correction the committee made in the meantime. Nobody would see
 * it happen. The rule itself is asserted against real rows in
 * `card-conflict.audit.test.ts`; what these two prove is that the choice
 * actually reaches the person holding the phone, which is the only place it
 * can be made.
 */

/** Edit the stored card behind the browser, the way an organizer would. */
async function committeeEdits(index: number, to: number) {
  const prisma = new PrismaClient();
  try {
    const { stageId, playerId, strokes } = data.partialCard;
    const next = [...strokes];
    next[index] = to;
    await prisma.scorecard.updateMany({
      where: { stageId, playerId },
      data: { strokes: JSON.stringify(next) },
    });
  } finally {
    await prisma.$disconnect();
  }
}

test("a card changed while you were offline asks instead of overwriting", async ({ page, context }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Hole", { exact: true })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: /^4Par$|Par$/ }).first().click();
  await expect(page.locator('[role="status"]')).toContainText(/no signal/i, { timeout: 10_000 });

  // While the phone is out of coverage, the committee corrects the 1st.
  await committeeEdits(0, 9);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // The queued write must NOT land. A person is asked which card is right.
  const chooser = page.getByRole("alertdialog");
  await expect(chooser).toBeVisible({ timeout: 20_000 });
  await expect(chooser).toContainText(/changed while you were out of signal/i);
  await expect(chooser.getByRole("button", { name: /use theirs/i })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /keep mine/i })).toBeVisible();

  // And it shows the hole in dispute rather than all eighteen — a decision
  // nobody can make by scanning two full rows on a phone.
  await expect(chooser).toContainText("9");
});

test("taking their card clears the queue without sending anything", async ({ page, context }) => {
  await page.goto("/me/card");
  await page.waitForLoadState("networkidle");

  await context.setOffline(true);
  await page.getByRole("button", { name: /^4Par$|Par$/ }).first().click();
  await expect(page.locator('[role="status"]')).toContainText(/no signal/i, { timeout: 10_000 });

  await committeeEdits(0, 9);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  const chooser = page.getByRole("alertdialog");
  await expect(chooser).toBeVisible({ timeout: 20_000 });
  await chooser.getByRole("button", { name: /use theirs/i }).click();

  // The disagreement is over, so the chooser goes.
  await expect(chooser).toBeHidden();

  // The device copy is released. Leaving it would resurrect the discarded card
  // on the next reload — the scorer would be asked the same question forever.
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          Object.keys(window.localStorage).filter((k) =>
            k.startsWith("tourneyhq:pending-card:"),
          ).length,
        ),
      { timeout: 20_000 },
    )
    .toBe(0);
});
