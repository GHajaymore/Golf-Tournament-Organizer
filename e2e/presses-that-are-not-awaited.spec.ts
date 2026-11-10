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
 * with a save that never happened). When the action says no, the screen must say so where the press
 * was and not keep the change. That half is the second and third tests below: both presses now await
 * their answer (`caughtUp(await ...)`) and put the screen back, so they run (they were `test.fixme`
 * while the presses were `void`).
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
 * A REFUSED PRESS IS SAID WHERE THE PRESS WAS. The way to a refusal is the one a second organizer
 * makes: change the tournament in another tab, then press in the tab that was already open.
 *
 * The countback: launch the tournament elsewhere (the rounds scope locks, `refuseIfLocked`), then
 * press. `MatchTiebreakControl` awaits the answer, puts the ladder back and says the refusal.
 */
test("a countback pressed after the tournament was launched in another tab says it was refused", async ({ page, context, baseURL }, testInfo) => {
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
    // The lock's own words: "Locked because the tournament is live. ... to change the match tie-breakers."
    await saidBeside(card.getByRole("alert").filter({ hasText: /Locked because the tournament is live/ }), standard, "a countback refused after launch");
    expect(await stored(event.id), "a refused save was stored").toEqual([]);
  } finally {
    await dropClub(mark);
  }
});

/**
 * 'Delete the round anyway' refused. Launching no longer shuts a round's Delete (an undrawn round goes
 * on one press on a live tournament, J12 PR 7b), so the refusal a second tab can cause is the rounds
 * rule's: somebody returns a card for the round after the warning was drawn. The warning must give
 * way to the refusal, in words beside the Delete button, and the round and its card must stay.
 */
test("'Delete the round anyway' after a card was returned in another tab says it was refused", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const mark = markFor("dell", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Autumn Medal", { stages: [{}, {}, {}], players: 4 });
    const [r1] = stages;
    // A money record is what the first press warns about (a round with a card is refused outright).
    await prisma.expense.create({ data: { eventId: event.id, stageId: r1.id, description: "zz cart hire", amountCents: 1200, paidBy: players[0].id } });
    await signIn(context, baseURL!, club, event.id);
    await gotoStages(page);
    const card = await openRound(page, r1.id);
    const del = card.getByRole("button", { name: "Delete Round 1", exact: true });
    await centre(del);
    await del.click();
    await expect(page.locator("b", { hasText: "Deleting this round destroys 1 money record" })).toBeVisible();
    // Another tab: a card is returned for this round.
    await returnCard(event.id, r1.id, players[0].id);

    const anyway = page.getByRole("button", { name: "Delete the round anyway", exact: true });
    await anyway.click();
    const refused = card.getByRole("alert").filter({ hasText: "Round 1 has scores. Clear them on Score entry first." });
    await saidBeside(refused, del, "a delete refused after a card was returned");
    await expect(page.getByRole("button", { name: "Delete the round anyway", exact: true }), "the warning still offers the delete").toHaveCount(0);
    expect(await prisma.stage.count({ where: { id: r1.id } }), "a refused delete deleted the round").toBe(1);
    expect(await prisma.scorecard.count({ where: { stageId: r1.id } }), "the card went").toBe(1);
    expect(await prisma.expense.count({ where: { stageId: r1.id } }), "the money record went").toBe(1);
  } finally {
    await dropClub(mark);
  }
});

/**
 * A DELETED ROUND LEAVES NOTHING OF ITS OWN BEHIND. Scorecard and RoundHandicap carry a `stageId` and no
 * foreign key, so the cascade does not reach them; `purgeRound` (#1046) deletes them with the round.
 * Since J12 PR 7b a round holding a card is never deleted at all, so the card half is shown the other
 * way round: round 2's card keeps its round (the refusal), round 1 (handicaps, no card) goes whole.
 */
test("deleting a round leaves none of its cards or handicaps behind", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const mark = markFor("orph", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Autumn Medal", { stages: [{}, {}, {}], players: 4 });
    const [r1] = stages;
    const r2 = stages[1];
    await prisma.roundHandicap.create({ data: { eventId: event.id, stageId: r1.id, playerId: players[0].id } });
    await prisma.expense.create({ data: { eventId: event.id, stageId: r1.id, description: "zz cart hire", amountCents: 1200, paidBy: players[0].id } });
    await returnCard(event.id, r2.id, players[0].id);
    await prisma.roundHandicap.create({ data: { eventId: event.id, stageId: r2.id, playerId: players[1].id } });
    await signIn(context, baseURL!, club, event.id);
    await gotoStages(page);
    await openRound(page, r1.id);
    await page.getByRole("button", { name: "Delete Round 1", exact: true }).click();
    await page.getByRole("button", { name: "Delete the round anyway", exact: true }).click();
    await expect.poll(() => prisma.stage.count({ where: { id: r1.id } })).toBe(0);
    expect(await prisma.scorecard.count({ where: { stageId: r1.id } }), "the round went and its card stayed").toBe(0);
    expect(await prisma.roundHandicap.count({ where: { stageId: r1.id } }), "the round went and its handicaps stayed").toBe(0);
    expect(await prisma.expense.count({ where: { stageId: r1.id } }), "the round went and its expense stayed").toBe(0);
    // The round that holds a card is not deleted, so its card and handicaps cannot be orphaned.
    await gotoStages(page);
    const card2 = await openRound(page, r2.id);
    const del2 = card2.getByRole("button", { name: "Delete Round 2", exact: true });
    await centre(del2);
    await del2.click();
    await expect(card2.getByRole("alert").filter({ hasText: "Round 2 has scores." })).toBeVisible();
    expect(await prisma.stage.count({ where: { id: r2.id } })).toBe(1);
    expect(await prisma.scorecard.count({ where: { stageId: r2.id } }), "a refused delete took the card").toBe(1);
    expect(await prisma.roundHandicap.count({ where: { stageId: r2.id } }), "a refused delete took the handicaps").toBe(1);
  } finally {
    await dropClub(mark);
  }
});
