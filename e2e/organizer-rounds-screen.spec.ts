import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seedOrganizer, teardownOrganizer } from "./organizer-fixture.mjs";

/**
 * ROUNDS & FORMATS, AS A NEW ORGANIZER BUILDS THEM — the walk of 2026-10-16.
 *
 * Ajay set a tournament up himself and found the screen confusing; the walk that
 * followed (docs/walk-rounds-and-format-2026-10-16.md) found a stroke round that
 * accepted Match Play and was then marked done, an unplayed Round 1 chipped
 * "Played", round numbers that did not close up after a delete, a cut sentence
 * reading "16 and ties of 0", a knockout after a medal drawing two players, and
 * the controls about PLAY offered at setup. He asked for the screen to start as
 * a club plays and keep the rest under Customize. This does each of those as the
 * organizer would, on the screen, and reads what the screen then says.
 *
 *   the format list         a stroke round offers no Match Play; a bracket no Stroke Play
 *   a new round             starts Net, with its allowance under it
 *   setup                   no "finished" box, no scoring window, no Played chip
 *   the strip               Now on the step on screen
 *   the cut                 a rule until there is a field, ranked on the round
 *   a knockout after it     the top 16 overall, not two per flight
 *   a delete                the rounds left are numbered 1, 2 — on the list and the banner alike
 *   Customize               says Nothing changed; the tie rule in words
 */

const TOURNAMENT = "Autumn Meeting — Rounds Walk";

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

/** The words of a <select>'s options. */
const optionsOf = async (page: Page, label: string) =>
  page.getByLabel(label).locator("option").allInnerTexts();

test("a new organizer sets up the rounds, and the screen starts as a club plays", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);

  await test.step("create a series of rounds", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A series of rounds/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });

  await test.step("the format list holds only what the kind of round can be scored in", async () => {
    await open(page, "/stages");
    const add = page.getByRole("button", { name: /^Add a round/ });
    if (await add.count()) await add.click();
    const stroke = page.getByRole("button", { name: /^Stroke play round/ });
    await stroke.click();
    await expect(stroke, "the chosen kind of round does not say it is chosen").toHaveAttribute("aria-pressed", "true");
    // Chosen for the organizer, as clubs play it.
    await expect(page.getByLabel("Format for every round added")).toHaveValue("Stroke Play");
    const forStroke = await optionsOf(page, "Format for every round added");
    expect(forStroke.join(" | "), "a stroke round is offered Match Play").not.toMatch(/(^|\| )Match Play( \||$)/);
    expect(forStroke.some((o) => o.startsWith("Four-Ball — ")), "the look-alikes carry no words").toBe(true);
    expect(forStroke.some((o) => o.startsWith("Alternate Shot")), "one game listed twice").toBe(false);

    await page.getByRole("button", { name: /^Bracket/ }).click();
    await expect(page.getByLabel("Format for every round added")).toHaveValue("Match Play");
    const forBracket = await optionsOf(page, "Format for every round added");
    expect(forBracket.some((o) => o.startsWith("Stroke Play")), "a knockout is offered Stroke Play").toBe(false);
    expect(forBracket.some((o) => o.startsWith("Skins")), "a knockout is offered Skins").toBe(false);
  });

  await test.step("two stroke play rounds, which start off handicap", async () => {
    await page.getByRole("button", { name: /^Stroke play round/ }).click();
    await page.getByLabel("How many rounds to add").fill("2");
    await page.getByRole("button", { name: /^Add 2 stroke play rounds/ }).click();
    const r1 = page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ });
    await expect(r1).toBeVisible({ timeout: 20_000 });
    if ((await r1.getAttribute("aria-expanded")) !== "true") await r1.click();
    const card = page.locator(".card", { has: r1 });
    await expect(card.locator("label.seg-opt", { hasText: /^\s*Net\s*$/ }).locator("input")).toBeChecked();
    await expect(card.getByText("Off handicap, as most club competitions are.")).toBeVisible();
    await expect(card.getByText(/^Handicap allowance/)).toBeVisible();
  });

  await test.step("nothing about play before there is any", async () => {
    await open(page, "/stages");
    const r1 = page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ });
    if ((await r1.getAttribute("aria-expanded")) !== "true") await r1.click();
    const main = page.locator("main");
    await expect(main.getByRole("checkbox", { name: /^This round is finished/ })).toHaveCount(0);
    await expect(main.getByText("Scoring window")).toHaveCount(0);
    for (const chip of ["Played", "Active", "Upcoming"]) {
      await expect(main.locator(".tag", { hasText: new RegExp(`^${chip}$`) }), `a ${chip} chip at setup`).toHaveCount(0);
    }
    // The strip's Now is this screen.
    const here = page.locator('a[aria-current="step"]');
    await expect(here).toContainText("Rounds & formats");
    await expect(here).toContainText(/Now/i);
  });

  await test.step("the cut is a rule until there is a field", async () => {
    const box = page.getByRole("checkbox", { name: "Cut the field for Round 2" });
    await box.check();
    await expect(page.getByText("The top 16, and anyone tied with the last place, play Round 2. Nobody is entered yet.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Who plays Round 2, ranked on Round 1\./)).toBeVisible();
    await expect(page.getByText(/and ties of 0/)).toHaveCount(0);
  });

  await test.step("a knockout after the medal takes the top 16 overall", async () => {
    await open(page, "/stages");
    await page.getByRole("button", { name: /^Add a round/ }).click();
    await page.getByRole("button", { name: /^Bracket/ }).click();
    await page.getByRole("button", { name: /^Add bracket/ }).click();
    const ko = page.getByRole("button", { name: /^Round 3 · Bracket Stage/ });
    await expect(ko).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      await open(page, "/stages");
      const head = page.getByRole("button", { name: /^Round 3 · Bracket Stage/ });
      if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
      const card = page.locator(".card", { has: head });
      await expect(card.locator("label.seg-opt", { hasText: /^\s*Overall\s*$/ }).locator("input")).toBeChecked();
    }).toPass({ timeout: 20_000 });
  });

  await test.step("delete Round 1, and every count on the screen closes up", async () => {
    await open(page, "/stages");
    const r1 = page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ });
    if ((await r1.getAttribute("aria-expanded")) !== "true") await r1.click();
    await page.getByRole("button", { name: "Delete Round 1" }).click();
    await expect(async () => {
      await open(page, "/stages");
      await expect(page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ })).toHaveCount(1);
      await expect(page.getByRole("button", { name: /^Round 2 · Bracket Stage/ })).toHaveCount(1);
      await expect(page.getByRole("button", { name: /^Round 3 · / })).toHaveCount(0);
    }).toPass({ timeout: 20_000 });
  });

  await test.step("Customize says what is changed, and how a tie is broken", async () => {
    const r1 = page.getByRole("button", { name: /^Round 1 · Stroke Play Round/ });
    if ((await r1.getAttribute("aria-expanded")) !== "true") await r1.click();
    const customize = page.getByRole("button", { name: /^Customize this round/ });
    await expect(customize).toContainText("Nothing changed");
    if ((await customize.getAttribute("aria-expanded")) !== "true") await customize.click();
    await expect(page.getByText(/placed by countback on the card — the better last nine, then the last six, the last three and the last hole/)).toBeVisible();
  });

  expect(errors).toEqual([]);
});
