import { test, expect, type Page } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, sessionOf, signInWith, addDays, dayIn, NAMES, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * THE MORNING OF PLAY, AT THE TEE SHEET — day-of field changes, PR B.
 *
 * A launched stroke medal with Round 1's sheet PUBLISHED: Group 1 full at
 * 8:00 AM, Group 2 two-strong at 8:10 AM. Pressed by an ASSISTANT, the person
 * on the desk:
 *
 *   Entries' banner          → says when late entries close: Round 1's last tee time
 *   Add late entry           → taken (the round is tomorrow at the club)
 *   Tee sheet, Put in group  → the late entrant goes into Group 2, the one with room
 *                              (Group 1 is full and is not offered); nobody else moves
 *   Withdraw a drawn player  → told "DNS: they had not teed off" and that Group 2
 *                              goes out as a twosome
 *   Leaderboard, Reports     → the organizer's board and the results sheet list them DNS;
 *                              the legend says what DNS means
 *   the round's day passes   → Add is refused, naming Round 1's last tee time
 *
 * The club's clock is told, not assumed: the club is on UTC and the round's day
 * is counted from UTC's today, so the walk reads the same wherever it runs.
 * Withdrawing, putting back and the first-card rule are PR A's spec
 * (`day-of-field-changes.spec.ts`); the cutoff's every cell is
 * `field-change.test.ts`; the action against real rows is
 * `day-of-tee-sheet.audit.test.ts`.
 *
 * Service workers blocked (a save spec's rule on WebKit). Memory: one browser
 * context and one page, about 150 MB.
 */

const MARK = "zz-dayoftee";
const LATE = "Isolde Ravensworth";
const ZONE = "UTC";
let club: Club;
let eventId = "";
let stageId = "";
let ids: string[] = [];
let assistantSession = "";

test.beforeAll(async () => {
  await dropClub(MARK);
  club = await makeClub(MARK, { timeZone: ZONE });
  // Tomorrow at the club: the last tee time is still to come, whatever the hour.
  const made = await makeEvent(club, "Monthly Medal", {
    status: "live",
    configUnlocked: false,
    stages: [{ playedOn: addDays(dayIn(ZONE), 1) }],
    players: 6,
  });
  eventId = made.event.id;
  stageId = made.stages[0].id;
  // Read from the fixture, never assumed.
  ids = made.players.map((p) => p.id);
  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheetPublished: true,
      teeSheet: JSON.stringify({
        savedAt: new Date().toISOString(),
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ids.slice(0, 4) },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ids.slice(4, 6) },
        ],
      }),
    },
  });
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

async function open(page: Page, path: string, heading: string) {
  await page.goto(`${path}?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
}
const sheetGroups = async () =>
  (JSON.parse((await prisma.stage.findUnique({ where: { id: stageId }, select: { teeSheet: true } }))?.teeSheet ?? "{}").groups ?? []) as Array<{
    name: string;
    playerIds: string[];
  }>;

test("the assistant puts a late entry in a group with room, withdraws a drawn player as DNS, and the last tee time closes late entries", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
  await signInWith(context, baseURL!, assistantSession, eventId);
  try {
    const desk = await context.newPage();
    watchPageErrors(desk, errors, "assistant");

    // ── the banner says when late entries close ─────────────────────────────
    await open(desk, "/registration", "Entries");
    await expect(desk.getByText("Late entries close at Round 1’s last tee time, 8:10 AM.", { exact: false })).toBeVisible();

    // ── a late entry ───────────────────────────────────────────────────────
    await desk.getByLabel("Player name").fill(LATE);
    await desk.getByLabel(/^Email ·/).fill(`${MARK}-late@example.invalid`);
    await desk.getByRole("button", { name: "Add late entry" }).click();
    await expect
      .poll(async () => (await prisma.player.findFirst({ where: { eventId, name: LATE }, select: { status: true } }))?.status ?? "", { timeout: 20_000, message: "the late entry was not taken" })
      .toBe("confirmed");
    const lateId = (await prisma.player.findFirst({ where: { eventId, name: LATE }, select: { id: true } }))!.id;

    // ── Put in group: only the group with room is offered ───────────────────
    await open(desk, "/foursomes", "Tee sheet");
    const card = desk.locator('section[aria-label="Put in a group"]');
    await expect(card).toContainText("Not in a group yet (1)");
    const choose = card.getByLabel(`Group for ${LATE}`);
    await expect(choose.locator("option")).toHaveCount(1);
    await expect(choose.locator("option").first()).toContainText("Group 2 · 8:10 AM");
    const before = await sheetGroups();
    await card.getByRole("button", { name: "Put in group" }).click();
    await expect
      .poll(async () => (await sheetGroups())[1]?.playerIds ?? [], { timeout: 20_000, message: "the late entrant was not put in Group 2" })
      .toEqual([...ids.slice(4, 6), lateId]);
    expect((await sheetGroups())[0], "putting one player in moved somebody in Group 1").toEqual(before[0]);
    await expect(desk.getByRole("status").filter({ hasText: `${LATE} is in Group 2, off at 8:10 AM.` })).toBeVisible();
    expect(
      (await prisma.stage.findUnique({ where: { id: stageId }, select: { teeSheetPublished: true } }))?.teeSheetPublished,
      "placing a player unpublished the sheet",
    ).toBe(true);

    // ── withdraw a drawn player who has not teed off: DNS, and the short group
    const gone = NAMES[4];
    await open(desk, "/registration", "Entries");
    const row = desk.locator("tr", { hasText: gone }).first();
    await row.getByRole("button", { name: `Withdraw ${gone}` }).click();
    await expect(desk.getByText("The results list them as WD if they have begun, DNS if not.", { exact: false })).toBeVisible();
    await row.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect
      .poll(async () => (await prisma.player.findUnique({ where: { id: ids[4] }, select: { status: true } }))?.status, { timeout: 20_000 })
      .toBe("withdrawn");
    await expect(desk.getByRole("status").filter({ hasText: `The results list ${gone} as DNS: they had not teed off.` })).toBeVisible();
    await expect(desk.getByRole("status").filter({ hasText: /Group 2 goes out as a (twosome|two-ball)\. Leave it, or put someone in on the Tee sheet\./ })).toBeVisible();

    // ── the organizer's board and the results sheet list them DNS ───────────
    await open(desk, "/leaderboard", "Leaderboard");
    await expect(desk.locator("tr", { hasText: gone }).first()).toContainText("DNS — did not start");
    await open(desk, "/reports", "Reports & export");
    await expect(desk.locator("tr", { hasText: gone }).first()).toContainText("DNS — did not start");
    await expect(desk.getByText("DNS did not start.", { exact: false }).first()).toBeVisible();

    // ── the round's day passes at the club: late entries are closed ─────────
    await prisma.stage.update({ where: { id: stageId }, data: { playedOn: addDays(dayIn(ZONE), -1) } });
    await open(desk, "/registration", "Entries");
    await expect(desk.getByRole("button", { name: "Add late entry" })).toBeDisabled();
    await expect(
      desk.getByText("Round 1’s last tee time, 8:10 AM, has passed, so late entries are closed. To add someone anyway, an Organizer can unlock the tournament on the dashboard.", { exact: false }).first(),
    ).toBeVisible();

    expect(errors, "the page threw").toEqual([]);
  } finally {
    await context.close();
  }
});
