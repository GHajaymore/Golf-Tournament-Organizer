import { test, expect, type Page } from "@playwright/test";
import { seedCasual, teardownCasual } from "./casual-fixture.mjs";

/**
 * A CASUAL ROUND, PLAYED THE WAY IT IS PLAYED: at the course, on a phone.
 *
 * Every casual-round fault of 2026-10-03/04 was found by walking this by hand:
 * the course search that found nothing, players asked before the format that
 * decides them, a review queue on a friendly, a foursomes side shortened as if
 * it were a person, the match result shown as a points table. Each walk found
 * the next one, and each was a separate fix. This walks it on every push.
 *
 * One test per format, each from the empty setup screen to the result:
 *
 *   set up    format, gross or net, the players, the course found by search
 *   score     every hole on the hole-by-hole card, as the scorer taps it
 *   keep      the card read back after a reload holds all eighteen holes
 *   result    the dashboard says who won, by what, in golf's words
 *
 * ITS FIRST RUN FOUND TWO FAULTS THE HAND WALKS HAD NOT:
 *
 *   - a match card said "Saved" while most of its taps were still queued, so
 *     leaving the screen on that word kept 12 holes of 18;
 *   - a Modified Stableford round's dashboard said "Nothing to rank here yet"
 *     over two finished cards.
 *
 * THE SCORES ARE CHOSEN SO A WRONG RESULT LOOKS DIFFERENT. Everybody makes par
 * except the first side, which drops a shot on the 3rd and the 6th. So the
 * second side wins every format — a board that read the sides the wrong way
 * round, or never counted a hole, cannot print the right answer.
 *
 * In net the handicaps are EQUAL, so in match play nobody gets a shot off
 * anybody and the net result must equal the gross one. Modified Stableford is
 * the exception that proves the strokes land: the tee is rated 72.0 / 113 over
 * par 72, so a 10 index is 10 shots, on stroke index 1 to 10, and the points
 * below are worked from that card by hand.
 */

const FIRST_SIDE_DROPS_ON = new Set([3, 6]);

/** The run's user owns no club, so the course comes from the search. */
test.beforeAll(async () => {
  const { session } = await seedCasual();
  process.env.CASUAL_SESSION = session;
});
test.afterAll(async () => {
  await teardownCasual();
});

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  // A phone's walk. A desktop opens score entry on the full eighteen-hole
  // grid, by design, and a round at the course is not scored from one.
  test.skip(testInfo.project.name === "desktop", "scored on a phone, hole by hole");
  await context.addCookies([{ name: "ng_session", value: process.env.CASUAL_SESSION!, url: baseURL! }]);
});

const ANN = "Ann Zed";
const BEA = "Bea Zed";
const CAT = "Cat Zed";
const DOT = "Dot Zed";

/** The setup screen, top to bottom, in the order it asks. */
async function setUp(page: Page, format: string, net: boolean, names: string[]) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/match/new");
  await page.getByRole("button", { name: new RegExp(`^${format}\\b`) }).click();
  await page.getByRole("button", { name: net ? /off handicaps \(net\)/ : /play level \(gross\)/ }).click();

  for (const [i, name] of names.entries()) {
    const box = page.getByRole("combobox", { name: `Player ${i + 1} name` });
    if (!(await box.count())) await page.getByRole("button", { name: /Add a player/ }).click();
    await box.fill(name);
    if (net) await page.getByRole("textbox", { name: `Handicap for ${name}` }).fill("10");
  }

  // Found by typing, the way it is at the course — not picked from a club
  // library this person does not have.
  const course = page.getByRole("combobox", { name: "Where are you playing?" });
  await course.click();
  await course.fill("Fairway Meadows");
  const option = page.locator('#course-picker-list [role="option"]', { hasText: "Fairway Meadows" }).first();
  await expect(option, "the course search found nothing").toBeVisible({ timeout: 20_000 });
  await option.click();
  await expect(course).toHaveValue(/Fairway Meadows/);

  const start = page.getByRole("button", { name: /Start the (round|match)/ });
  await expect(start, "Start is refused with every question answered").toBeEnabled();
  await start.click();
  await page.waitForURL((u) => !u.pathname.startsWith("/match/new"), { timeout: 30_000 });
  expect(errors, "the setup screen threw").toEqual([]);
}

/**
 * Every hole, every card on it: one tap makes par, a second drops a shot.
 * The first side's cards come first on the hole, in the order they were typed.
 *
 * Then the card is READ BACK from a reload, which is the only proof it was
 * kept. The screen's own "Saved" is what the scorer goes by, so that is what
 * this waits for — no extra grace period a person would not give it.
 */
