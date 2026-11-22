import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, returnCard, signIn, dayIn, addDays } from "./rounds-fixture";
import { RoundsScreen } from "./console/rounds";

/**
 * ROUNDS & FORMATS SAYS WHY IT IS LOCKED ONCE, AND DRAWS NO CONTROL THAT WOULD BE REFUSED (R4).
 *
 * The redesigned screen (`consoleUrl("/stages", "build")`) reads the rounds lock from the machine and says it in one
 * banner (`LockedOnce`); a round that has scores shows its settings as text with one line at its head, and a completed
 * event shows every round as text. Each test builds the club it needs and drops it afterwards.
 *
 * WHAT IT CANNOT SEE: that a refusal is what the server would have answered (`a-locked-scope-is-refused-in-words.audit`
 * holds that). A launched league's undated week (B101) is the third test: the dashboard's button, the column's ring, and
 * dating it from the column.
 */

test.describe.configure({ timeout: 120_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-rlo-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

test("a completed event draws every round as text under one banner and no control", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = `zz-rlo-done-${testInfo.project.name}`;
  const club = await makeClub(mark);
  try {
    const { event } = await makeEvent(club, "Closing Medal", { status: "completed", stages: [{}, {}], players: 2 });
    await signIn(context, baseURL!, club, event.id);
    const screen = new RoundsScreen(page);
    await screen.open();
    await expect(screen.column("Round 1")).toBeVisible();
    await expect(screen.column("Round 2")).toBeVisible();
    await expect(screen.lockedOnce(), "the lock is said once, not once a round").toHaveCount(1);
    const scope = page.locator("[data-rounds-screen]");
    await expect(scope.locator("select"), "a completed event offers a picker").toHaveCount(0);
    await expect(scope.locator('input[type="date"]'), "a completed event offers a date box").toHaveCount(0);
    await expect(scope.getByRole("button", { name: /^Add a round/ }), "a completed event offers a new round").toHaveCount(0);
    await expect(scope.getByRole("button", { name: /^Delete Round/ }), "a completed event offers Delete").toHaveCount(0);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a played round on a live event shows its settings as text and says why", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = `zz-rlo-live-${testInfo.project.name}`;
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Live Medal", { status: "live", stages: [{}, {}], players: 4 });
    await returnCard(event.id, stages[0].id, players[0].id);
    await signIn(context, baseURL!, club, event.id);
    const screen = new RoundsScreen(page);
    await screen.open();
    await expect(screen.column("Round 1")).toContainText("This round has scores, so its settings are locked.");
    await expect(screen.formatSelect("Round 1"), "a played round offers its format").toHaveCount(0);
    await expect(screen.formatSelect("Round 2"), "a round with no scores keeps its format control").toBeVisible();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a launched league's undated week: the dashboard's button lands on its column, the ring is drawn, and dating it moves the button on (B101)", async ({ page, context, baseURL }, testInfo) => {
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = `zz-rlo-league-${testInfo.project.name}`;
  const club = await makeClub(mark);
  try {
    const week1 = dayIn("");
    const { event, stages, players } = await makeEvent(club, "Autumn League", {
      status: "live",
      // A league by its kind (`playKind`), three weekly rounds, only the first dated: the others are dated as the season goes.
      event: { playKind: "league", dates: "Autumn league", startOn: week1, endOn: week1 },
      stages: [{ playedOn: week1 }, {}, {}],
      players: 4,
    });
    // Week 1 has been played (a card is in), so the next unplayed week is week 2, which is undated: the button's week.
    await returnCard(event.id, stages[0].id, players[0].id);
    await signIn(context, baseURL!, club, event.id);
    const statusCard = page.locator(".card").filter({ has: page.locator(".card-kicker", { hasText: "Tournament status" }) });
    const setRound2 = statusCard.getByRole("link", { name: "Set Round 2’s day" });

    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(setRound2, "a launched league's next undated week has no button on the dashboard").toBeVisible();
    await setRound2.click();
    await expect(page).toHaveURL((url) => url.pathname === "/stages" && url.searchParams.get("round") === stages[1].id);

    // The same round on the redesigned screen: not started, so the machine's ring is drawn and its day is open to set.
    const screen = new RoundsScreen(page);
    await screen.open();
    await expect(screen.column("Round 2").locator("[data-round-ring]"), "an undated week on a launched league draws no ring").toBeVisible();
    // The organizer presses "Use the default": for a league the app proposes a WEEK on (calendar days on the club's own day,
    // no instant in it, so E2E_TZ cannot move it). The button names the day it proposes; nothing is typed.
    const day = addDays(week1, 7);
    await screen.column("Round 2").getByRole("button", { name: `Use the default (${day})` }).click();
    await expect
      .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stages[1].id } })).playedOn, { message: "the week's day was not stored from its column" })
      .toBe(day);

    // The next week proposes a week after that: week 3 = week 2 + 7.
    const day3 = addDays(day, 7);
    await screen.column("Round 3").getByRole("button", { name: `Use the default (${day3})` }).click();
    await expect
      .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: stages[2].id } })).playedOn, { message: "week 3 was not stored a week after week 2" })
      .toBe(day3);

    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(setRound2, "the dashboard still asks for a day the column has set").toHaveCount(0);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
