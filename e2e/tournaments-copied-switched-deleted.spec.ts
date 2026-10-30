import { test, expect, type Page } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { prisma, makeClub, dropClub, makeEvent, signIn, returnCard, centre, saidBeside, NAMES } from "./rounds-fixture";

/**
 * A SECRETARY'S TOURNAMENTS: last year's copied, the old one opened again, and
 * a practice one deleted — on "Your tournaments", as the secretary does it.
 *
 * `cloneEvent`, `switchEvent` and `deleteEvent` were performed by no browser
 * test (the reach baseline, 2026-10-21):
 *
 *   a copy        "Start from: Spring Medal" copies the SETUP — both rounds with
 *                 their format, holes and basis, the course card — and none of
 *                 the field, the cards or the money; it starts as a draft with
 *                 no dates, and the secretary is taken into it
 *   Manage        opens the other tournament: the console is in it, and its
 *                 field is the one shown
 *   on Par        a club on the free plan runs one tournament at a time, so the
 *                 copy is REFUSED, said beside Create, and nothing is made
 *   delete        asked first ("Keep" deletes nothing); then the tournament and
 *                 every row of it is gone — field, rounds, cards, pot — and the
 *                 club's other tournament is exactly as it was
 *
 * WHAT IT CANNOT SEE: a tournament switched from the clash notice
 * (`TournamentClashNotice`, which goes on to a screen of its own choosing), and
 * what `clone.ts` carries field by field — `clone.test.ts` holds the lists.
 */

const WALKED = ["desktop", "phone"];
const markFor = (what: string, project: string) => `zz-tcs-${what}-${project}`;

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  await dropClub("zz-tcs-").catch(() => {});
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

