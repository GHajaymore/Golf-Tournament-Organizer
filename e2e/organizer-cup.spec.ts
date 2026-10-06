import { test, expect, type Page } from "@playwright/test";
import { seedOrganizer, teardownOrganizer, medalEmail, MEDAL_COURSE } from "./organizer-fixture.mjs";

/**
 * A TEAM CUP, SET UP FROM NOTHING BY A NEW ORGANIZER — the half of the cup
 * `team-cup.spec.ts` cannot walk, because it arrives with the teams made.
 *
 * Walked by hand first, 2026-10-06, and the teams were the problem: the Team
 * cup screen sent the organizer to Flights to "set up exactly two flights …
 * with the Manual rule", a screen about formation rules and flight sizes; and
 * the setup guide asked for "Teams & pairs" (sides drawn from the field) and
 * "Flights" — neither of which a cup has — and never said "your two teams".
 * Now the teams are made on the Team cup screen, by name, and the guide asks
 * for exactly that.
 *
 * Two a side, the smallest cup with every session in it: one four-ball, one
 * foursomes and two singles.
 */
const PLAYERS = [
  { name: "Ash Quayle", index: "4", team: "Blues" },
  { name: "Birch Quayle", index: "10", team: "Blues" },
  { name: "Cedar Quayle", index: "8", team: "Whites" },
  { name: "Damson Quayle", index: "14", team: "Whites" },
];
const TOURNAMENT = "Autumn Cup — Blues v Whites";

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

test("a new organizer sets up a team cup", async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${new URL(page.url()).pathname}: ${String(e)}`));

  await test.step("create it from the team cup starting point", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A series of rounds/ }).click();
    await page.getByLabel("Start from").selectOption("team-cup");
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  });

  await test.step("date and course", async () => {
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

  await test.step("enter the four players", async () => {
    await open(page, "/registration");
    for (const [i, p] of PLAYERS.entries()) {
      await page.getByLabel("Player name", { exact: true }).fill(p.name);
      // The cup template's players sign in with a Round Code, so the address
      // is optional here and the mobile is not.
      await page.getByRole("textbox", { name: /^Email · optional/ }).fill(medalEmail(i));
      await page.getByRole("textbox", { name: /^Mobile · required/ }).fill(`555070${i}`);
      await page.getByLabel("Handicap", { exact: true }).fill(p.index);
      await page.getByRole("button", { name: "Add to field" }).click();
      await expect(page.getByText(p.name).first()).toBeVisible({ timeout: 20_000 });
    }
  });

  await test.step("the setup guide asks for the two teams — not sides, not flights", async () => {
    // The setup rail on the field's own screen: five steps, the cup's teams
    // among them, and neither of the two a cup does not have.
    await open(page, "/registration");
    const main = page.locator("main");
    await expect(main).toContainText("2 of 5 done");
    await expect(main).toContainText("To doTeam cup");
    await expect(main).not.toContainText("Teams & pairs");
    await expect(main).not.toContainText("Flights");
  });

  await test.step("make the teams on the Team cup screen, by name", async () => {
    await open(page, "/cup");
    const make = page.getByRole("form", { name: "Make the two teams" });
    await make.getByLabel("First team").fill("Blues");
    await make.getByLabel("Second team").fill("Whites");
    await make.getByRole("button", { name: "Make the teams" }).click();
    await expect(page.getByRole("group", { name: "Team Blues" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("main")).toContainText("Not on a team yet:");
  });

  await test.step("put each player on a team, and name the captains", async () => {
    for (const p of PLAYERS) {
      const card = page.getByRole("group", { name: `Team ${p.team}` });
      await card.getByLabel("Add a player").selectOption({ label: `${p.name} · ${p.index}` });
      // The team's list row — not the captain picker, which names them too.
      await expect(card.getByRole("listitem").filter({ hasText: p.name })).toBeVisible({ timeout: 20_000 });
    }
    await expect(page.locator("main")).toContainText("Everybody entered is on a team.");
    await page.getByRole("group", { name: "Team Blues" }).getByLabel("Captain").selectOption({ label: "Ash Quayle" });
    await expect(page.getByRole("group", { name: "Team Blues" }).getByText("Captain", { exact: true })).toBeVisible({ timeout: 20_000 });
    // And the board says who leads them.
    await expect(page.getByRole("region", { name: "The cup" })).toContainText("Captain Ash Quayle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "the Team cup screen scrolls sideways").toBeLessThanOrEqual(1);
  });

  await test.step("the guide counts the teams as done, and moves on to the money", async () => {
    await open(page, "/registration");
    const main = page.locator("main");
    await expect(main).toContainText("3 of 5 done");
    await expect(main).toContainText("DoneTeam cup");
  });

  await test.step("the dashboard is the cup, and says the next job is the first lineup", async () => {
    await open(page, "/dashboard");
    const main = page.locator("main");
    await expect(page.getByRole("region", { name: "The cup" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Set the lineup" })).toBeVisible();
    await expect(main).toContainText("Four-balls has no lineup yet");
    // None of the field's furniture a cup does not have.
    await expect(main).not.toContainText("Sides in");
    await expect(main).not.toContainText("flights");
    await expect(page.getByRole("link", { name: "Team cup" }).first()).toBeVisible();
  });

  await test.step("line up the four-balls and announce them", async () => {
    await open(page, "/cup");
    const card = page.getByRole("region", { name: "Four-balls lineup" });
    await card.getByLabel("Blues player 1, Four-balls").selectOption({ label: "Ash Quayle" });
    await card.getByLabel("Blues player 2, Four-balls").selectOption({ label: "Birch Quayle" });
    await card.getByLabel("Whites player 1, Four-balls").selectOption({ label: "Cedar Quayle" });
    await card.getByLabel("Whites player 2, Four-balls").selectOption({ label: "Damson Quayle" });
    await card.getByRole("button", { name: "Add match" }).click();
    await expect(card.getByRole("listitem", { name: "Ash Quayle & Birch Quayle v Cedar Quayle & Damson Quayle" })).toBeVisible({ timeout: 20_000 });
    // A player in a lineup stays on their team until that match goes.
    await expect(page.getByRole("group", { name: "Team Blues" }).getByText("In a lineup").first()).toBeVisible();

    // Drafted: the dashboard says it is waiting to be announced.
    await open(page, "/dashboard");
    await expect(page.locator("main")).toContainText("Four-balls lineup is ready to announce");

    await open(page, "/cup");
    const again = page.getByRole("region", { name: "Four-balls lineup" });
    await again.getByRole("button", { name: "Announce lineup" }).click();
    await again.getByRole("button", { name: "Announce to everyone" }).click();
    await expect(again.getByText("Announced", { exact: true })).toBeVisible({ timeout: 20_000 });

    // Announced: the next job is the next session's lineup.
    await open(page, "/dashboard");
    const main = page.locator("main");
    await expect(main).not.toContainText("Four-balls lineup is ready to announce");
    await expect(main).toContainText("Foursomes has no lineup yet");
  });

  expect(errors, "a screen threw").toEqual([]);
});
