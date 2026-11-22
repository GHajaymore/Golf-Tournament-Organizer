import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, returnCard, signIn } from "./rounds-fixture";
import { RoundsScreen } from "./console/rounds";

/**
 * ROUNDS & FORMATS SAYS WHY IT IS LOCKED ONCE, AND DRAWS NO CONTROL THAT WOULD BE REFUSED (R4).
 *
 * The redesigned screen (`consoleUrl("/stages", "build")`) reads the rounds lock from the machine and says it in one
 * banner (`LockedOnce`); a round that has scores shows its settings as text with one line at its head, and a completed
 * event shows every round as text. Each test builds the club it needs and drops it afterwards.
 *
 * WHAT IT CANNOT SEE: that a refusal is what the server would have answered (`a-locked-scope-is-refused-in-words.audit`
 * holds that), and a launched league's undated week (`status-league.spec.ts` presses its dashboard button).
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
