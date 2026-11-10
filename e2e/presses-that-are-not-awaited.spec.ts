import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, gotoStages, openRound, openCustomize, centre, returnCard, saidBeside } from "./rounds-fixture";

/**
 * THE TWO PRESSES THAT DO NOT WAIT FOR THEIR ANSWER (master backlog J51, 2026-11-06).
 *
 * Two controls on the Rounds screen start a server action and walk away from it:
 *
 *   MatchTiebreakControl     `startTransition(() => void setMatchTiebreakers(next))`
 *   "Delete the round anyway" `startTransition(() => void removeStage(stage.id, true))`
 *
 * The `void` throws the answer away. When the action says yes nobody can tell, and these tests are
 * the proof that the yes is real: each press is read back from the DATABASE, not from the screen
 * (the match control sets its own list before the server has answered, so the screen would agree
 * with a save that never happened). When the action says no, the screen is left holding a change
 * that was refused. That half is `test.fixme` below, each with the evidence, because it is an app
 * defect (the press is not awaited) and this change touches no app code.
 *
 * Own club per test (`zz-unawaited-…`), invented names, `@example.invalid`, dropped in a `finally`.
 *
 * WHAT IT CANNOT SEE: a WebKit run (the Rounds screen is walked at laptop and phone size here).
 */

const WALKED = ["desktop", "phone"];
test.describe.configure({ timeout: 120_000 });
test.use({ actionTimeout: 15_000 });
test.afterAll(async () => {
  await prisma.$disconnect();
});

const markFor = (what: string, project: string) => `zz-unawaited-${what}-${project}`;

/** The standard countback over 18 holes, as `setMatchTiebreakers` stores it (`STANDARD_COUNTBACK`). */
const STANDARD = ["last-9", "last-6", "last-3", "last-1"];
const stored = async (eventId: string): Promise<string[]> =>
  JSON.parse((await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { matchTiebreakers: true } })).matchTiebreakers || "[]");

/** The round robin's card, opened, with the tie question's choices showing. */
async function openTieChoices(page: Page, stageId: string) {
  const card = await openRound(page, stageId);
  await openCustomize(card);
  const change = card.getByRole("button", { name: "Change: A match all square after 18" });
  await centre(change);
  await change.click();
  return card;
}