async function scoreEveryHole(page: Page, firstSideCards: number) {
  await page.goto("/entry");
  const plus = page.getByRole("button", { name: /^One more stroke for/ });
  await expect(plus.first(), "the hole-by-hole card did not open").toBeVisible({ timeout: 30_000 });

  for (let hole = 1; hole <= 18; hole += 1) {
    const n = await plus.count();
    for (let i = 0; i < n; i += 1) await plus.nth(i).click();
    if (FIRST_SIDE_DROPS_ON.has(hole)) {
      for (let i = 0; i < firstSideCards; i += 1) await plus.nth(i).click();
    }
    if (hole < 18) await page.getByRole("button", { name: /^Next/ }).click();
  }

  // A stroke or team card is kept by its button; a match card by every tap.
  const save = page.getByRole("button", { name: /^Save (scorecard|scores)/ });
  if (await save.count()) await save.first().click();
  await expect(page.getByText("Saving…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/\bSaved\b/).first()).toBeVisible({ timeout: 30_000 });

  await page.goto(`/entry?bust=${Date.now()}`);
  await expect(plus.first()).toBeVisible({ timeout: 30_000 });
  const thru = [...(await page.locator("main").innerText()).matchAll(/thru (\d+)/g)].map((m) => Number(m[1]));
  expect(thru.length, "the card shows nobody's progress").toBeGreaterThan(0);
  expect(thru, "the card lost holes once the screen said Saved").toEqual(thru.map(() => 18));
}

/** The dashboard a casual round lands on, read fresh, past any cache. */
async function dashboard(page: Page) {
  await page.goto(`/dashboard?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle");
  const text = await page.locator("main").innerText();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide, "the dashboard scrolls sideways").toBeLessThanOrEqual(0);
  // A friendly has no reviewer — #773.
  expect(text).not.toMatch(/awaiting review|confirm (the )?card|dispute/i);
  return text;
}

test.describe("a casual round at the course", () => {
  test.describe.configure({ timeout: 180_000 });

  test("match play, net, two players", async ({ page }) => {
    await setUp(page, "Match Play", true, [ANN, BEA]);
    await scoreEveryHole(page, 1);
    await dashboard(page);
    // Two down after the 6th and halved from there: over with one to play.
    await expect(page.locator("[data-match-line]")).toHaveText(`${BEA} won 2&1`);
  });

  test("stroke play, gross, three players", async ({ page }) => {
    await setUp(page, "Stroke Play", false, [ANN, BEA, CAT]);
    await scoreEveryHole(page, 1);
    const text = await dashboard(page);
    const bea = text.search(new RegExp(`${BEA}\\s+72\\s+E\\b`));
    const cat = text.search(new RegExp(`${CAT}\\s+72\\s+E\\b`));
    const ann = text.search(new RegExp(`${ANN}\\s+74\\s+\\+2\\b`));
    expect([bea, cat, ann], "a row is missing or wrong").not.toContain(-1);
    expect(ann, "the dropped shots are not last").toBeGreaterThan(Math.max(bea, cat));
  });

  test("modified stableford, net, two players", async ({ page }) => {
    await setUp(page, "Modified Stableford", true, [ANN, BEA]);
    await scoreEveryHole(page, 1);
    const text = await dashboard(page);
    // Ten shots on stroke index 1 to 10. Bea pars everything: ten net birdies
    // at 2 points, 20. Ann loses a point on the 3rd (index 11, no shot) and
    // holds net par on the 6th (index 5, a shot): nine net birdies less one, 17.
    // Columns: handicap, holes, gross, points.
    expect(text).not.toMatch(/Nothing to rank here yet/);
    const bea = text.search(new RegExp(`${BEA}\\s+10\\s+18\\s+72\\s+20\\b`));
    const ann = text.search(new RegExp(`${ANN}\\s+10\\s+18\\s+74\\s+17\\b`));
    expect([bea, ann], "a row is missing or wrong").not.toContain(-1);
    expect(ann, "fewer points ranked first").toBeGreaterThan(bea);
  });

  test("four-ball, net, four players", async ({ page }) => {
    await setUp(page, "Four-Ball", true, [ANN, BEA, CAT, DOT]);
    await scoreEveryHole(page, 2);
    await dashboard(page);
    await expect(page.locator("[data-match-line]")).toHaveText(`${CAT} & ${DOT} won 2&1`);
  });

  test("foursomes, gross, four players", async ({ page }) => {
    await setUp(page, "Foursomes", false, [ANN, BEA, CAT, DOT]);
    await scoreEveryHole(page, 1);
    await dashboard(page);
    await expect(page.locator("[data-match-line]")).toHaveText(`${CAT} & ${DOT} won 2&1`);
  });
});
