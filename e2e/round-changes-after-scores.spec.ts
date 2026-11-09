import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, returnCard, signIn, gotoStages, openRound, centre, saidBeside, type Club } from "./rounds-fixture";

/**
 * A ROUND CHANGED ONCE THE TOURNAMENT IS UNDER WAY, judged by what the change
 * would invalidate — the upstream-change rules for the rounds and format (J12,
 * state machine PR 7b; section 3's table, the Golf Pro's Q2 and Q5, the panel's
 * summary item 10). Walked as the Organizer on Rounds & formats, on a LAUNCHED
 * medal of two rounds, Round 1 with every card in and Round 2 not yet played:
 *
 *   the banner              → "Under way": a round's format, holes, allowance, tees, day
 *                             change until it has scores — not "everything is locked"
 *   Round 2 (no scores)     → its format changes on one press, launched
 *   Round 1 (scored)        → its Format picker is shut, the reason under it: "Round 1
 *                             was scored as Stroke Play; its cards would mean something
 *                             else. Clear its scores on Score entry first." — and its
 *                             Holes the same (8 Nov: holes are format-like)
 *   Round 1 · allowance 85  → ASKED first, in the Golf Pro's words ("This changes a term
 *                             of the competition after play. Every net score in Round 1
 *                             (4 cards) is worked out again. Money is final-only, so
 *                             nothing paid changes."); nothing stored until Change it
 *                             anyway; then stored, and Recent changes holds the line
 *                             with whose playing handicap moved
 *   Round 1 · Delete        → refused where the press was: "Round 1 has scores. Clear
 *                             them on Score entry first." The round is still there.
 *   Round 2 · Delete        → an undrawn round goes on one press, launched
 *
 * And a round of MATCHES with a result recorded: its Net/Gross choice is shut, the
 * reason under it — a decided match is not worked out again.
 *
 * Own zz-marked club (`zz-j12rounds-…`), invented names, `@example.invalid`, dropped in
 * `afterAll`. Service workers blocked (a save spec's rule on WebKit). Memory: one
 * context and one page at a time, about 150 MB.
 *
 * WHAT IT CANNOT SEE: a tee change after play (the tees screens need a rated course the
 * rounds fixture does not make) and the recompute's figures by the Rules — both held on
 * real rows by `round-changes-after-play.audit.test.ts`, and the arithmetic by
 * `matrix.test.ts` ("an allowance changed after play").
 */

const WALKED = ["desktop", "phone"];
let club: Club;
const markFor = (project: string) => `zz-j12rounds-${project}`;

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

