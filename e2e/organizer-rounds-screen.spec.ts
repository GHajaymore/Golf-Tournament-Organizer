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

// A NEW ORGANIZER FOR EACH TEST: the club the app makes for them is on the free
// plan, which runs one tournament at a time, and each test builds its own.
// `seedOrganizer` tears the last one down first.
test.beforeEach(async ({ context, baseURL }) => {
  const { session } = await seedOrganizer();
  await context.addCookies([{ name: "ng_session", value: session, url: baseURL! }]);
});
test.afterAll(async () => {
  await teardownOrganizer();
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

/**
 * TWO ROUND ROBINS OF MATCH PLAY, THEN A KNOCKOUT — the shape Ajay asked to be
 * walked (2026-10-16): a club's match-play championship played in groups, with
 * the leaders going through to a bracket. It is where the two tiebreak
 * questions, carrying points forward, a cut between the group rounds and
 * qualifying per flight all meet on one screen.
 *
 *   the round-robin list    Match Play chosen for it; no Stroke Play offered
 *   Every round             one line for all three: Match Play · 18 holes · off handicap
 *   Round 1                 Before the next round on its face: carry forward into Round 2, the cut
 *   the two tiebreaks       named apart: the match on the day, then the table
 *   the knockout            after groups, the top players per flight — not overall
 */
test("a match-play championship in groups, then a knockout", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  watchPageErrors(page, errors);
  const NAME = "Club Match Play — Groups and Knockout";

  await test.step("create a series of rounds", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(NAME);
    await page.getByRole("button", { name: /^A series of rounds/ }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });

  await test.step("two round robins of match play, then a bracket", async () => {
    await open(page, "/stages");
    const add = page.getByRole("button", { name: /^Add a round/ });
    if (await add.count()) await add.click();
    await page.getByRole("button", { name: /^Round robin/ }).click();
    await expect(page.getByLabel("Format for every round added")).toHaveValue("Match Play");
    const forGroups = await optionsOf(page, "Format for every round added");
    expect(forGroups.some((o) => o.startsWith("Stroke Play")), "a round robin is offered Stroke Play").toBe(false);
    await page.getByLabel("How many rounds to add").fill("2");
    await page.getByRole("button", { name: /^Add 2 round robins/ }).click();
    await expect(page.getByRole("button", { name: /^Round 2 · Round Robin/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /^Bracket/ }).click();
    await expect(page.getByLabel("Format for every round added")).toHaveValue("Match Play");
    await page.getByRole("button", { name: /^Add bracket/ }).click();
    await expect(page.getByRole("button", { name: /^Round 3 · Bracket Stage/ })).toBeVisible({ timeout: 20_000 });
  });

  await test.step("one line says what every round shares", async () => {
    await open(page, "/stages");
    const every = page.getByRole("button", { name: /^Every round/ });
    await expect(every).toContainText("All 3: Match Play · 18 holes · off handicap");
  });

  await test.step("Round 1 says what carries into Round 2, on its face", async () => {
    const r1 = page.getByRole("button", { name: /^Round 1 · Round Robin/ });
    if ((await r1.getAttribute("aria-expanded")) !== "true") await r1.click();
    const card = page.locator(".card", { has: r1 });
    await expect(card.getByText("Before the next round")).toBeVisible();
    await expect(card.getByText(/Carry forward points into Round 2/).first()).toBeVisible();
    await expect(card.getByRole("checkbox", { name: "Cut the field for Round 2" })).toBeVisible();
  });

  await test.step("the two tiebreaks are named apart", async () => {
    const r1 = page.getByRole("button", { name: /^Round 1 · Round Robin/ });
    const card = page.locator(".card", { has: r1 });
    const customize = card.getByRole("button", { name: /^Customize this round/ });
    if ((await customize.getAttribute("aria-expanded")) !== "true") await customize.click();
    await expect(card.getByText("1. If a match is all square after the last hole")).toBeVisible();
    await expect(card.getByText("2. If players finish level in the table")).toBeVisible();
  });

  await test.step("the knockout after groups takes the top players per flight", async () => {
    const ko = page.getByRole("button", { name: /^Round 3 · Bracket Stage/ });
    if ((await ko.getAttribute("aria-expanded")) !== "true") await ko.click();
    const card = page.locator(".card", { has: ko });
    await expect(card.locator("label.seg-opt", { hasText: /^\s*Per flight\s*$/ }).locator("input")).toBeChecked();
  });

  expect(errors).toEqual([]);
});