async function openTournaments(page: Page) {
  await page.goto(`/tournaments?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(new URL(page.url()).pathname, "sent away from Your tournaments — not signed in?").toBe("/tournaments");
}

async function playedMedal(club: Awaited<ReturnType<typeof makeClub>>, name: string, status = "completed") {
  const made = await makeEvent(club, name, {
    status,
    stages: [
      { format: "Stroke Play", holes: 18, scoringBasis: "net", playedOn: "2026-04-11" },
      { format: "Stroke Play", holes: 9, scoringBasis: "gross", playedOn: "2026-04-12" },
    ],
    players: 4,
  });
  for (const p of made.players) await returnCard(made.event.id, made.stages[0].id, p.id);
  const pot = await prisma.skinsPot.create({ data: { eventId: made.event.id, stageId: made.stages[0].id, buyInCents: 500, net: true } });
  await prisma.skinsEntry.createMany({ data: made.players.map((p) => ({ potId: pot.id, playerId: p.id })) });
  return made;
}

test("last year's medal is copied without its field, cards or money, and Manage opens the old one again", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("copy", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const spring = await playedMedal(club, "Spring Medal");
    const springName = spring.event.name;
    const copyName = `${mark} Autumn Medal`;
    await signIn(context, baseURL!, club, spring.event.id);

    await openTournaments(page);
    await page.getByLabel("Create a new tournament", { exact: true }).fill(copyName);
    const from = page.getByLabel("Start from", { exact: true });
    await from.selectOption({ label: springName });
    await expect(page.getByText(/Copies the settings, rounds and courses from .*Spring Medal — never its players, scores or access codes\./)).toBeVisible();
    const create = page.getByRole("button", { name: "Create tournament" });
    await centre(create);
    await create.click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    const copy = await prisma.event.findFirst({ where: { organizationId: club.orgId, name: copyName }, include: { stages: { orderBy: { position: "asc" } } } });
    expect(copy, "no tournament was made by the copy").toBeTruthy();
    // The setup: both rounds, as they were.
    expect(
      copy!.stages.map((s) => ({ type: s.type, format: s.format, holes: s.holes, basis: s.scoringBasis })),
      "the copy's rounds are not the medal's rounds",
    ).toEqual(spring.stages.map((s) => ({ type: s.type, format: s.format, holes: s.holes, basis: s.scoringBasis })));
    expect({ pars: copy!.customPars, si: copy!.customStrokeIndex }).toEqual({ pars: spring.event.customPars, si: spring.event.customStrokeIndex });
    // Not the field, the cards or the money — and a new tournament, not last year's running on.
    expect(await prisma.player.count({ where: { eventId: copy!.id } }), "the copy carried the field").toBe(0);
    expect(await prisma.scorecard.count({ where: { eventId: copy!.id } }), "the copy carried cards").toBe(0);
    expect(await prisma.skinsPot.count({ where: { eventId: copy!.id } }), "the copy carried the skins money").toBe(0);
    expect({ status: copy!.status, dates: copy!.dates, sameLink: copy!.shareToken === spring.event.shareToken }).toEqual({
      status: "draft",
      dates: "",
      sameLink: false,
    });
    // The medal itself is untouched.
    expect(await prisma.scorecard.count({ where: { eventId: spring.event.id } })).toBe(4);

    // The secretary is IN the copy: its field is empty, its rounds are the medal's.
    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.locator("main h1"), "the copy's Entries screen did not open").toBeVisible();
    await expect(page.locator("main").getByText(NAMES[0]), "the copy's entries show last year's field").toHaveCount(0);

    // ── Manage: back into the medal ──
    await openTournaments(page);
    const manage = page.getByRole("button", { name: `Manage ${springName}`, exact: true });
    await centre(manage);
    await manage.click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await openTournaments(page);
    const springRow = page.locator("tbody tr").filter({ hasText: springName });
    await expect(springRow.getByText("Managing", { exact: true }), "Manage did not make the medal the tournament being run").toBeVisible();
    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    // The control for the empty field above: the same words find the medal's entry here.
    await expect(page.locator("main").getByText(NAMES[0]).first(), "after Manage, the medal's field is not the one shown").toBeVisible();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("on the free plan a second tournament is refused beside Create, and nothing is made", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("par", testInfo.project.name);
  const club = await makeClub(mark, { plan: "free", planTermsApply: true });
  try {
    const { event } = await makeEvent(club, "Club Championship", { stages: [{}], players: 4 });
    await signIn(context, baseURL!, club, event.id);
    await openTournaments(page);
    await page.getByLabel("Create a new tournament", { exact: true }).fill(`${mark} Championship again`);
    await page.getByLabel("Start from", { exact: true }).selectOption({ label: event.name });
    const create = page.getByRole("button", { name: "Create tournament" });
    await centre(create);
    await create.click();
    const refused = page.locator(".form-error").filter({ hasText: /\S/ });
    await expect(refused, "a second tournament on the free plan was not refused in words").toBeVisible({ timeout: 20_000 });
    await saidBeside(refused, create, "a copy past the free plan's one tournament");
    expect(new URL(page.url()).pathname, "a refused copy still moved the secretary on").toBe("/tournaments");
    expect(await prisma.event.count({ where: { organizationId: club.orgId } }), "the refused copy was made anyway").toBe(1);
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a practice tournament is deleted only when asked twice, with every row of it, and nothing of the other", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("del", testInfo.project.name);
  const club = await makeClub(mark);
  try {
    const keep = await playedMedal(club, "Club Championship", "live");
    const practice = await playedMedal(club, "Practice Day", "registration");
    await signIn(context, baseURL!, club, keep.event.id);
    const rowsOf = async (eventId: string) => ({
      event: await prisma.event.count({ where: { id: eventId } }),
      players: await prisma.player.count({ where: { eventId } }),
      rounds: await prisma.stage.count({ where: { eventId } }),
      cards: await prisma.scorecard.count({ where: { eventId } }),
      pots: await prisma.skinsPot.count({ where: { eventId } }),
    });
    const whole = { event: 1, players: 4, rounds: 2, cards: 4, pots: 1 };
    expect(await rowsOf(practice.event.id)).toEqual(whole);

    await openTournaments(page);
    const name = practice.event.name;
    const bin = page.getByRole("button", { name: `Delete ${name}`, exact: true });
    await centre(bin);
    await bin.click();
    // Asked first — and keeping it keeps it.
    await expect(page.getByRole("button", { name: `Delete ${name} for good`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Keep ${name}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Delete ${name} for good`, exact: true })).toHaveCount(0);
    expect(await rowsOf(practice.event.id), "Keep deleted something").toEqual(whole);

    await bin.click();
    await page.getByRole("button", { name: `Delete ${name} for good`, exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect
      .poll(() => rowsOf(practice.event.id), { message: "the deleted tournament left rows behind" })
      .toEqual({ event: 0, players: 0, rounds: 0, cards: 0, pots: 0 });
    expect(await rowsOf(keep.event.id), "deleting one tournament touched the other").toEqual(whole);
    expect(await prisma.organization.count({ where: { id: club.orgId } }), "deleting a tournament took the club").toBe(1);

    await openTournaments(page);
    await expect(page.locator("tbody tr").filter({ hasText: name }), "the deleted tournament is still listed").toHaveCount(0);
    await expect(page.locator("tbody tr").filter({ hasText: keep.event.name }), "the other tournament is not listed").toHaveCount(1);
    await expect(page.getByText("1 total", { exact: true })).toBeVisible();
  } finally {
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

/**
 * THE LIST READS TRUE AND LINES UP (Ajay, 2026-10-26, on his own list):
 *
 *   alignment     the bin was drawn only on rows its reader could delete, so
 *                 Manage sat further right on every other row
 *   not deletable a row with no bin said nothing about why; now the bin is
 *                 there and, pressed, says only an organizer may delete it
 *   dates passed  a draft a month after its last day read "Draft"
 *   same name     two tournaments called the same could not be told apart
 *   what goes     the question before deleting says the players and scores go too
 */
test("the list lines up, says why a tournament cannot be deleted, and reads true about dates and names", async ({ page, context, baseURL }, testInfo) => {
  test.skip(!WALKED.includes(testInfo.project.name), "walked at laptop and phone size");
  const errors: string[] = [];
  watchPageErrors(page, errors, "secretary");
  const mark = markFor("rows", testInfo.project.name);
  const away = `${mark}-away`;
  const club = await makeClub(mark);
  const other = await makeClub(away);
  try {
    const live = await makeEvent(club, "Club Championship", { status: "live", stages: [{}], players: 2 });
    const passed = await makeEvent(club, "Summer Matchplay", {
      stages: [{}],
      players: 3,
      event: { startOn: "2025-07-30", endOn: "2025-09-26", dates: "30 Jul – 26 Sep 2025" },
    });
    const twinA = await makeEvent(club, "Spring Medal", { stages: [{}] });
    const twinB = await makeEvent(club, "Spring Medal", { stages: [{}] });
    await prisma.event.update({ where: { id: twinA.event.id }, data: { createdAt: new Date("2026-03-02T12:00:00Z") } });
    await prisma.event.update({ where: { id: twinB.event.id }, data: { createdAt: new Date("2026-04-06T12:00:00Z") } });
    // Another club's tournament the secretary helps with, and may not delete.
    const fixture = await makeEvent(other, "Away Fixture", { stages: [{}] });
    await prisma.account.create({
      data: { eventId: fixture.event.id, name: "Rowan Secretary", email: `${mark}-secretary@example.invalid`, role: "assistant" },
    });
    await signIn(context, baseURL!, club, live.event.id);
    await openTournaments(page);
    const row = (name: string) => page.locator("tbody tr").filter({ hasText: name });

    // ── the status says what is true ──
    await expect(row("Summer Matchplay").locator(".tag")).toHaveText("Dates passed, not launched");
    await expect(row("Club Championship").locator(".tag").first()).toHaveText("Live");
    await expect(row("Away Fixture").locator(".tag")).toHaveText("Draft");

    // ── two of one name are told apart, and a name used once is not dated ──
    const twins = row("Spring Medal");
    await expect(twins).toHaveCount(2);
    const said = await twins.locator("td").first().allInnerTexts();
    for (const s of said) expect(s, "a twin without the day it was created").toMatch(/· created /);
    expect(new Set(said).size, "two twins read the same").toBe(2);
    await expect(row("Summer Matchplay").locator("td").first()).not.toContainText("created");

    // ── every bin and every Manage stand in one column ──
    const edges = await page.locator("tbody [data-row-actions]").evaluateAll((boxes) =>
      boxes.map((b) => {
        const kids = [...b.children].map((c) => c.getBoundingClientRect());
        return { primary: Math.round(kids[0].right), bin: Math.round(kids[1].left) };
      }),
    );
    expect(edges.length, "rows with actions").toBe(5);
    expect(new Set(edges.map((e) => e.bin)).size, `the bins are not in one column: ${JSON.stringify(edges)}`).toBe(1);
    expect(new Set(edges.map((e) => e.primary)).size, `Manage is not in one column: ${JSON.stringify(edges)}`).toBe(1);

    // ── a tournament the reader may not delete says so, where the bin was pressed ──
    await expect(row("Away Fixture").getByRole("button", { name: "Delete Away Fixture", exact: true })).toHaveCount(0);
    const why = row("Away Fixture").getByRole("button", { name: "Why can't I delete Away Fixture?", exact: true });
    await centre(why);
    await why.click();
    await expect(row("Away Fixture").getByRole("status")).toHaveText("Only an organizer of this tournament can delete it.");
    expect(await prisma.event.count({ where: { id: fixture.event.id } }), "asking why deleted it").toBe(1);

    // ── asking before deleting says what goes with it, and Keep keeps it ──
    const bin = row("Summer Matchplay").getByRole("button", { name: "Delete Summer Matchplay", exact: true });
    await centre(bin);
    await bin.click();
    await expect(row("Summer Matchplay")).toContainText("Delete with its 3 players and every score?");
    await page.getByRole("button", { name: "Keep Summer Matchplay", exact: true }).click();
    expect(await prisma.event.count({ where: { id: passed.event.id } }), "Keep deleted it").toBe(1);
  } finally {
    await dropClub(away);
    await dropClub(mark);
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
