import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { seedOrganizer, teardownOrganizer, medalEmail, MEDAL_COURSE } from "./organizer-fixture.mjs";
import { prisma, makeClub, dropClub, makeEvent, signIn } from "./rounds-fixture";
import { RoundsScreen } from "./console/rounds";
import { openScreen } from "./console";

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
  watchPageErrors(page, errors);

  await test.step("create it from the team cup starting point", async () => {
    await open(page, "/choose");
    await page.getByLabel("Tournament name").fill(TOURNAMENT);
    await page.getByRole("button", { name: /^A series of rounds/ }).click();
    await page.getByLabel("Start from").selectOption("team-cup");
    await page.getByRole("button", { name: "Create tournament" }).click();
    await page.waitForURL(/\/registration/, { timeout: 60_000 }); // a new tournament opens on Entries
    await page.goto("/dashboard");
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
      // The cup template's players sign in with a Round Code, so neither the
      // address nor — since 2026-10-17, on any plan — the mobile is asked for.
      await page.getByRole("textbox", { name: /^Email · optional/ }).fill(medalEmail(i));
      await expect(page.getByRole("textbox", { name: /^Mobile · required/ }), "a code-scored cup still demands a mobile").toHaveCount(0);
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
    await expect(main).toContainText("Team cup");
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

/**
 * @redesign: THE CUP'S POINTS TO WIN AND HOLDER, ON ROUNDS & FORMATS (R4d; the cup's settings are rounds-scope settings).
 * The organizer of a two-team cup sets points to win and the holder on the card above the rounds, is refused a figure that
 * is not whole or half beside Save, and after a reload sees what was kept, on Rounds and on the cup page's pointer.
 * The teams are read from the fixture (`flights`); one session, four players. A throwaway club, dropped in `finally`.
 * Service workers are not in play (no offline route). Memory: one page, about 150 MB.
 */
test.describe("@redesign the cup's settings on Rounds & formats", () => {
  test("points to win and the holder are set on the card, refused when not a half number, and kept", async ({ page, context, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    watchPageErrors(page, errors);
    const mark = `zz-oc-redesign-${testInfo.project.name}`;
    const club = await makeClub(mark);
    try {
      const { event, flights } = await makeEvent(club, "Autumn Cup", {
        // Still being set up: once launched the rounds scope is locked and the points are the committee's to correct.
        stages: [{ type: "Team Session", format: "Match Play", scoringBasis: "net" }],
        players: 4,
        flights: 2,
        event: { format: "match" },
      });
      await signIn(context, baseURL!, club, event.id);
      const screen = new RoundsScreen(page);
      await screen.open();
      const tile = screen.cupSettings();
      await expect(tile).toBeVisible();
      const points = tile.getByLabel("Points to win");
      const holder = tile.getByLabel(/^Holder/);
      const save = tile.getByRole("button", { name: "Save", exact: true });

      // A figure that is not a whole or half number is refused where Save was pressed, and nothing is kept.
      await points.fill("abc");
      await save.click();
      const refused = tile.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: "whole or half number" });
      await expect(refused, "a figure that is not a half number was not refused beside Save").toBeVisible();
      expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).cupPointsToWin).toBe(0);

      await points.fill("2.5");
      await holder.selectOption({ label: flights[1].name });
      await save.click();
      await expect
        .poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).cupPointsToWin, { message: "the points to win were not stored" })
        .toBe(2.5);

      // After a reload the card says what was kept, and holds one tile only.
      await page.reload();
      await expect(screen.cupSettings()).toBeVisible();
      await expect(screen.cupSettings().getByLabel("Points to win"), "the points did not survive a reload").toHaveValue("2.5");
      await expect(screen.cupSettings().getByLabel(/^Holder/)).toHaveValue(flights[1].id);
      await expect(page.locator("#cup-target")).toHaveCount(1);

      // The cup page points here instead of drawing a second copy.
      await openScreen(page, "/cup");
      await expect(page.locator("[data-cup-settings-moved]")).toContainText("set on Rounds & formats");
      await expect(page.locator("#cup-target")).toHaveCount(0);
    } finally {
      await dropClub(mark);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