test("a launched medal: an unplayed round changes, a played one asks first or refuses, where the press was", async ({ browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  test.setTimeout(180_000);
  // Launched and locked, as `launchTournament` leaves it. Two rounds; four entered.
  const made = await makeEvent(club, "Autumn Medal", { status: "live", configUnlocked: false, stages: [{}, {}], players: 4 });
  const eventId = made.event.id;
  const [r1, r2] = made.stages;
  // Read from the fixture, never assumed: a net medal at the format's own allowance.
  expect(r1.scoringBasis, "the fixture's Round 1 is not a net medal").toBe("net");
  expect(r1.handicapAllowance, "the fixture's Round 1 carries a committee allowance").toBe(0);
  for (const p of made.players) await returnCard(eventId, r1.id, p.id);
  const cards = made.players.length;
  const stage = (id: string) => prisma.stage.findUnique({ where: { id } });

  const errors: string[] = [];
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
  await signIn(context, baseURL!, club, eventId);
  try {
    const page = await context.newPage();
    watchPageErrors(page, errors, "organizer");
    await gotoStages(page);

    // ── the banner says what is still open, not only what is locked ────────
    const banner = page.getByRole("region", { name: "Locked" });
    await expect(banner).toContainText("Until a round has scores, its format, holes, allowance, tees and day can change.");
    await expect(banner).toContainText("Locked because the tournament is live.");

    // ── Round 2, unplayed: its format changes on one press, launched ───────
    let card = await openRound(page, r2.id);
    const format2 = card.getByLabel("Format for Round 2");
    await centre(format2);
    await expect(format2, "an unplayed round's format is shut by launch").toBeEnabled();
    await format2.selectOption("Stableford");
    await expect.poll(async () => (await stage(r2.id))?.format, { timeout: 20_000, message: "Round 2's format was not stored" }).toBe("Stableford");

    // ── Round 1, played: the format is shut, and says why ──────────────────
    await gotoStages(page);
    card = await openRound(page, r1.id);
    const format1 = card.getByLabel("Format for Round 1");
    await centre(format1);
    await expect(format1, "a played round's format is offered").toBeDisabled();
    const door = card.getByTestId("format-door");
    await expect(door).toHaveText("Round 1 was scored as Stroke Play; its cards would mean something else. Clear its scores on Score entry first.");
    await saidBeside(door, format1, "a played round's format");
    // Its holes too (8 Nov: holes are format-like) — shut, the reason said beside them.
    const holes1 = card.getByRole("radiogroup", { name: "Holes for Round 1" });
    await expect(holes1.getByRole("radio", { name: "9", exact: true }), "a played round's holes are offered").toBeDisabled();
    await expect(card.getByTestId("holes-door")).toHaveText("Round 1 has scores; at another length its cards would mean something else. Clear its scores on Score entry first.");

    // ── Round 1's allowance: asked first, in the Golf Pro's words ───────────
    const change = card.locator("div", { has: page.locator("p", { hasText: /^Handicap allowance/ }) }).last().getByRole("button", { name: "Change", exact: true });
    await centre(change);
    await change.click();
    const box = card.getByLabel("Handicap allowance percent");
    await box.fill("85");
    const save = card.getByRole("button", { name: "Save", exact: true });
    await expect(save, "a played round's allowance is shut").toBeEnabled();
    await save.click();
    const asked = card.getByText(
      `This changes a term of the competition after play. Every net score in Round 1 (${cards} cards) is worked out again. Money is final-only, so nothing paid changes.`,
    );
    await expect(asked, "the term changed after play was not asked about").toBeVisible({ timeout: 20_000 });
    await saidBeside(asked, save, "the allowance of a played round", 260);
    expect((await stage(r1.id))?.handicapAllowance, "stored before the question was answered").toBe(0);
    await card.getByRole("button", { name: "Change it anyway", exact: true }).click();
    await expect.poll(async () => (await stage(r1.id))?.handicapAllowance, { timeout: 20_000, message: "Change it anyway stored nothing" }).toBe(85);
    // Recomputed and logged: one line, saying what changed and how many cards were worked out again.
    const line = await prisma.auditLog.findFirst({ where: { eventId, action: "round.recomputed" }, orderBy: { createdAt: "desc" } });
    expect(line?.detail, "Recent changes has no line for the term changed after play").toContain(`Round 1: handicap allowance 95% → 85% after play. ${cards} cards in Round 1 worked out again`);

    // ── Round 1's Delete: refused where the press was ───────────────────────
    await gotoStages(page);
    card = await openRound(page, r1.id);
    const del1 = card.getByRole("button", { name: "Delete Round 1", exact: true });
    await centre(del1);
    await del1.click();
    const refused = card.getByRole("alert").filter({ hasText: "Round 1 has scores. Clear them on Score entry first." });
    await expect(refused).toBeVisible({ timeout: 20_000 });
    await saidBeside(refused, del1, "deleting a played round", 260);
    expect(await prisma.stage.count({ where: { id: r1.id } }), "a played round was deleted").toBe(1);

    // ── Round 2's Delete: an undrawn round goes on one press, launched ──────
    await gotoStages(page);
    card = await openRound(page, r2.id);
    const del2 = card.getByRole("button", { name: "Delete Round 2", exact: true });
    await centre(del2);
    await del2.click();
    await expect.poll(() => prisma.stage.count({ where: { id: r2.id } }), { timeout: 20_000, message: "an undrawn round was not deleted" }).toBe(0);

    expect(errors, "the page threw").toEqual([]);
  } finally {
    await context.close();
  }
});

test("a round of matches with a result recorded keeps its Net or Gross: the choice is shut and says why", async ({ browser, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  test.setTimeout(120_000);
  const made = await makeEvent(club, "Winter Groups", {
    status: "live",
    configUnlocked: false,
    stages: [{ type: "Round Robin", format: "Match Play" }],
    players: 4,
    flights: 1,
  });
  const eventId = made.event.id;
  const [rr] = made.stages;
  const [a, b] = made.players;
  // One match with holes recorded — a result, read back as the machine reads it.
  await prisma.match.create({ data: { eventId, stageId: rr.id, groupId: made.flights[0].id, round: 1, playerAId: a.id, playerBId: b.id, holes: JSON.stringify(["A", "H", "B"]) } });

  const errors: string[] = [];
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
  await signIn(context, baseURL!, club, eventId);
  try {
    const page = await context.newPage();
    watchPageErrors(page, errors, "organizer");
    await gotoStages(page);
    const card = await openRound(page, rr.id);
    const choice = card.getByRole("radiogroup", { name: "Handicap for Round 1" });
    await centre(choice);
    for (const name of ["Net", "Gross"]) {
      await expect(choice.getByRole("radio", { name, exact: true }), `${name} is offered on a round of recorded matches`).toBeDisabled();
    }
    await expect(card.getByText("Round 1’s matches were played off these strokes. Clear its scores on Score entry first.").first()).toBeVisible();
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: rr.id } })).scoringBasis).toBe("net");
    expect(errors, "the page threw").toEqual([]);
  } finally {
    await context.close();
  }
});
