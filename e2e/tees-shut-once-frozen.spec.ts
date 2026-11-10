import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, returnCard, signIn, centre, CARD_PARS, type Club } from "./rounds-fixture";

/**
 * A ROUND'S TEES ARE DRAWN SHUT ONCE ITS HANDICAPS ARE FROZEN — NOT OFFERED AND
 * THEN REFUSED (state machine PR 7b, J12; round G594-1, 10 Nov).
 *
 * The rule is the rounds rule's (`domain/round-change.ts`): a Course Handicap is
 * for one set of tees (Rules of Handicapping 6.1), a scored round's handicaps were
 * frozen off its tees at its first card, and the index they were frozen with is
 * not stored — so the round's own tees and course, and the tournament's tees
 * while they would reach it, are REFUSED after scores (option C, 8 Nov). The
 * console crawl found two screens that still OFFERED them and refused every pick
 * at the server: Score entry's Tees (`setStageCourse`) and Tournament details'
 * Played from (`setEventDefaultTee`). Seven findings, one kind.
 *
 * Walked as the Organizer, at a club course with three rated sets:
 *
 *   a LIVE medal, Round 1 with every card in, Round 2 with none
 *     Score entry · Round 1   → Tees drawn shut, the sentence under it: "Round 1’s
 *                               handicaps were frozen off its tees at its first card.
 *                               Clear Round 1’s scores on Score entry first."
 *     Score entry · Round 2   → Tees pressable; Blue is stored on the round
 *     Tournament details      → Played from drawn shut, the same sentence under it
 *   a LIVE medal with no card anywhere
 *     Tournament details      → Played from pressable; Blue is stored on Save settings
 *     Score entry · Round 1   → Tees pressable, nothing said
 *   a COMPLETED medal
 *     Score entry · Round 1   → Tees drawn shut: "The tournament is completed, so its
 *                               rounds are final. An Organizer can reopen it on the
 *                               dashboard." (the crawl's third shard, on "champs")
 *
 * The sentences are written out here, not taken from the app, so the words the
 * organizer reads are what is held. The server's refusal stays the backstop: it is
 * held on real rows by `round-changes-after-play.audit.test.ts`.
 *
 * Own zz-marked club (`zz-teesshut-…`), invented names, `@example.invalid`, dropped
 * in `afterAll`. Service workers blocked (a save spec's rule on WebKit). Memory: one
 * context and one page at a time, about 150 MB.
 *
 * WHAT IT CANNOT SEE: a flight's tees (Flights & groups) and one player's
 * (Registration), which ask the same rule at the server and are not yet drawn
 * from it — named in the PR as a finding.
 */

const WALKED = ["desktop", "phone"];
let club: Club;
const markFor = (project: string) => `zz-teesshut-${project}`;

const FROZEN = "Round 1’s handicaps were frozen off its tees at its first card. Clear Round 1’s scores on Score entry first.";
const COMPLETED = "The tournament is completed, so its rounds are final. An Organizer can reopen it on the dashboard.";
/** A stroke index to go with the fixture's pars — invented, every hole once. */
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];

test.beforeAll(async ({}, testInfo) => {
  if (!WALKED.includes(testInfo.project.name)) return;
  await dropClub(markFor(testInfo.project.name));
  club = await makeClub(markFor(testInfo.project.name));
});

test.afterAll(async ({}, testInfo) => {
  try {
    if (WALKED.includes(testInfo.project.name)) await dropClub(markFor(testInfo.project.name));
  } finally {
    await prisma.$disconnect();
  }
});

/** The club's own course with three rated sets — the rounds fixture makes none. */
async function ratedCourse(c: Club) {
  const course = await prisma.course.create({
    data: {
      organizationId: c.orgId,
      name: `${c.mark} Hollins Moss`,
      pars: JSON.stringify(CARD_PARS),
      yards: JSON.stringify(CARD_PARS.map((p) => p * 100)),
      strokeIndex: JSON.stringify(SI),
    },
  });
  const set = (name: string, courseRating: number, slopeRating: number, position: number, gender = "any") =>
    prisma.tee.create({ data: { courseId: course.id, name, courseRating, slopeRating, par: 72, position, gender } });
  const [blue, white, red] = await Promise.all([set("Blue", 72.4, 134, 0), set("White", 70.1, 127, 1), set("Red", 71.0, 120, 2, "women")]);
  return { course, blue, white, red };
}

/** A medal at that course, off the Whites: two rounds, four entered. */
async function medalAt(c: Club, name: string, status: string, at: Awaited<ReturnType<typeof ratedCourse>>) {
  const made = await makeEvent(c, name, {
    status,
    configUnlocked: false,
    stages: [{}, {}],
    players: 4,
    event: { courseId: at.course.id, defaultTeeId: at.white.id, course: at.course.name },
  });
  await prisma.eventCourse.create({ data: { eventId: made.event.id, courseId: at.course.id } });
  return made;
}

