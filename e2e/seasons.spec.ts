import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { watchPageErrors } from "./page-errors";

/**
 * A SEASON: STARTED, GIVEN ITS RULES, GIVEN A TOURNAMENT, FINISHED, REOPENED —
 * AND THEN A SECOND ONE BESIDE IT.
 *
 * An order of merit is the thing a club keeps longest: one table across a
 * winter of rounds. `createSeries`, `updateSeries`, `setEventSeries` and
 * `deleteSeries` were performed by no browser test (round 1 on the frozen app,
 * 2026-10-13) — the season screen was opened by every walk and never used.
 * Using it found three things on the first read:
 *
 *   - A CLUB COULD HAVE ONE SEASON, EVER. "Start a season" was drawn only
 *     while the club had none. The screen had a list for choosing between
 *     seasons and "(finished)" beside the old ones; nothing could make the
 *     second without deleting the first.
 *   - THE RULES BOXES BELONGED TO WHICHEVER SEASON WAS DRAWN FIRST. Start a
 *     season, open "Scoring & rules" without reloading, and the points box was
 *     empty; with two seasons, the second showed the first's rules and Save
 *     wrote them onto it.
 *   - AN EMPTY POINTS BOX WAS STORED AS NO TABLE, which the standings scored
 *     as the default table and the sentence above them read as " points".
 *
 * So the season is used the way a secretary would, without one reload they
 * would not make, and after each press the screen and the stored season are
 * both read:
 *
 *   no name                             → nothing to press (the control)
 *   "Winter League" started             → on screen, default points, no rounds
 *   rules opened straight away          → the boxes hold THIS season's rules
 *   best 3, 2 to qualify, saved         → stored; the points are still the
 *                                          default table, and the sentence says so
 *   points "50, thirty"                 → refused in words, nothing stored
 *   the name corrected                  → stored, and on screen
 *   this tournament added               → in the season; said to be waiting to
 *                                          finish, or counted, as it is
 *   the season marked finished          → a tournament taken out cannot be put
 *                                          back until it is reopened
 *   a second season started             → both exist; the new one opens with ITS
 *                                          rules, not the first's
 *   back to the first                   → its rules, not the second's; and the
 *                                          tournament button names where it is
 *   the second deleted — asked first    → gone; the first is untouched
 *
 * WHAT IT CANNOT SEE: the points themselves. `series.test.ts` holds what a
 * finishing position is worth, ties and best-of included, against worked
 * examples; this is about whether the season a club set up is the one kept.
 */

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8")) as { eventId: string };
const MARK = "zz-season";
const FIRST = `${MARK} Winter Leage`;
const FIRST_FIXED = `${MARK} Winter League`;
const SECOND = `${MARK} Summer Series`;
const DEFAULT_HEAD = "100, 80, 65";
const prisma = new PrismaClient();
test.use({ storageState: join(process.cwd(), ".e2e", "organizer.json") });

let clubId = "";
let was: { seriesId: string | null; tier: string | null } | null = null;
const sweep = () => prisma.series.deleteMany({ where: { organizationId: clubId, name: { startsWith: MARK } } });
test.beforeAll(async () => {
  const home = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { organizationId: true, seriesId: true } });
  clubId = home.organizationId!;
  const paid = await prisma.subscription.findUnique({ where: { organizationId: clubId }, select: { plan: true } });
  was = { seriesId: home.seriesId, tier: paid?.plan ?? null };
  // The season table comes with Birdie and above, and the fixture's club has no plan at all, which
  // is the free one: it is a Birdie club for as long as this takes. (`season-gate.audit.test.ts`
  // holds the lock itself.)
  await prisma.subscription.upsert({ where: { organizationId: clubId }, update: { plan: "society" }, create: { organizationId: clubId, plan: "society" } });
  await sweep();
});
/** The fixture's club and tournament are every later spec's: the plan and the season go back as they were. */
test.afterAll(async () => {
  if (clubId) await sweep();
  if (was) await prisma.event.update({ where: { id: data.eventId }, data: { seriesId: was.seriesId } });
  if (was?.tier) await prisma.subscription.update({ where: { organizationId: clubId }, data: { plan: was.tier } });
  else if (was) await prisma.subscription.deleteMany({ where: { organizationId: clubId } });
  await prisma.$disconnect();
});

const season = (name: string) => prisma.series.findFirst({ where: { organizationId: clubId, name } });
const mine = () => prisma.series.findMany({ where: { organizationId: clubId, name: { startsWith: MARK } }, orderBy: { createdAt: "asc" } });
const inSeason = async () => (await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { seriesId: true } })).seriesId;

/** How far the page scrolls sideways, and every control that reaches past the edge of the screen. */
const offTheSide = (page: Page) =>
  page.evaluate(() => {
    const over = [...document.querySelectorAll("main input, main button, main select")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
    });
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, controls: over.map((el) => (el.textContent || el.id || el.tagName).trim().slice(0, 40)) };
  });

