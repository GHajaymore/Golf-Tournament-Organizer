import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import {
  prisma,
  makeClub,
  dropClub,
  makeEvent,
  returnCard,
  signIn,
  gotoStages,
  openRound,
  openCustomize,
  saidBeside,
  pick,
  centre,
  addDays,
  dayIn,
  NAMES,
} from "./rounds-fixture";

/**
 * ROUNDS & FORMATS, SET UP AS A SECRETARY SETS IT UP — and each setting read
 * back from the database and from the screen after a reload.
 *
 * Seven of the round card's own actions had never been performed by any
 * browser test (the reach report, round G226-1): the format, the holes, the
 * day a round is played, dating a season in one go, the day cards are due and
 * closing or reopening a round's scoring, a cut taken per flight, and carrying
 * one round's handicap on to the rounds after it. Each test here builds the
 * club it needs and drops it afterwards:
 *
 *   format          a medal becomes a Stableford, which is off handicap and is
 *                   said so; a stroke round is not offered match play; a round
 *                   with a card in it ASKS first, beside the picker, and
 *                   "Keep Stroke Play" stores nothing
 *   holes           a nine counts back over the last six, three and one —
 *                   not the last nine; a round with cards asks first
 *   played on       the day moves; on the free Par plan a second week is
 *                   refused beside the date, and the box goes back
 *   season dates    every undated round is dated a week apart in running
 *                   order, a dated one is left alone; Par refuses a
 *                   fortnight beside the button
 *   cards in by and the club's DAY, not the server's: cards due today at the
 *   the scoring     club are still open there, due yesterday are closed;
 *   window          Keep it open, Close now and Follow the date, on a live
 *                   tournament whose setup is locked
 *   cut scope       the top two in each of two flights is four of eight
 *   handicap to     a figure for one round reaches the next eighteen-hole
 *   later rounds    round and NOT a nine (Rules of Handicapping 6.1: a course
 *                   handicap belongs to one length of round)
 *
 * WHAT IT CANNOT SEE: a card being scored off any of these (the boards are
 * held to the Rules by `boards-by-the-rules.spec.ts` and the stroke-cut by
 * `the-cut-a-round-is-played-for.spec.ts`), and which nine is played
 * (`setStageCourse`, not one of these actions).
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-rnf-${what}-${project}`;

test.describe.configure({ timeout: 150_000 });
// A press that cannot land says so in seconds, not at the end of the test's whole allowance.
test.use({ actionTimeout: 15_000 });
// From clean: a run killed inside a test leaves its club behind, and the next run should not trip on it.
test.beforeAll(async () => {
  await dropClub("zz-rnf-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

test("a round's format is changed on its card and kept, and a round with a card in it asks first", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("format", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Spring Medal", { stages: [{}, {}] });
    await signIn(context, baseURL!, club, event.id);
    const stored = async (i: number) => prisma.stage.findUniqueOrThrow({ where: { id: stages[i].id } });

    await gotoStages(page);
    let card = await openRound(page, stages[0].id);
    const picker = card.getByLabel("Format for Round 1");
    await expect(picker).toHaveValue("Stroke Play");
    // Only what a stroke round can be scored in: match play is a round robin's or a knockout's.
    const offered = await picker.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(offered, "a stroke round offers no Stableford").toContain("Stableford");
    expect(offered, "a stroke round is offered match play, which it cannot be scored in").not.toContain("Match Play");

    await picker.selectOption("Stableford");
    await expect.poll(async () => (await stored(0)).format, { message: "the format chosen was not stored" }).toBe("Stableford");
    // A Stableford is played off handicap (`basisFor`): stored net, and said so where Gross / Net was.
    expect((await stored(0)).scoringBasis, "a Stableford round was stored off scratch").toBe("net");

    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await expect(card.getByLabel("Format for Round 1"), "the format did not survive a reload").toHaveValue("Stableford");
    await expect(card.getByText(/Off handicap — points are worked out after each player/)).toBeVisible();
    await expect(card.getByRole("radiogroup", { name: "Handicap for Round 1" }), "a Stableford is offered Gross").toHaveCount(0);

    // ── a round with a card in it: asked, beside the picker, before anything is stored ──
    await returnCard(event.id, stages[1].id, players[0].id);
    await gotoStages(page);
    card = await openRound(page, stages[1].id);
    const second = card.getByLabel("Format for Round 2");
    await centre(second);
    await second.selectOption("Stableford");
    const asked = card.locator("b", { hasText: "This round already has 1 card entered." });
    await expect(asked, "re-scoring a played round was not asked about").toBeVisible();
    await expect(card.getByText(/Changing the format re-scores every one of them/)).toBeVisible();
    await saidBeside(asked, second, "the format of a round with a card in it");
    expect((await stored(1)).format, "the format was stored before the question was answered").toBe("Stroke Play");
    await card.getByRole("button", { name: "Keep Stroke Play", exact: true }).click();
    await expect(asked).toBeHidden();
    await expect(second, "declining left the picker on a format the round does not have").toHaveValue("Stroke Play");
    expect((await stored(1)).format, "declining stored the format").toBe("Stroke Play");

    await second.selectOption("Stableford");
    await card.getByRole("button", { name: "Change it anyway", exact: true }).click();
    await expect.poll(async () => (await stored(1)).format, { message: "Change it anyway stored nothing" }).toBe("Stableford");
    await gotoStages(page);
    card = await openRound(page, stages[1].id);
    await expect(card.getByLabel("Format for Round 2")).toHaveValue("Stableford");
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a round made nine holes counts back over a nine, and a round with cards asks before it changes", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("holes", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages, players } = await makeEvent(club, "Twilight Medal", { stages: [{}, {}] });
    await returnCard(event.id, stages[1].id, players[0].id);
    await returnCard(event.id, stages[1].id, players[1].id);
    await signIn(context, baseURL!, club, event.id);
    const holesOf = async (i: number) => (await prisma.stage.findUniqueOrThrow({ where: { id: stages[i].id } })).holes;
    const tieLine = (card: ReturnType<typeof page.locator>) => card.locator("span", { hasText: /^Level on the round/ }).first();

    await gotoStages(page);
    let card = await openRound(page, stages[0].id);
    await openCustomize(card);
    // Eighteen holes count back over the last nine, six, three and one.
    await expect(tieLine(card)).toContainText("the better last nine, then the last six, the last three and the last hole");
    await pick(card.getByRole("radiogroup", { name: "Holes for Round 1" }), "9");
    await expect.poll(() => holesOf(0), { message: "nine holes was not stored" }).toBe(9);

    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await expect(card.getByRole("radiogroup", { name: "Holes for Round 1" }).getByRole("radio", { name: "9", exact: true }), "nine holes did not survive a reload").toBeChecked();
    // A nine is played on one of the two nines, and the card says which.
    await expect(card.getByLabel("Which nine")).toHaveValue("front");
    // And a nine counts back over the last six, three and one — there is no "last nine" of a nine.
    await openCustomize(card);
    await expect(tieLine(card), "a nine-hole round's countback").toContainText("the better last six, then the last three and the last hole");
    await expect(tieLine(card)).not.toContainText("last nine");

    // ── the round with two cards in it ──
    card = await openRound(page, stages[1].id);
    const { label: nine } = await pick(card.getByRole("radiogroup", { name: "Holes for Round 2" }), "9");
    const asked = card.locator("b", { hasText: "This round already has 2 cards entered." });
    await expect(asked, "changing a played round's holes was not asked about").toBeVisible();
    await expect(card.getByText(/the stroke index is re-ranked to the holes actually played/)).toBeVisible();
    await saidBeside(asked, nine, "the holes of a round with cards in it");
    expect(await holesOf(1), "the holes were stored before the question was answered").toBe(18);
    await card.getByRole("button", { name: "Keep 18 holes", exact: true }).click();
    await expect(asked).toBeHidden();
    await expect(card.getByRole("radiogroup", { name: "Holes for Round 2" }).getByRole("radio", { name: "18", exact: true }), "declining left nine showing").toBeChecked();
    expect(await holesOf(1), "declining stored nine holes").toBe(18);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a round's day is moved, and on the free plan a day a week away is refused beside the date", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("played", testInfo.project.name);
  // A new club on the free plan, which the Par terms apply to: a tournament's rounds fall within seven days.
  const club = await makeClub(mark, { plan: "free", planTermsApply: true });
  try {
    const first = addDays(dayIn(""), 20);
    const { event, stages } = await makeEvent(club, "Captain’s Day", { stages: [{ playedOn: first }, {}] });
    await signIn(context, baseURL!, club, event.id);
    const playedOn = async (i: number) => (await prisma.stage.findUniqueOrThrow({ where: { id: stages[i].id } })).playedOn;

    await gotoStages(page);
    let card = await openRound(page, stages[0].id);
    const day1 = card.getByLabel("Date Round 1 is played");
    await expect(day1).toHaveValue(first);
    await day1.fill(addDays(first, 1));
    await expect.poll(() => playedOn(0), { message: "the new day was not stored" }).toBe(addDays(first, 1));
    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await expect(card.getByLabel("Date Round 1 is played"), "the day did not survive a reload").toHaveValue(addDays(first, 1));

    // ── a second round twelve days after the first: refused, and said beside the date ──
    card = await openRound(page, stages[1].id);
    const day2 = card.getByLabel("Date Round 2 is played");
    await centre(day2);
    await day2.fill(addDays(first, 13));
    const refused = card.getByRole("alert").filter({ hasText: "rounds fall within 7 days" });
    await expect(refused, "a date the plan refuses was not refused in words").toBeVisible();
    await saidBeside(refused, day2, "a date outside the free plan's week");
    await expect(day2, "the refused date stayed in the box").toHaveValue("");
    expect(await playedOn(1), "the refused date was stored").toBe("");

    // Within the week: kept.
    await day2.fill(addDays(first, 5));
    await expect.poll(() => playedOn(1), { message: "a date within the week was not stored" }).toBe(addDays(first, 5));
    await expect(refused, "the refusal stayed after an accepted date").toBeHidden();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("every undated round is dated in one go, in running order, and the free plan refuses a fortnight beside the button", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("season", testInfo.project.name);
  const parMark = markFor("season-par", testInfo.project.name);
  const club = await makeClub(mark);
  const par = await makeClub(parMark, { plan: "free", planTermsApply: true });
  try {
    const start = addDays(dayIn(""), 9);
    const fixed = addDays(start, 40);
    // Round 2 already has its day; Rounds 1 and 3 have none.
    const { event, stages } = await makeEvent(club, "Thursday League", { stages: [{}, { playedOn: fixed }, {}] });
    await signIn(context, baseURL!, club, event.id);
    const days = async () =>
      (await prisma.stage.findMany({ where: { eventId: event.id }, orderBy: { position: "asc" } })).map((s) => s.playedOn);

    await gotoStages(page);
    const notice = page.getByRole("button", { name: /2 rounds have no date/ });
    await expect(notice, "Rounds & formats does not say two rounds have no date").toBeVisible();
    await notice.click();
    await page.getByLabel("First round on").fill(start);
    await expect(page.getByLabel("How often")).toHaveValue("7");
    const go = page.getByRole("button", { name: "Date 2 rounds", exact: true });
    await go.click();
    // THE ANSWER IS SAID WHERE THE PRESS WAS (2026-10-21). It was drawn inside the notice "2 rounds
    // have no date", which dating removed, so it was never seen; the notice now stays as the answer.
    const said = page.getByRole("status").filter({ hasText: /^2 rounds dated, the first on .+\. Players now see them on their calendar\.$/ });
    await expect(said, "dating the rounds said nothing on the screen").toBeVisible({ timeout: 20_000 });
    await expect(said, "the answer is not where Date 2 rounds was pressed").toBeInViewport();
    // Running order, a week apart; the round that had a day keeps it.
    await expect.poll(days, { message: "the undated rounds were not dated a week apart, in order" }).toEqual([start, fixed, addDays(start, 7)]);
    // OK puts the answer away; the notice that was untrue is gone.
    await page.getByRole("link", { name: "OK", exact: true }).click();
    await expect(said).toHaveCount(0);

    await gotoStages(page);
    await expect(page.getByRole("button", { name: /rounds? (has|have) no date/ }), "the notice is still there with every round dated").toHaveCount(0);
    const r3 = await openRound(page, stages[2].id);
    await expect(r3.getByLabel("Date Round 3 is played"), "Round 3's day did not survive a reload").toHaveValue(addDays(start, 7));
    const r2 = await openRound(page, stages[1].id);
    await expect(r2.getByLabel("Date Round 2 is played"), "a round that had its day was moved").toHaveValue(fixed);

    // ── the free plan: a fortnight apart is refused, beside the button; a week is not ──
    const parEvent = await makeEvent(par, "Open Week", { stages: [{}, {}] });
    await signIn(context, baseURL!, par, parEvent.event.id);
    const parDays = async () =>
      (await prisma.stage.findMany({ where: { eventId: parEvent.event.id }, orderBy: { position: "asc" } })).map((s) => s.playedOn);
    await gotoStages(page);
    await page.getByRole("button", { name: /2 rounds have no date/ }).click();
    await page.getByLabel("First round on").fill(start);
    await page.getByLabel("How often").selectOption("14");
    const parGo = page.getByRole("button", { name: "Date 2 rounds", exact: true });
    await centre(parGo);
    await parGo.click();
    const refused = page.getByRole("alert").filter({ hasText: "rounds fall within 7 days" });
    await expect(refused, "a fortnight's season on the free plan was not refused in words").toBeVisible();
    await saidBeside(refused, parGo, "dating a season the free plan refuses");
    expect(await parDays(), "a refused season was stored").toEqual(["", ""]);

    await page.getByLabel("How often").selectOption("7");
    await parGo.click();
    await expect.poll(parDays, { message: "a week's season on the free plan was not dated" }).toEqual([start, addDays(start, 7)]);
  } finally {
    await dropClub(mark);
    await dropClub(parMark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("cards are due on the club's day, and a live round's scoring is kept open, closed early and put back", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("window", testInfo.project.name);
  // A club whose calendar day is not the server's right now, so a screen that asked the server what
  // day it is would draw a different answer from one that asked the club (CLAUDE.md, "The club's clock").
  const serverDay = dayIn("");
  const zone = ["Pacific/Kiritimati", "Pacific/Pago_Pago"].find((z) => dayIn(z) !== serverDay)!;
  const today = dayIn(zone);
  const yesterday = addDays(today, -1);
  testInfo.annotations.push({ type: "club clock", description: `${zone}: ${today} at the club, ${serverDay} at the server` });
  const club = await makeClub(mark, { timeZone: zone });
  try {
    // Live, and played YESTERDAY at the club: setup is locked, and both days the walk moves the
    // deadline between are on or after the round's own day, which is all a deadline may be
    // (`dueBeforePlayed`, 2026-10-30).
    const { event, stages } = await makeEvent(club, "Monthly Medal", { status: "live", stages: [{ playedOn: yesterday, deadline: yesterday }] });
    await signIn(context, baseURL!, club, event.id);
    const row = async () => prisma.stage.findUniqueOrThrow({ where: { id: stages[0].id } });
    const tag = (card: ReturnType<typeof page.locator>) => card.locator(".tag", { hasText: /Open —|Closed|Extended/ }).first();

    await gotoStages(page);
    let card = await openRound(page, stages[0].id);
    // Locked: the format is not offered to be changed. The day's controls are.
    await expect(card.getByLabel("Format for Round 1"), "a live tournament's format is offered for change").toBeDisabled();
    await expect(tag(card), "cards were due yesterday at the club").toHaveText(/Closed — the deadline has passed/);

    // ── Cards in by: today at the club is still open there ──
    await openCustomize(card);
    const due = card.getByLabel("Cards in by");
    await expect(due, "the day cards are due is behind the lock on a live round").toBeEnabled();
    await expect(due).toHaveValue(yesterday);
    await due.fill(today);
    await expect.poll(async () => (await row()).deadline, { message: "the day cards are due was not stored" }).toBe(today);
    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await expect(tag(card), `cards due ${today}, which is today at the club`).toHaveText(/Open — scores can be entered/);
    await openCustomize(card);
    await expect(card.getByLabel("Cards in by"), "the day cards are due did not survive a reload").toHaveValue(today);
    await card.getByLabel("Cards in by").fill(yesterday);
    await expect.poll(async () => (await row()).deadline).toBe(yesterday);
    await expect(tag(card)).toHaveText(/Closed — the deadline has passed/);

    // ── a day before the round is refused beside the box, and the box goes back ──
    await card.getByLabel("Cards in by").fill(addDays(yesterday, -1));
    await expect(card.getByText("That's before the round is played. Pick the round's day or later.")).toBeVisible();
    await expect(card.getByLabel("Cards in by"), "a refused date is left in the box as if it were kept").toHaveValue(yesterday);
    expect((await row()).deadline, "a deadline before the round's day was stored").toBe(yesterday);

    // ── the window: Keep it open, Close now, Follow the date ──
    await card.getByRole("button", { name: "Keep it open", exact: true }).click();
    await expect.poll(async () => (await row()).deadlineOverride, { message: "Keep it open stored nothing" }).toBe(false);
    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await expect(tag(card), "kept open past the day, after a reload").toHaveText(/Extended past the deadline/);
    await expect(card.getByText("Overriding the date", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "Close Round 1 now" }).click();
    await expect.poll(async () => (await row()).deadlineOverride, { message: "Close Round 1 now stored nothing" }).toBe(true);
    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await expect(tag(card), "closed early, after a reload").toHaveText(/Closed early by the organizer/);
    await expect(card.getByText("No further scores for this round, whatever the date says.")).toBeVisible();

    await card.getByRole("button", { name: "Follow the date", exact: true }).click();
    await expect.poll(async () => (await row()).deadlineOverride, { message: "Follow the date did not clear the override" }).toBe(null);
    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await expect(tag(card)).toHaveText(/Closed — the deadline has passed/);
    await expect(card.getByRole("button", { name: "Follow the date", exact: true }), "Follow the date is offered while already following it").toBeDisabled();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a cut taken per flight is the top two of each of two flights, and back across the field", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("cut", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const { event, stages } = await makeEvent(club, "Club Championship", { stages: [{}, {}], players: 8, flights: 2 });
    await signIn(context, baseURL!, club, event.id);
    const next = async () => prisma.stage.findUniqueOrThrow({ where: { id: stages[1].id } });

    await gotoStages(page);
    let card = await openRound(page, stages[0].id);
    await card.getByRole("checkbox", { name: "Cut the field for Round 2" }).check();
    await expect.poll(async () => (await next()).cutEnabled, { message: "the cut was not switched on" }).toBe(true);
    const count = card.getByLabel("Players who make the cut for Round 2");
    await count.fill("2");
    await count.blur();
    await expect.poll(async () => (await next()).cutCount).toBe(2);

    const where = card.getByRole("radiogroup", { name: "Where the cut for Round 2 applies" });
    await pick(where, "Per flight");
    await expect.poll(async () => (await next()).cutScope, { message: "Per flight was not stored" }).toBe("perFlight");
    // Two from each of two flights is four of the eight entered.
    const sentence = card.getByText(/The top 2 in each of 2 flights play Round 2 — 4 of the 8 entered/);
    await expect(sentence).toBeVisible();

    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await expect(card.getByRole("radiogroup", { name: "Where the cut for Round 2 applies" }).getByRole("radio", { name: "Per flight", exact: true }), "Per flight did not survive a reload").toBeChecked();
    await expect(card.getByText(/The top 2 in each of 2 flights play Round 2 — 4 of the 8 entered/)).toBeVisible();

    await pick(card.getByRole("radiogroup", { name: "Where the cut for Round 2 applies" }), "Overall");
    await expect.poll(async () => (await next()).cutScope, { message: "Overall was not stored" }).toBe("overall");
    await gotoStages(page);
    card = await openRound(page, stages[0].id);
    await expect(card.getByText(/^2 of the 8 entered play Round 2/)).toBeVisible();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a handicap set for one round is used in the later eighteen-hole round and not in a nine", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("hcp", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    // Two eighteens and a nine. A course handicap is strokes for one length of round (Rules of
    // Handicapping 6.1), so an eighteen-hole figure carried onto a nine would be the wrong number.
    const { event, stages, players } = await makeEvent(club, "Summer Series", { stages: [{}, {}, { holes: 9 }], players: 3 });
    await signIn(context, baseURL!, club, event.id);
    const who = players[1];
    const overrideIn = async (i: number) =>
      (await prisma.roundHandicap.findFirst({ where: { stageId: stages[i].id, playerId: who.id } }))?.override ?? null;
    const editorFor = async (card: ReturnType<typeof page.locator>) => {
      await openCustomize(card);
      const open = card.getByRole("button", { name: "Change a player's handicap", exact: true });
      await open.click();
      await card.getByRole("button", { name: `Change ${who.name}'s handicap`, exact: true }).click();
    };

    await gotoStages(page);
    let card = await openRound(page, stages[0].id);
    await editorFor(card);
    await card.getByRole("textbox", { name: "Strokes in Round 1", exact: true }).fill("14");
    await card.getByRole("button", { name: "Save for Round 1", exact: true }).click();
    await expect.poll(() => overrideIn(0), { message: "the round's figure was not stored" }).toBe(14);
    await expect(card.getByText(`Done. ${who.name} plays off 14 in Round 1.`)).toBeVisible();

    await card.getByRole("button", { name: `Change ${who.name}'s handicap`, exact: true }).click();
    const carry = card.getByRole("button", { name: "Use in later rounds too", exact: true });
    await carry.click();
    await expect.poll(() => overrideIn(1), { message: "the figure did not reach the next eighteen-hole round" }).toBe(14);
    expect(await overrideIn(2), "an eighteen-hole figure was carried onto a nine-hole round").toBe(null);
    // The nine is left for its length, and the sentence says so — it used to say "has cards in or is
    // on other tees", neither of which the nine is (2026-10-21).
    const said = card.getByRole("status").filter({
      hasText: "Set on 1 later round; 1 is on another course, other tees or a different number of holes, where these strokes mean something else.",
    });
    await expect(said, "the carry did not say what it did, or gave the wrong reason for the round it left").toBeVisible();
    await saidBeside(said, card.getByText(who.name, { exact: true }).first(), "what Use in later rounds too did");

    // Read back on the rounds themselves.
    await gotoStages(page);
    card = await openRound(page, stages[1].id);
    await openCustomize(card);
    await card.getByRole("button", { name: "Change a player's handicap", exact: true }).click();
    const line = card.locator("div", { has: page.locator("span", { hasText: who.name }) }).last();
    await expect(line, "Round 2 does not say the figure was set for it").toContainText("set for this round, in place of");
    card = await openRound(page, stages[2].id);
    await openCustomize(card);
    await card.getByRole("button", { name: "Change a player's handicap", exact: true }).click();
    const nineLine = card.locator("div", { has: page.locator("span", { hasText: who.name }) }).last();
    await expect(nineLine, "the nine says a figure was set for it").not.toContainText("set for this round");
    expect(NAMES).toContain(who.name);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
