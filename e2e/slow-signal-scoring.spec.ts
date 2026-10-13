import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * SCORING ON ONE BAR OF SIGNAL: HOLES ENTERED FASTER THAN THEY SAVE.
 *
 * Every other spec scores next door to the server, where a save is back in
 * thirty milliseconds. On a course it takes seconds, and a player catching up
 * three holes on the next tee enters them faster than that. Until 2026-10-13
 * the second hole went up carrying the card revision from BEFORE the first,
 * arrived after it, and was answered:
 *
 *     This card changed while you were out of signal. Somebody else — usually
 *     the committee — edited this card while your phone was offline.
 *
 * Nobody had; the phone was arguing with its own previous hole, was never
 * offline, and "Use theirs" threw away the hole just entered. Measured in a
 * browser the night it was found, on a save held to two seconds: asked with
 * 0.9s and with 1.5s between holes, not with 2.5s.
 *
 * It was found from the other end. `offline.spec` had failed about once a
 * night for a year, and reading what one failure had SENT showed the test had
 * been passing on this fault: its "committee edit" changed nothing, and the
 * chooser it waited for was the phone conflicting with itself.
 *
 * So here every save is held for two seconds, and:
 *
 *   three holes, 0.3s, 0.9s and 1.5s apart   → all three stored, the rest of the
 *                                              card untouched, "Saved", and
 *                                              nobody is ever asked which card
 *                                              is right
 *   the rest of the card entered in a burst,
 *   and signed at once                       → the card is certified with all
 *                                              eighteen holes on it, and again
 *                                              nobody is asked
 *
 * WHAT IT CANNOT SEE: a card the committee really did change meanwhile. That
 * must still ask, and `offline.spec` holds it — with an edit that is an edit.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as {
  partialCard: { stageId: string; playerId: string; strokes: (number | null)[] };
};
const { stageId, playerId } = data.partialCard;
const prisma = new PrismaClient();

test.use({ storageState: join(process.cwd(), ".e2e", "player.json") });
test.describe.configure({ mode: "serial" });

const stored = async () => {
  const card = await prisma.scorecard.findFirst({ where: { stageId, playerId }, select: { strokes: true, status: true } });
  return { strokes: card ? (JSON.parse(card.strokes) as (number | null)[]) : [], status: card?.status ?? "" };
};
/** The fixture's card is every later spec's: it goes back as it was. */
const putBack = () =>
  prisma.scorecard.updateMany({
    where: { stageId, playerId },
    data: { strokes: JSON.stringify(data.partialCard.strokes), status: "entered", certifiedBy: "", certifiedAt: null },
  });
test.beforeAll(putBack);
test.afterAll(async () => {
  await putBack();
  await prisma.$disconnect();
});

/** Every save from this page takes two seconds to leave, as it does on a course. */
async function onOneBar(page: Page) {
  await page.route("**/me/card**", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
  });
}

/** Watches for the chooser for as long as the test runs: it must never be on screen, not even for a moment. */
function neverAsked(page: Page) {
  let asked = false;
  let watching = true;
  const watch = (async () => {
    while (watching) {
      if (await page.getByRole("alertdialog").count().catch(() => 0)) asked = true;
      await page.waitForTimeout(150).catch(() => {});
    }
  })();
  return async () => {
    watching = false;
    await watch;
    return asked;
  };
}

async function openCard(page: Page) {
  await page.goto(`/me/card?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Hole", { exact: true })).toBeVisible();
}

/** Enter par on one hole, by its number. */
async function par(page: Page, hole: number) {
  await page.locator(".hole-nav-btn").nth(hole - 1).click();
  await page.getByRole("button", { name: /Par$/ }).first().click();
}

test("three holes entered faster than they save are all kept, and nobody is asked which card is right", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const before = await stored();
  const empty = before.strokes.map((s, i) => (s == null ? i + 1 : 0)).filter(Boolean);
  expect(empty.length, "the fixture's card has fewer than three holes left to enter").toBeGreaterThanOrEqual(3);
  const [a, b, c] = empty;

  await onOneBar(page);
  await openCard(page);
  const asked = neverAsked(page);

  await par(page, a);
  await page.waitForTimeout(300);
  await par(page, b);
  await page.waitForTimeout(900);
  await par(page, c);
  await page.waitForTimeout(1_500);

  const filled = before.strokes.filter((s) => s != null).length + 3;
  // Two saves of two seconds each is all three holes need: the first hole's, and one for whatever is
  // newest when that comes back. Twelve seconds is generous for that and far short of the retry
  // timer, so holes that only reach the server when the timer next comes round do not pass here.
  await expect(page.locator('[role="status"]').first(), "the three holes were not saved promptly").toContainText(`Saved — ${filled} of`, { timeout: 12_000 });
  // The last save has had time to be answered, wrongly or rightly.
  await page.waitForTimeout(2_500);
  expect(await asked(), "a player who only entered three holes quickly was asked which card is right").toBe(false);

  const after = await stored();
  for (const hole of [a, b, c]) expect(after.strokes[hole - 1], `hole ${hole} was entered and is not stored`).not.toBeNull();
  const untouched = (card: (number | null)[]) => card.map((s, i) => ([a, b, c].includes(i + 1) ? "·" : s));
  expect(untouched(after.strokes), "a hole nobody touched changed").toEqual(untouched(before.strokes));
  expect(errors, "the card threw").toEqual([]);
});

test("the rest of the card entered in a burst and signed at once is certified, with every hole on it", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const before = await stored();
  const empty = before.strokes.map((s, i) => (s == null ? i + 1 : 0)).filter(Boolean);
  expect(empty.length, "CONTROL: there is nothing left to enter, so nothing is on its way when the card is signed").toBeGreaterThan(0);

  await onOneBar(page);
  await openCard(page);
  const asked = neverAsked(page);

  for (const hole of empty) {
    await par(page, hole);
    await page.waitForTimeout(250);
  }
  // Signed in the same breath as the last hole: its save has not come back, and may not have left.
  const sign = page.getByRole("button", { name: "Certify my card" });
  await expect(sign, "a complete card cannot be signed").toBeEnabled({ timeout: 10_000 });
  await sign.click();

  await expect.poll(async () => (await stored()).status, { timeout: 60_000, message: "the card was not certified" }).toBe("certified");
  await page.waitForTimeout(2_500);
  expect(await asked(), "a player signing their own card was told somebody else had edited it").toBe(false);
  const after = await stored();
  expect(after.strokes.filter((s) => s == null), "the certified card is missing a hole that was entered").toEqual([]);
  expect(after.status, "a late save took the signature back off").toBe("certified");
  await expect(page.getByRole("button", { name: "Certified" }), "the screen does not say the card is certified").toBeVisible();
  expect(errors, "the card threw").toEqual([]);
});
