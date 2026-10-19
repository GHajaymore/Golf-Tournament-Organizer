import { test, expect, type Browser } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A ROUND CODE THAT HAS TRAVELLED IS REISSUED — AND THE OLD ONE STOPS WORKING.
 *
 * A round code is the whole of a player's way in where a tournament uses them:
 * eight characters, read out on the first tee, and anybody holding it can
 * report a score for that round. The screen that shows it says what to do when
 * it gets out — "reissue it if it travels beyond the field". `regenerateRoundCode`
 * was performed by no browser test (round 1 on the frozen app, 2026-10-13), so
 * nothing had checked the half that matters: that the OLD code is dead.
 *
 *   the round's code is typed at the door       → let in: shown the field to pick a name from
 *   the organizer reissues it                   → a different code is on the
 *                                                  organizer's screen
 *   the OLD code is typed at the door           → refused, in words
 *   the NEW code is typed                       → let in
 *
 * WHAT IT CANNOT SEE: somebody already inside on the old code. They keep the
 * card they are on; reissuing closes the door, it does not empty the room.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string; partialCard: { stageId: string } };
const stageId = data.partialCard.stageId;
const prisma = new PrismaClient();
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

/** What the fixture held before this spec touched it — null until it has been read, so a setup that fails restores nothing. */
let was: { how: string; accessCode: string } | null = null;
test.beforeAll(async () => {
  const how = (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { playerAccess: true } })).playerAccess;
  const accessCode = (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { accessCode: true } })).accessCode;
  was = { how, accessCode };
  // A tournament that takes players by code as well as by sign-in.
  await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: "both" } });
});
/** The fixture's tournament is every later spec's: how its players get in, and the round's code, go back as they were. */
test.afterAll(async () => {
  if (was) {
    await prisma.stage.update({ where: { id: stageId }, data: { accessCode: was.accessCode } });
    await prisma.event.update({ where: { id: data.eventId }, data: { playerAccess: was.how } });
  }
  await prisma.$disconnect();
});

const code = async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { accessCode: true } })).accessCode;

/** Somebody at the door with a code, in a browser of their own: "in", or the words they were refused with. */
async function atTheDoor(browser: Browser, baseURL: string, typed: string, somebody: string): Promise<string> {
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const page = await ctx.newPage();
    await page.goto("/play");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel("Round code").fill(typed);
    await page.getByRole("button", { name: "Continue" }).click();
    // Let in is being shown the field to pick your own name from. (A search box sits over it only for a long field.)
    const inside = page.getByRole("button", { name: somebody });
    const refused = page.getByText(/That code isn.t valid|doesn.t look like a round code/);
    await expect(inside.or(refused).first(), `a code was neither taken nor refused: ${typed}`).toBeVisible({ timeout: 20_000 });
    return (await inside.count()) ? "in" : (await refused.first().innerText()).trim();
  } finally {
    await ctx.close();
  }
}

test("a round code is reissued, the old one is refused at the door and the new one is let in", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const codes = async () => {
    await page.goto(`/event?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const table = page.locator("div", { has: page.locator(".card-title", { hasText: /^Round Codes$/ }) }).last();
    await expect(table, "a tournament that uses round codes does not show them to its organizer").toBeVisible();
    return table;
  };

  // ── a code to start from ────────────────────────────────────────────────
  let table = await codes();
  if (!(await code())) {
    await table.getByRole("button", { name: "Reissue" }).first().click();
    await table.getByRole("button", { name: "Make a code" }).first().click();
    await expect.poll(code, { timeout: 20_000, message: "the round was not given a code" }).not.toBe("");
  }
  const old = await code();
  expect(old, "the round's code is not eight characters").toMatch(/^[A-Z0-9]{8}$/);
  const somebody = (await prisma.player.findFirstOrThrow({ where: { eventId: data.eventId, status: "confirmed" }, orderBy: { name: "asc" }, select: { name: true } })).name;
  expect(await atTheDoor(browser, baseURL!, old, somebody), "CONTROL: the round's own code is not taken at the door").toBe("in");

  // ── reissued ────────────────────────────────────────────────────────────
  table = await codes();
  // ASKED FIRST: one tap arms it and says who will be refused; nothing has
  // changed until the second (the cup's UI review, 2026-10-17).
  const oldShown = `${old.slice(0, 4)}-${old.slice(4)}`;
  await table.getByRole("button", { name: "Reissue" }).first().click();
  await expect(table.getByText(`Players holding ${oldShown} will be refused, and its printed signs stop working.`)).toBeVisible();
  expect(await code(), "one tap on Reissue changed the code without asking").toBe(old);
  await table.getByRole("button", { name: `Stop ${oldShown}` }).click();
  await expect.poll(code, { timeout: 20_000, message: "reissuing did not change the code" }).not.toBe(old);
  const fresh = await code();
  expect(fresh).toMatch(/^[A-Z0-9]{8}$/);
  table = await codes();
  await expect(table, "the organizer's screen does not show the new code").toContainText(`${fresh.slice(0, 4)}-${fresh.slice(4)}`);
  await expect(table, "the organizer's screen still shows the old code").not.toContainText(`${old.slice(0, 4)}-${old.slice(4)}`);

  // ── the old one is dead, the new one works ──────────────────────────────
  expect(await atTheDoor(browser, baseURL!, old, somebody), "a code that was reissued still lets somebody in").toMatch(/That code isn.t valid/);
  expect(await atTheDoor(browser, baseURL!, fresh, somebody), "the reissued code is not taken at the door").toBe("in");

  expect(errors, "a screen threw").toEqual([]);
});