test("a halved match's countback, pressed three ways, is what the tournament stores", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("tie", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages } = await makeEvent(club, "Winter Groups", {
      stages: [{ type: "Round Robin", format: "Match Play", scoringBasis: "net" }],
      players: 4,
    });
    await signIn(context, baseURL!, club, event.id);
    // Read from the fixture: a new tournament stores nothing, so a halved match stays halved.
    expect(await stored(event.id), "the fixture's tournament already has a countback").toEqual([]);

    await gotoStages(page);
    const card = await openTieChoices(page, stages[0].id);

    // 1. The standard countback: stored, in the order the Rules give it.
    const standard = card.getByRole("button", { name: /Use the standard countback/ });
    await centre(standard);
    await standard.click();
    await expect.poll(() => stored(event.id), { message: "the standard countback was pressed and not stored" }).toEqual(STANDARD);

    // 2. A rung moved: the second goes earlier, and the stored order follows it.
    const earlier = card.getByRole("button", { name: /^Move .* earlier$/ });
    await centre(earlier.nth(1));
    await earlier.nth(1).click();
    await expect.poll(() => stored(event.id), { message: "moving a rung was pressed and not stored" }).toEqual([STANDARD[1], STANDARD[0], STANDARD[2], STANDARD[3]]);

    // 3. Leave matches halved: the ladder is emptied.
    const halved = card.getByRole("button", { name: "Leave matches halved", exact: true });
    await centre(halved);
    await halved.click();
    await expect.poll(() => stored(event.id), { message: "'Leave matches halved' was pressed and not stored" }).toEqual([]);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("deleting a round that holds a money record: the warning, then 'Delete the round anyway' really deletes it", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("del", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Autumn Medal", { stages: [{}, {}, {}], players: 4 });
    const [r1, r2] = stages;
    // A round with a CARD is not deleted at all since J12 PR 7b ("Round 1 has scores. Clear them on Score
    // entry first.", walked in `round-changes-after-scores.spec.ts`); a money record is what is asked about.
    await prisma.expense.create({ data: { eventId: event.id, stageId: r1.id, description: "zz cart hire", amountCents: 1200, paidBy: players[0].id } });
    await signIn(context, baseURL!, club, event.id);

    await gotoStages(page);
    await openRound(page, r1.id);
    const del = page.getByRole("button", { name: "Delete Round 1", exact: true });
    await centre(del);
    await del.click();
    // The first press only warns: the round and its record are still there.
    await expect(page.locator("b", { hasText: "Deleting this round destroys 1 money record" })).toBeVisible();
    expect(await prisma.stage.count({ where: { id: r1.id } }), "the first press deleted the round").toBe(1);

    // The second is the one that is not awaited.
    const anyway = page.getByRole("button", { name: "Delete the round anyway", exact: true });
    await centre(anyway);
    await anyway.click();
    await expect.poll(() => prisma.stage.count({ where: { id: r1.id } }), { message: "'Delete the round anyway' was pressed and the round is still there" }).toBe(0);
    // And only that round: the others, and the field, are untouched.
    expect(await prisma.stage.count({ where: { eventId: event.id } }), "more than one round went").toBe(2);
    expect(await prisma.stage.count({ where: { id: r2.id } })).toBe(1);
    expect(await prisma.player.count({ where: { eventId: event.id } }), "the field went with the round").toBe(4);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * A REFUSED PRESS IS SAID WHERE THE PRESS WAS. Both controls are drawn on an unlocked tournament, so
 * the way to a refusal is the one a second organizer makes: launch it in another tab (the tournament
 * becomes locked, `assertUnlocked` throws) and then press in the tab that was already open.
 *
 * FINDING, not fixed here: neither press reads the answer. `MatchTiebreakControl.tsx` sets its own
 * ladder before the server has answered, so a refused save leaves the screen showing the countback
 * and the database holding none; `StagesClient.tsx` closes the "destroys 1 entered card" warning
 * (`setRemoveCost(null)`) before the delete has answered, so a refused delete reads as done. Neither
 * says "Configuration is locked" anywhere on the screen. Marked `fixme` until the presses await.
 */
test.fixme("a countback pressed after the tournament was launched in another tab says it was refused", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const mark = markFor("tiel", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages } = await makeEvent(club, "Winter Groups", {
      stages: [{ type: "Round Robin", format: "Match Play", scoringBasis: "net" }],
      players: 4,
    });
    await signIn(context, baseURL!, club, event.id);
    await gotoStages(page);
    const card = await openTieChoices(page, stages[0].id);
    await prisma.event.update({ where: { id: event.id }, data: { status: "live", configUnlocked: false } });

    const standard = card.getByRole("button", { name: /Use the standard countback/ });
    await centre(standard);
    await standard.click();
    await saidBeside(page.getByText(/Configuration is locked/), standard, "a countback refused after launch");
    expect(await stored(event.id), "a refused save was stored").toEqual([]);
  } finally {
    await dropClub(mark);
  }
});

test.fixme("'Delete the round anyway' after the tournament was launched in another tab says it was refused", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const mark = markFor("dell", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Autumn Medal", { stages: [{}, {}, {}], players: 4 });
    const [r1] = stages;
    await returnCard(event.id, r1.id, players[0].id);
    await signIn(context, baseURL!, club, event.id);
    await gotoStages(page);
    await openRound(page, r1.id);
    await centre(page.getByRole("button", { name: "Delete Round 1", exact: true }));
    await page.getByRole("button", { name: "Delete Round 1", exact: true }).click();
    await expect(page.locator("b", { hasText: "Deleting this round destroys 1 entered card" })).toBeVisible();
    await prisma.event.update({ where: { id: event.id }, data: { status: "live", configUnlocked: false } });

    const anyway = page.getByRole("button", { name: "Delete the round anyway", exact: true });
    await anyway.click();
    await saidBeside(page.getByText(/Configuration is locked/), anyway, "a delete refused after launch");
    expect(await prisma.stage.count({ where: { id: r1.id } }), "a refused delete deleted the round").toBe(1);
  } finally {
    await dropClub(mark);
  }
});

/**
 * FINDING, not fixed here: `removeStage` deletes the Stage and leaves the round's Scorecard and
 * RoundHandicap rows behind (neither has a foreign key to Stage), so a deleted round's cards and
 * handicaps are orphaned. A separate change fixes the app; it un-fixmes this.
 */
test.fixme("deleting a round leaves none of its cards or handicaps behind", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const mark = markFor("orph", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Autumn Medal", { stages: [{}, {}, {}], players: 4 });
    const [r1] = stages;
    await returnCard(event.id, r1.id, players[0].id);
    await prisma.roundHandicap.create({ data: { eventId: event.id, stageId: r1.id, playerId: players[0].id } });
    await signIn(context, baseURL!, club, event.id);
    await gotoStages(page);
    await openRound(page, r1.id);
    await page.getByRole("button", { name: "Delete Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Delete the round anyway", exact: true }).click();
    await expect.poll(() => prisma.stage.count({ where: { id: r1.id } })).toBe(0);
    expect(await prisma.scorecard.count({ where: { stageId: r1.id } }), "the round went and its card stayed").toBe(0);
    expect(await prisma.roundHandicap.count({ where: { stageId: r1.id } }), "the round went and its handicaps stayed").toBe(0);
  } finally {
    await dropClub(mark);
  }
});