/** Score entry, opened on one round. */
async function entryOn(page: Page, stageId: string) {
  await page.goto(`/entry?round=${stageId}&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("main h1")).toBeVisible();
  // The Tees box sits in a label with the words beside it; the venue picker above is a combobox, not a select.
  const tees = page.locator("main label").filter({ hasText: "decides the shots" }).locator("select");
  await expect(tees, "Score entry draws no Tees box for this round").toHaveCount(1);
  await centre(tees);
  return tees;
}

/** Tournament details, scrolled to Played from. */
async function playedFrom(page: Page) {
  await page.goto(`/event?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const box = page.locator("#default-tee");
  await expect(box, "Tournament details draws no Played from").toHaveCount(1);
  await centre(box);
  return box;
}

test("a scored round's tees are drawn shut with the reason; an unscored round's are pressed and stored", async ({ browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  test.setTimeout(180_000);
  const at = await ratedCourse(club);
  // CONTROLS on the fixture, read back rather than assumed: three sets, all rated, so the box is drawn.
  const sets = await prisma.tee.findMany({ where: { courseId: at.course.id } });
  expect(sets.map((t) => t.name).sort()).toEqual(["Blue", "Red", "White"]);
  expect(sets.every((t) => t.slopeRating > 0), "a set is unrated").toBe(true);

  const scored = await medalAt(club, "Scored Medal", "live", at);
  const [r1, r2] = scored.stages;
  for (const p of scored.players) await returnCard(scored.event.id, r1.id, p.id);
  expect(await prisma.scorecard.count({ where: { stageId: r1.id } }), "Round 1 has no cards").toBe(scored.players.length);
  expect(await prisma.scorecard.count({ where: { stageId: r2.id } }), "Round 2 has cards").toBe(0);
  const fresh = await medalAt(club, "Fresh Medal", "live", at);

  const errors: string[] = [];
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    watchPageErrors(page, errors, "organizer");

    // ── the scored medal ────────────────────────────────────────────────────
    await signIn(context, baseURL!, club, scored.event.id);

    // Round 1: shut before anybody presses, and the sentence under it.
    let tees = await entryOn(page, r1.id);
    await expect(tees, "Score entry offers Tees on a round whose handicaps are frozen").toBeDisabled();
    const door = page.getByTestId("tees-door");
    await expect(door).toContainText(FROZEN);
    await expect(door).toBeInViewport();

    // Round 2, the same tournament: no card, so its own tees still change.
    tees = await entryOn(page, r2.id);
    await expect(tees, "Score entry shut the Tees of a round with no card").toBeEnabled();
    await expect(page.getByTestId("tees-door")).toHaveCount(0);
    await tees.selectOption({ label: "Blue" });
    await expect
      .poll(async () => (await prisma.stage.findUniqueOrThrow({ where: { id: r2.id } })).teeId, { timeout: 20_000, message: "Round 2's tees were not stored" })
      .toBe(at.blue.id);

    // Tournament details: the tournament's tees reach Round 1, so Played from is shut, said under it.
    let box = await playedFrom(page);
    await expect(box, "Played from is offered while a scored round would be reached").toBeDisabled();
    await expect(page.getByTestId("default-tee-door")).toContainText(FROZEN);
    await expect(page.getByTestId("default-tee-door")).toBeInViewport();
    expect((await prisma.event.findUniqueOrThrow({ where: { id: scored.event.id } })).defaultTeeId).toBe(at.white.id);

    // ── the medal with no card anywhere ─────────────────────────────────────
    await context.clearCookies();
    await signIn(context, baseURL!, club, fresh.event.id);
    box = await playedFrom(page);
    await expect(box, "Played from is shut on a tournament with no card").toBeEnabled();
    await expect(page.getByTestId("default-tee-door")).toHaveCount(0);
    await box.selectOption(at.blue.id);
    const save = page.getByRole("button", { name: /^Save settings/ }).first();
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: fresh.event.id } })).defaultTeeId, { timeout: 20_000, message: "Played from was not stored" })
      .toBe(at.blue.id);
    await expect(page.getByRole("alert").filter({ hasText: "frozen off its tees" }), "Save was refused on a tournament with no card").toHaveCount(0);

    tees = await entryOn(page, fresh.stages[0].id);
    await expect(tees, "Score entry shut the Tees on a tournament with no card").toBeEnabled();
    await expect(page.getByTestId("tees-door")).toHaveCount(0);

    expect(errors, "the page threw").toEqual([]);
  } finally {
    await context.close();
  }
});

test("a completed tournament's round tees are drawn shut, with Reopen as the way out", async ({ browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  test.setTimeout(120_000);
  const at = await ratedCourse(club);
  const done = await medalAt(club, "Finished Medal", "completed", at);
  // Read from the fixture: completed, and no card at all — so it is the completion that shuts it.
  expect((await prisma.event.findUniqueOrThrow({ where: { id: done.event.id } })).status).toBe("completed");
  expect(await prisma.scorecard.count({ where: { eventId: done.event.id } })).toBe(0);

  const errors: string[] = [];
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
  await signIn(context, baseURL!, club, done.event.id);
  try {
    const page = await context.newPage();
    watchPageErrors(page, errors, "organizer");
    const tees = await entryOn(page, done.stages[0].id);
    await expect(tees, "Score entry offers Tees on a completed tournament").toBeDisabled();
    await expect(page.getByTestId("tees-door")).toContainText(COMPLETED);
    expect(errors, "the page threw").toEqual([]);
  } finally {
    await context.close();
  }
});