/** The four boxes in "Scoring & rules", as they stand on the screen. */
const boxes = async (page: Page) => ({
  name: await page.locator("#season-name").inputValue(),
  points: await page.locator("#season-points").inputValue(),
  bestOf: await page.locator("#season-best-of").inputValue(),
  toQualify: await page.locator("#season-min-rounds").inputValue(),
});

test("a season is started, ruled, given a tournament, finished and reopened — and a second season keeps its own rules beside it", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const others = await prisma.series.count({ where: { organizationId: clubId } });
  test.skip(others > 0, "the fixture's club already holds a season, so the first-season door cannot be walked");

  await page.goto(`/series?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const main = page.locator("main");
  await expect(main, "the club is not offered its first season").toContainText("No seasons yet");

  // ── no name: nothing to press ─────────────────────────────────────────────
  const start = page.getByRole("button", { name: "Start a season" });
  await expect(start, "CONTROL: a season with no name can be started").toBeDisabled();

  // ── started ───────────────────────────────────────────────────────────────
  await page.getByLabel("Season name").fill(FIRST);
  await start.click();
  await expect.poll(async () => (await season(FIRST))?.id ?? "", { timeout: 20_000, message: "the season was not stored" }).not.toBe("");
  const first = (await season(FIRST))!;
  await expect(main.locator(".card-title", { hasText: FIRST }), "the new season is not on the screen").toBeVisible({ timeout: 20_000 });
  await expect(main, "a new season does not say what its points are").toContainText(`${DEFAULT_HEAD}… down to 8 for 20th`);
  await expect(main).toContainText("0 of 0 rounds counted");

  // ── the rules, opened without a reload: this season's ─────────────────────
  await page.getByRole("button", { name: "Scoring & rules" }).click();
  expect(await boxes(page), "the rules boxes do not hold the season that was just started").toMatchObject({ name: FIRST, bestOf: "0", toQualify: "0" });
  expect((await boxes(page)).points.startsWith(DEFAULT_HEAD), `the points box does not show the season's table: "${(await boxes(page)).points}"`).toBe(true);

  // ── best 3, two to qualify ────────────────────────────────────────────────
  await page.locator("#season-best-of").fill("3");
  await page.locator("#season-min-rounds").fill("2");
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect.poll(async () => { const s = await season(FIRST); return [s?.bestOf, s?.minEvents]; }, { timeout: 20_000, message: "the rules were not stored" }).toEqual([3, 2]);
  expect(JSON.parse((await season(FIRST))!.pointsTable).slice(0, 3), "saving two other rules changed the points table").toEqual([100, 80, 65]);
  await expect(main, "the sentence above the table does not say the rules that were saved").toContainText(`${DEFAULT_HEAD}… down to 8 for 20th · best 3 rounds count · 2 rounds to qualify`);

  // ── points that are not numbers: refused, in words ────────────────────────
  await page.locator("#season-points").fill("50, thirty");
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(main.getByText("Points must be numbers, like 100, 80, 65."), "points that are not numbers are not refused in words").toBeVisible({ timeout: 20_000 });
  expect(JSON.parse((await season(FIRST))!.pointsTable).slice(0, 3), "a refused points table was stored").toEqual([100, 80, 65]);

  // ── an empty points box is the default table, and is stored as one ────────
  await page.locator("#season-points").fill("");
  await page.locator("#season-name").fill(FIRST_FIXED);
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect.poll(async () => (await season(FIRST_FIXED))?.id ?? "", { timeout: 20_000, message: "the corrected name was not stored" }).toBe(first.id);
  expect(JSON.parse((await season(FIRST_FIXED))!.pointsTable).length, "an empty points box was stored as no table at all").toBe(20);
  await expect(main.locator(".card-title", { hasText: FIRST_FIXED }), "the corrected name is not on the screen").toBeVisible({ timeout: 20_000 });
  await expect(main, "the sentence does not describe the table the standings are scored on").toContainText(`${DEFAULT_HEAD}… down to 8 for 20th`);

  // ── this tournament, added ────────────────────────────────────────────────
  const home = await prisma.event.findUniqueOrThrow({ where: { id: data.eventId }, select: { name: true, status: true } });
  await page.getByRole("button", { name: "Add this tournament to the season" }).click();
  await expect.poll(inSeason, { timeout: 20_000, message: "the tournament was not put in the season" }).toBe(first.id);
  if (home.status === "completed") await expect(main).toContainText("1 of 1 round counted", { timeout: 20_000 });
  else {
    await expect(main, "a tournament still being played is counted").toContainText("0 of 1 round counted", { timeout: 20_000 });
    await expect(main, "the screen does not say why the tournament is not counted").toContainText(`${home.name} — not finished yet, so it doesn't count`);
  }

  // ── finished: what was taken out cannot be put back until it is reopened ──
  await page.getByRole("button", { name: "Mark season finished" }).click();
  await expect.poll(async () => (await season(FIRST_FIXED))?.status, { timeout: 20_000, message: "the season was not marked finished" }).toBe("complete");
  await expect(main.locator(".tag", { hasText: "Finished" }), "a finished season is not marked as one").toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Remove this tournament from the season" }).click();
  await expect.poll(inSeason, { timeout: 20_000, message: "the tournament was not taken out" }).toBeNull();
  await page.getByRole("button", { name: "Add this tournament to the season" }).click();
  await expect(main.getByText(`${FIRST_FIXED} is finished. Reopen it before adding rounds.`), "adding to a finished season is not refused in words").toBeVisible({ timeout: 20_000 });
  expect(await inSeason(), "a tournament was added to a finished season").toBeNull();
  await page.getByRole("button", { name: "Reopen season" }).click();
  await expect.poll(async () => (await season(FIRST_FIXED))?.status, { timeout: 20_000, message: "the season was not reopened" }).toBe("active");
  await page.getByRole("button", { name: "Add this tournament to the season" }).click();
  await expect.poll(inSeason, { timeout: 20_000, message: "a reopened season does not take the tournament" }).toBe(first.id);

  // ── a second season, beside the first ─────────────────────────────────────
  await page.getByRole("button", { name: "Start another season" }).click();
  // Both panels open at once is the widest this screen gets, and no walk sees it: the fixture's
  // club is on the free plan, where every other spec finds this screen locked.
  expect(await offTheSide(page), "the season screen runs off the side with its rules and the new-season form open").toEqual({ page: 0, controls: [] });
  await page.getByLabel("The new season’s name").fill(SECOND);
  await page.getByRole("button", { name: "Start a season" }).click();
  await expect.poll(async () => (await mine()).map((s) => s.name), { timeout: 20_000, message: "the second season was not stored beside the first" }).toEqual([FIRST_FIXED, SECOND]);
  const second = (await season(SECOND))!;
  const chooser = page.getByRole("combobox", { name: "Season" });
  await expect(chooser, "the club is not taken to the season it just started").toHaveValue(second.id, { timeout: 20_000 });
  await page.getByRole("button", { name: "Scoring & rules" }).click();
  expect(await boxes(page), "the second season was opened with the first season's rules").toMatchObject({ name: SECOND, bestOf: "0", toQualify: "0" });
  // The first draft put the season's name in the button, and on a phone it ran off the side.
  expect(await offTheSide(page), "the second season's screen runs off the side").toEqual({ page: 0, controls: [] });
  // The tournament is in the FIRST season: here it can be moved, and the screen says from where.
  await expect(page.getByRole("button", { name: "Move this tournament to this season" }), "the button does not say the tournament would be moved").toBeVisible();
  await expect(main, "the screen does not say which season the tournament is in now").toContainText(`The tournament you have open is in ${FIRST_FIXED}.`);

  // ── and back: the first season's rules, not the second's ──────────────────
  await chooser.selectOption(first.id);
  await expect(page, "choosing a season did not open it").toHaveURL(new RegExp(`id=${first.id}`), { timeout: 20_000 });
  await expect(main, "the first season's sentence is not its own").toContainText("best 3 rounds count · 2 rounds to qualify", { timeout: 20_000 });
  await page.getByRole("button", { name: "Scoring & rules" }).click();
  expect(await boxes(page), "the first season was opened with another season's rules").toMatchObject({ name: FIRST_FIXED, bestOf: "3", toQualify: "2" });
  await expect(page.getByRole("button", { name: "Remove this tournament from the season" })).toBeVisible();

  // ── the second, deleted: asked first ──────────────────────────────────────
  await chooser.selectOption(second.id);
  await expect(page).toHaveURL(new RegExp(`id=${second.id}`), { timeout: 20_000 });
  await page.getByRole("button", { name: "Scoring & rules" }).click();
  // Centred first: on a phone the button can come to rest under the bar along the bottom, where a
  // person would scroll and a script would press the bar for three minutes.
  await page.getByRole("button", { name: "Delete season" }).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.getByRole("button", { name: "Delete season" }).click();
  expect((await mine()).length, "one press deleted a season without asking").toBe(2);
  await page.getByRole("button", { name: "Delete the season" }).click();
  await expect.poll(async () => (await mine()).map((s) => s.name), { timeout: 20_000, message: "the season was not deleted" }).toEqual([FIRST_FIXED]);
  expect(await inSeason(), "deleting one season took the tournament out of the other").toBe(first.id);
  await expect(main.locator(".card-title", { hasText: FIRST_FIXED }), "the club is not shown the season it still has").toBeVisible({ timeout: 20_000 });

  expect(errors, "a screen threw").toEqual([]);
});
