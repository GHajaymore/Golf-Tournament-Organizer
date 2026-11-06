import { test, expect, type Page } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signInWith, sessionOf, returnCard, NAMES, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * THE MORNING OF PLAY, AS THE ASSISTANT AT THE DESK — day-of field changes, PR A.
 *
 * A launched stroke medal, locked as `launchTournament` leaves it. Before this
 * change every field control on Entries shut at launch: an Assistant could not
 * record one withdrawal, and the Organizer had to unlock the format, the rounds
 * and every handicap to write one name off the sheet. Pressed by an ASSISTANT,
 * the person on the desk at 7am:
 *
 *   the banner                → "Under way", saying what is still open (not "Setup locked")
 *   Withdraw a drawn player   → asked first; then KEPT as withdrawn, never deleted
 *                               (the control: no card, so before this change the row
 *                               was deleted), and listed under Withdrawn
 *   Put back                  → back in the field, the same row
 *   Add late entry            → in the field; told to give them a tee time and offered
 *                               a flight in their row
 *   Choose a flight           → placed (nobody else moves), though the draw is confirmed
 *   a card comes in           → Add is refused, naming the round and that an Organizer can unlock
 *   the CSV import            → shut throughout, with the reason beside it
 *
 * The card is written as a row, not typed: it stands for a scorer's card, and
 * scoring is other specs' to walk. The waiting list moving up on a withdrawal,
 * the knockout refusal and the completed lock are held against real rows in
 * `a-late-changes-after-launch.audit.test.ts`.
 *
 * Service workers blocked (a save spec's rule on WebKit; nothing here is
 * offline). Memory: one browser context and one page, about 150 MB.
 *
 * WHAT IT CANNOT SEE: the tee sheet's own "no longer matches the field" line
 * and the DNS row, which are PR B's.
 */

const MARK = "zz-dayof";
const LATE = "Isolde Ravensworth";
let club: Club;
let eventId = "";
let stageId = "";
let withdrawnId = "";
let assistantSession = "";

