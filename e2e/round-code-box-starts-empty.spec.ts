import { test, expect } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * "USE A DIFFERENT CODE" STARTS FROM AN EMPTY BOX.
 *
 * Found the night before the first real cup (2026-10-17), on the live site:
 * a scorer types one nine's code, sees that round's names, presses "Use a
 * different code" to type the other nine's — and the box still holds the first
 * code. A phone puts the cursor at the end, so the second code is typed ON TO
 * it ("RAE948RW-6J9B-QR7Z") and the player is told "That code isn't valid" for
 * a code they typed correctly. No spec pressed that button.
 *
 * So this types a code, goes back, and types the code again KEY BY KEY, as a
 * thumb does (`pressSequentially`, never `fill`, which would replace the box
 * and hide the fault). It must be let in the second time.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; partialCard: { stageId: string } };
const stageId = data.partialCard.stageId;
const prisma = new PrismaClient();

/**
 * A code of the spec's own, in the round-code alphabet (`code-format.ts`) and
 * marked ZZ. The fixture's round has no code until somebody opens its
 * tournament as an organizer — the first draft read that empty code, typed
 * nothing, and waited for ever on a grey Continue.
 */
const CODE = "ZZBX2346";
let was: { how: string; code: string } | null = null;
test.beforeAll(async () => {
  const how = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playerAccess: true } })).playerAccess;
  const code = (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { accessCode: true } })).accessCode;
  was = { how, code };
  await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: "both" } });
  await prisma.stage.update({ where: { id: stageId }, data: { accessCode: CODE } });
});
/** The fixture's tournament is every later spec's: how its players get in, and the round's code, go back as they were. */
test.afterAll(async () => {
  if (was) {
    await prisma.stage.update({ where: { id: stageId }, data: { accessCode: was.code } });
    await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: was.how } });
  }
  await prisma.$disconnect();
});

test("after 'Use a different code' the box is empty, and a code typed key by key lets the player in", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const code = `${CODE.slice(0, 4)}-${CODE.slice(4)}`;
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const errors: string[] = [];
  const page = await ctx.newPage();
  try {
    watchPageErrors(page, errors);
    await page.goto("/play");
    await page.waitForLoadState("networkidle").catch(() => {});
    const box = page.locator("main input").first();
    const back = page.getByRole("button", { name: "Use a different code" });
    await expect(box, "the code screen has no box to type a code into").toBeVisible({ timeout: 20_000 });

    await box.pressSequentially(code, { delay: 30 });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(back, "the round's code did not let the player in").toBeVisible({ timeout: 20_000 });

    await back.click();
    await expect(box, "the box still holds the code just used — the next code would be typed on to it").toHaveValue("", { timeout: 10_000 });

    // As a thumb does: key by key, into whatever the box holds.
    await box.pressSequentially(code, { delay: 30 });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(back, "a code typed correctly after going back was refused").toBeVisible({ timeout: 20_000 });
  } catch (err) {
    // Say what the screen showed when it failed, in the error itself — a
    // summary that keeps one line keeps this one.
    const shown = await page.locator("main").innerText().catch(() => "(no page)");
    const typed = await page.locator("main input").first().inputValue().catch(() => "(no box)");
    throw new Error(`${(err as Error).message.split("\n")[0]} | box: "${typed}" | screen: ${shown.replace(/\s+/g, " ").slice(0, 300)}`);
  } finally {
    // Never let closing hide what failed: a timed-out test has already closed it.
    await ctx.close().catch(() => {});
  }
  expect(errors, "a screen threw").toEqual([]);
});
