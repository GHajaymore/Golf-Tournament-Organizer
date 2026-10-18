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

let was: string | null = null;
test.beforeAll(async () => {
  was = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playerAccess: true } })).playerAccess;
  await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: "both" } });
});
/** The fixture's tournament is every later spec's: how its players get in goes back as it was. */
test.afterAll(async () => {
  if (was !== null) await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: was } });
  await prisma.$disconnect();
});

test("after 'Use a different code' the box is empty, and a code typed key by key lets the player in", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const code = (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { accessCode: true } })).accessCode;
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    watchPageErrors(page, errors);
    await page.goto("/play");
    await page.waitForLoadState("networkidle").catch(() => {});
    const box = page.getByLabel("Round code");
    const back = page.getByRole("button", { name: "Use a different code" });

    await box.pressSequentially(code);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(back, "the round's code did not let the player in").toBeVisible({ timeout: 20_000 });

    await back.click();
    await expect(box, "the box still holds the code just used — the next code would be typed on to it").toHaveValue("");

    // As a thumb does: key by key, into whatever the box holds.
    await box.pressSequentially(code);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/That code isn.t valid/)).toHaveCount(0);
    await expect(back, "a code typed correctly after going back was refused").toBeVisible({ timeout: 20_000 });
  } finally {
    await ctx.close();
  }
  expect(errors, "a screen threw").toEqual([]);
});