test.beforeAll(async () => {
  await dropClub(MARK);
  club = await makeClub(MARK);
  // The draw was CONFIRMED before launch, as a careful secretary leaves it: placing a late entrant
  // must still be offered (panel review of #1028, must-fix 1) — it moves nobody else.
  const made = await makeEvent(club, "Monthly Medal", {
    status: "live",
    configUnlocked: false,
    stages: [{}],
    players: 4,
    flights: 2,
    event: { flightsConfirmed: true },
  });
  eventId = made.event.id;
  stageId = made.stages[0].id;
  // Read from the fixture, never assumed: the first entrant, drawn into Flight A, with no card.
  withdrawnId = made.players[0].id;
  const assistant = await prisma.user.create({
    data: { email: `${MARK}-assistant@example.invalid`, name: "Corin Abernethy", password: "x:unusable", emailVerifiedAt: new Date() },
  });
  await prisma.account.create({ data: { eventId, name: "Corin Abernethy", email: assistant.email, role: "assistant" } });
  assistantSession = sessionOf(assistant.id);
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
const statusOf = async (id: string) => (await prisma.player.findUnique({ where: { id }, select: { status: true } }))?.status ?? "deleted";

test("the assistant withdraws, puts back and takes a late entry on a launched medal without unlocking it", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
  await signInWith(context, baseURL!, assistantSession, eventId);
  try {
    const desk = await context.newPage();
    watchPageErrors(desk, errors, "assistant");
    const first = NAMES[0];

    // ── the banner says what is open ────────────────────────────────────────
    await entries(desk);
    await expect(desk.getByText("Under way", { exact: true })).toBeVisible();
    await expect(desk.getByText(/You can withdraw a player, put one back or add a late entry/)).toBeVisible();
    await expect(desk.getByText("Setup locked", { exact: true }), "CONTROL: the old blanket banner is still drawn").toHaveCount(0);
    // The CSV import stays shut, and says why beside it.
    await expect(desk.getByText(/^Importing a list or removing several players at once is locked/).first()).toBeVisible();

    // ── withdraw: asked first, then kept, not deleted ───────────────────────
    const row = desk.locator("tr", { hasText: first }).first();
    await row.getByRole("button", { name: `Withdraw ${first}` }).click();
    expect(await statusOf(withdrawnId), "one press withdrew somebody without asking").toBe("confirmed");
    await expect(desk.getByText(`Withdraw ${first}? They come off the tee sheet and the board.`, { exact: false })).toBeVisible();
    await row.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect.poll(() => statusOf(withdrawnId), { timeout: 20_000, message: "a drawn player with no card was deleted, or not withdrawn" }).toBe("withdrawn");
    await expect(desk.getByRole("status").filter({ hasText: `${first} is out.` })).toBeVisible();
    await expect(desk.getByRole("status").filter({ hasText: "Their scores and side-game entries stay on the record." })).toBeVisible();

    // ── put back ────────────────────────────────────────────────────────────
    await entries(desk);
    const gone = desk.locator('section[aria-label="Withdrawn"]');
    await expect(gone, "the withdrawn player is on no list").toContainText(first);
    await gone.locator("li", { hasText: first }).getByRole("button", { name: "Put back" }).click();
    await expect.poll(() => statusOf(withdrawnId), { timeout: 20_000, message: "Put back did not return them to the field" }).toBe("confirmed");
    await expect(desk.getByText(`${first} is back in the field.`, { exact: false })).toBeVisible();

    // ── a late entry, and a flight for them ─────────────────────────────────
    await entries(desk);
    await desk.getByLabel("Player name").fill(LATE);
    // The Add form's own box ("Email · required…"), not a row's "Email for …".
    await desk.getByLabel(/^Email ·/).fill(`${MARK}-late@example.invalid`);
    await desk.getByRole("button", { name: "Add late entry" }).click();
    await expect.poll(async () => (await prisma.player.findFirst({ where: { eventId, name: LATE }, select: { status: true } }))?.status ?? "", { timeout: 20_000, message: "the late entry was not taken" }).toBe("confirmed");
    await expect(desk.getByRole("status").filter({ hasText: `${LATE} is in the field. Put them in a group on the Tee sheet.` })).toBeVisible();
    await expect(desk.getByRole("status").filter({ hasText: `${LATE} is in no flight. Choose one in the Flight column.` })).toBeVisible();

    const before = await prisma.player.findMany({ where: { eventId, name: { not: LATE } }, select: { id: true, groupId: true }, orderBy: { id: "asc" } });
    await entries(desk);
    await desk.getByLabel(`Flight for ${LATE}`).selectOption({ index: 2 });
    await expect
      .poll(async () => (await prisma.player.findFirst({ where: { eventId, name: LATE }, select: { groupId: true } }))?.groupId ?? null, { timeout: 20_000, message: "the late entrant was not placed" })
      .not.toBeNull();
    const after = await prisma.player.findMany({ where: { eventId, name: { not: LATE } }, select: { id: true, groupId: true }, orderBy: { id: "asc" } });
    expect(after, "placing the late entrant moved somebody else").toEqual(before);

    // ── a card comes in: no more late entries ───────────────────────────────
    await returnCard(eventId, stageId, withdrawnId);
    await entries(desk);
    await expect(desk.getByRole("button", { name: "Add late entry" })).toBeDisabled();
    // Said to the Assistant, who cannot unlock, with who can (panel review of #1028, must-fix 2).
    await expect(
      desk
        .getByText("The first card of Round 1 is in, so late entries are closed. To add someone anyway, an Organizer can unlock the tournament on the dashboard.", { exact: false })
        .first(),
    ).toBeVisible();
    // Withdrawing is still open: it never reopens anything.
    await expect(desk.locator("tr", { hasText: NAMES[1] }).first().getByRole("button", { name: `Withdraw ${NAMES[1]}` })).toBeEnabled();

    expect(errors, "the page threw").toEqual([]);
  } finally {
    await context.close();
  }
});
