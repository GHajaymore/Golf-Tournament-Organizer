import { test, expect, type Page } from "@playwright/test";
import { seedOrganizer, teardownOrganizer, medalEmail, MEDAL_PARS, MEDAL_COURSE } from "./organizer-fixture.mjs";

/**
 * A CLUB STABLEFORD, RUN FROM NOTHING — the commonest weekly competition there
 * is, and the one every member checks the points on.
 *
 * Stableford is played off handicap at 95% (WHS Appendix C, individual
 * stroke play; `formats.ts`), and a hole scores 2 + par − net strokes, never
 * below nothing. The tee is rated 72.0 / 113 over par 72, so a course
 * handicap is the index and the playing handicap 95% of it, rounded:
 *
 *   index  playing   card                              points
 *     0       0      par everywhere, a 9 on the par-3 3rd   17×2 + 0  = 34
 *    12      11      a bogey on every hole              11×2 + 7×1 = 29
 *    18      17      a double bogey on every hole            17×1   = 17
 *    28      27      a bogey on every hole               9×3 + 9×2 = 45
 *
 * Three rules, each with a number that only it produces: the 9 on the 3rd
 * scores NOTHING, not −4 (34, not 30); the allowance is 95%, not 100% (29, 17
 * and 45, not 30, 18 and 46); and the points come off the stroke index (the
 * 28-handicap's double shots fall on index 1 to 9). The worst gross score in
 * the field wins, which is what handicap Stableford is for.
 */

type Entrant = { name: string; index: string; card: number[]; points: number; gross: number };
const PAR = MEDAL_PARS.reduce((a: number, b: number) => a + b, 0);
const FIELD: Entrant[] = [
  {
    name: "Alder Quayle",
    index: "0",
    card: MEDAL_PARS.map((p: number, i: number) => (i === 2 ? 9 : p)),
    points: 34,
    gross: PAR + 6,
  },
  { name: "Briar Quayle", index: "12", card: MEDAL_PARS.map((p: number) => p + 1), points: 29, gross: PAR + 18 },
  { name: "Cedar Quayle", index: "18", card: MEDAL_PARS.map((p: number) => p + 2), points: 17, gross: PAR + 36 },
  { name: "Dune Quayle", index: "28", card: MEDAL_PARS.map((p: number) => p + 1), points: 45, gross: PAR + 18 },
];
const TOURNAMENT = "Monthly Stableford — October";

test.beforeAll(async () => {
  const { session } = await seedOrganizer();
  process.env.ORGANIZER_SESSION = session;
});
test.afterAll(async () => {
  await teardownOrganizer();
});
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "ng_session", value: process.env.ORGANIZER_SESSION!, url: baseURL! }]);
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
}

test("a new organizer runs a club Stableford to a points board", async ({ page }) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  // With the page it came from: "a screen threw" is no use without which one.
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  await test.step("create, date and course", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A single round/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    await open(page, "/event");
    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel("Tournament dates, first day").fill(today);
    await page.getByLabel("Tournament dates, last day").fill(today);
    const course = page.getByRole("combobox", { name: "Golf course" });
    await course.click();
    await course.fill("Kingsbarn Heath");
    await page.locator('#course-picker-list [role="option"]', { hasText: "Dayton" }).first().click();
    await page.locator("button.btn-primary", { hasText: /Save event|Adding the course/ }).click();
    await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(course).toHaveValue(MEDAL_COURSE);
  });

  await test.step("enter the field with indexes", async () => {
    await open(page, "/registration");
    for (const [i, p] of FIELD.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      await page.getByRole("textbox", { name: /^Email · required/ }).fill(medalEmail(i));
      await page.getByRole("textbox", { name: /^Mobile · required/ }).fill(`555040${i}`);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("one Stableford round", async () => {
    await open(page, "/stages");
    await page.getByRole("button", { name: /^Stroke play round/ }).click();
    await page.getByLabel("Format for every round added").selectOption("Stableford");
    await page.getByRole("button", { name: /^Add stroke play round/ }).click();
    await expect(page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ })).toBeVisible({ timeout: 20_000 });
  });

  await test.step("launch", async () => {
    await open(page, "/dashboard");
    for (const step of ["Start taking entries", "Mark ready"]) {
      await page.getByRole("button", { name: step }).click();
      await expect(page.getByRole("button", { name: step })).toHaveCount(0, { timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Launch tournament" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Launch tournament" }).click();
    await expect(page.getByRole("button", { name: "Complete tournament" })).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the returned cards", async () => {
    for (const p of FIELD) {
      await open(page, "/entry");
      const picker = page.getByLabel("Player", { exact: true });
      const value = await picker.locator("option", { hasText: p.name }).first().getAttribute("value");
      await picker.selectOption(value!);
      const full = page.getByRole("button", { name: "Full card" });
      if (await full.count()) await full.click();
      for (const [i, strokes] of p.card.entries()) {
        await page.getByLabel(`Hole ${i + 1}, par ${MEDAL_PARS[i]}`).fill(String(strokes));
      }
      await page.getByRole("button", { name: /^Save scorecard/ }).click();
      await expect(page.getByText(/Saved/).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("the points board, read against the Rules", async () => {
    await open(page, "/leaderboard");
    const board = await page.locator("main").innerText();
    // A row reads: place, name, holes, gross, points.
    const order = [...FIELD].sort((a, b) => b.points - a.points);
    const at = order.map((p) => board.search(new RegExp(`${p.name}\\s+18\\s+${p.gross}\\s+${p.points}\\b`)));
    expect(at, `a player is missing or carries the wrong points:\n${board}`).not.toContain(-1);
    expect([...at].sort((a, b) => a - b), "the board is not in points order").toEqual(at);
    // One flight, one round, nobody advancing anywhere: the board says neither.
    // It read "across all flights" and "Advancing rows reflect the
    // qualification cutoff" here until 2026-10-04.
    expect(board).not.toMatch(/across all flights/);
    expect(board).not.toMatch(/Advancing rows/);
    // The rule it does state, in its own words.
    expect(board).toMatch(/floored at 0/);
  });

  expect(errors, "a screen threw").toEqual([]);
});
