import { test, expect, type Page } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, NAMES, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * A LATE ENTRANT AFTER THE DRAW, BY FAMILY — the upstream-change rules for the
 * field and flights (J12, state machine PR 7a; the panel's Q3 and summary item
 * 10). The medal's half — a late entrant taken with a warning and FLAGGED in no
 * flight — is walked in `day-of-field-changes.spec.ts`; this walks the two
 * families whose answer is not "take them", as the Organizer at the desk:
 *
 *   ROUND ROBIN IN FLIGHTS, launched
 *     Add, no flight          → the button is refused where it is, in the rule's words
 *                               ("needs a flight… no matches"), and the form's Flight
 *                               says it is required
 *     Flight A, Add           → in the field IN Flight A; a match against each player in
 *                               Flight A drawn for them (the re-draw), nobody else's
 *                               pairing touched; the screen says so
 *
 *   KNOCKOUT, launched
 *     Add                     → refused: "The draw is made, so nobody can join the
 *                               knockout", with the reserve as the way out
 *     Add as a reserve        → on the waiting list, the draw unchanged; said
 *     a drawn player withdraws→ the reserve does NOT move in by itself: a promotion is a
 *                               late entry and asks the same rule (a bracket has no
 *                               empty place past round one)
 *
 * Each builds its own zz-marked club and tournament with invented names and
 * `@example.invalid` addresses, dropped in `afterAll`. Service workers blocked
 * (a save spec's rule on WebKit). Memory: one context and one page at a time,
 * about 150 MB.
 *
 * WHAT IT CANNOT SEE: a knockout whose draw was made BEFORE launch (a result
 * recorded on a tournament still being set up) — held by the matrix cells
 * (`matrix.test.ts`, "an upstream edit to the field") and `field-change.test.ts`.
 */

const MARK = "zz-j12field";
const LATE_RR = "Lowri Penhallow";
const RESERVE = "Anselm Quarrie";
let club: Club;

test.beforeAll(async () => {
  await dropClub(MARK);
  club = await makeClub(MARK);
});

test.afterAll(async () => {
  try {
    await dropClub(MARK);
  } finally {
    await prisma.$disconnect();
  }
});

async function entries(page: Page) {
  await page.goto(`/registration?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible();
}

test("a round robin takes a late entrant only with a flight, and draws their matches against it", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  // Launched and locked, as `launchTournament` leaves it. Four entered, two flights of two (read back below, never assumed).
  const made = await makeEvent(club, "Spring Round Robin", {
    status: "live",
    configUnlocked: false,
    stages: [{ type: "Round Robin", format: "Match Play" }],
    players: 4,
    flights: 2,
  });
  const eventId = made.event.id;
  const stageId = made.stages[0].id;
  const flightA = made.flights[0];
  const mates = made.players.filter((p) => p.groupId === flightA.id).map((p) => p.id);
  expect(mates.length, "the fixture's Flight A has players to be drawn against").toBeGreaterThan(0);
  const matchesBefore = await prisma.match.findMany({ where: { eventId, stageId }, select: { id: true, playerAId: true, playerBId: true }, orderBy: { id: "asc" } });

  const errors: string[] = [];
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
  await signIn(context, baseURL!, club, eventId);
  try {
    const desk = await context.newPage();
    watchPageErrors(desk, errors, "organizer");
    await entries(desk);
    await expect(desk.getByText(/You can withdraw a player, put one back or add a late entry with a flight/)).toBeVisible();

    // ── no flight: refused where the press is, in the rule's words ─────────
    await desk.getByLabel("Player name").fill(LATE_RR);
    await desk.getByLabel(/^Email ·/).fill(`${MARK}-late@example.invalid`);
    const flight = desk.getByLabel("Flight · required in a round robin");
    await expect(flight).toHaveValue("");
    await expect(desk.getByRole("button", { name: "Add late entry" })).toBeDisabled();
    await expect(
      desk.getByText("In a round robin, a late entrant needs a flight. Without one they have no matches. Choose their flight in the Add form.", { exact: false }).first(),
    ).toBeVisible();
    expect(await prisma.player.count({ where: { eventId, name: LATE_RR } }), "a refused add wrote a row").toBe(0);

    // ── with a flight: taken, placed, and their matches drawn ──────────────
    await flight.selectOption({ label: "Flight A" });
    await expect(desk.getByRole("button", { name: "Add late entry" })).toBeEnabled();
    await desk.getByRole("button", { name: "Add late entry" }).click();
    await expect
      .poll(async () => (await prisma.player.findFirst({ where: { eventId, name: LATE_RR }, select: { groupId: true, status: true } })) ?? null, {
        timeout: 20_000,
        message: "the late entrant was not taken into Flight A",
      })
      .toEqual({ groupId: flightA.id, status: "confirmed" });
    const late = (await prisma.player.findFirst({ where: { eventId, name: LATE_RR }, select: { id: true } }))!;
    // A match against each player in Flight A — the re-draw — and nothing else.
    const theirs = await prisma.match.findMany({ where: { eventId, stageId, OR: [{ playerAId: late.id }, { playerBId: late.id }] }, select: { playerAId: true, playerBId: true } });
    expect(theirs.map((m) => (m.playerAId === late.id ? m.playerBId : m.playerAId)).sort(), "a match against each flight-mate").toEqual([...mates].sort());
    const matchesAfter = await prisma.match.findMany({
      where: { eventId, stageId, NOT: { OR: [{ playerAId: late.id }, { playerBId: late.id }] } },
      select: { id: true, playerAId: true, playerBId: true },
      orderBy: { id: "asc" },
    });
    expect(matchesAfter, "somebody else's pairing changed").toEqual(matchesBefore);
    await expect(desk.getByRole("status").filter({ hasText: `${LATE_RR}’s matches against Flight A are drawn. Each player in it has one more to play.` })).toBeVisible();
    // Placed with the entry: never flagged as in no flight.
    await entries(desk);
    await expect(desk.getByTestId("unplaced-flag")).toHaveCount(0);

    expect(errors, "the page threw").toEqual([]);
  } finally {
    await context.close();
  }
});

test("a knockout refuses a late entrant once drawn, and takes them as a reserve who does not move in by themselves", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const made = await makeEvent(club, "Club Knockout", {
    status: "live",
    configUnlocked: false,
    stages: [{ type: "Bracket Stage", format: "Match Play" }],
    players: 4,
  });
  const eventId = made.event.id;
  // Read from the fixture: the first entrant, drawn, with no result — the one who will withdraw.
  const drawnId = made.players[0].id;
  const first = NAMES[0];

  const errors: string[] = [];
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
  await signIn(context, baseURL!, club, eventId);
  try {
    const desk = await context.newPage();
    watchPageErrors(desk, errors, "organizer");
    await entries(desk);
    await expect(desk.getByText("You can withdraw a player, put one back or add a reserve.", { exact: false })).toBeVisible();

    // ── refused, with the reserve as the way out ────────────────────────────
    await desk.getByLabel("Player name").fill(RESERVE);
    await desk.getByLabel(/^Email ·/).fill(`${MARK}-reserve@example.invalid`);
    await expect(desk.getByRole("button", { name: "Add late entry" })).toBeDisabled();
    await expect(
      desk
        .getByText(
          "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. An Organizer can open the field with a committee correction.",
          { exact: false },
        )
        .first(),
    ).toBeVisible();

    // ── the reserve ─────────────────────────────────────────────────────────
    await desk.getByRole("button", { name: "Add as a reserve" }).click();
    await expect
      .poll(async () => (await prisma.player.findFirst({ where: { eventId, name: RESERVE }, select: { status: true } }))?.status ?? "", { timeout: 20_000, message: "the reserve was not taken" })
      .toBe("waitlisted");
    await expect(desk.getByRole("status").filter({ hasText: `${RESERVE} is on the waiting list as a reserve. The draw does not change.` })).toBeVisible();

    // ── a drawn player withdraws: the reserve stays where they are ─────────
    await entries(desk);
    const row = desk.locator("tr", { hasText: first }).first();
    await row.getByRole("button", { name: `Withdraw ${first}` }).click();
    await row.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect
      .poll(async () => (await prisma.player.findUnique({ where: { id: drawnId }, select: { status: true } }))?.status ?? "deleted", { timeout: 20_000, message: "the drawn player was not withdrawn" })
      .toBe("withdrawn");
    expect(
      (await prisma.player.findFirst({ where: { eventId, name: RESERVE }, select: { status: true } }))?.status,
      "the reserve moved into a knockout whose draw is made",
    ).toBe("waitlisted");

    expect(errors, "the page threw").toEqual([]);
  } finally {
    await context.close();
  }
});
