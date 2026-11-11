import { test, expect, type Page } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, returnCard, sessionOf, signInWith, signIn, addDays, dayIn, NAMES, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * MOVE ONE PLAYER, MOVE A WHOLE GROUP, ON A SAVED SHEET — no re-draw.
 *
 * Pressed as the people who would: the ORGANIZER on a stroke tournament's
 * published sheet, and an ASSISTANT beside the organizer on a league week's
 * (an opt-out league; the week's sheet is the round's own). Each makes a draft
 * of moves, sees "N changes not saved yet", and saves ONCE; the stored sheet is
 * read back from the database, the times are shown to have stayed with the
 * slots, and the published state to have been kept.
 *
 *   tournament, organizer   → Bea Lindqvist moves to Group 3; Group 3 goes first (two taps up);
 *                             Cancel throws a draft away; a sheet saved under the desk is refused
 *                             in a sentence with nothing half-written; a group with a card in is
 *                             locked and says so
 *   league week, organizer  → one player moves between groups and a group moves up, saved once
 *   league week, assistant  → the same, back again
 *   league week, no-shows   → two players marked out leave a group of two; the organizer moves those two
 *                             into other groups; the draft says the group will be removed; one Save, and
 *                             the group is gone while the others keep their times
 *
 * The club's clock is told: UTC, and the round is tomorrow, so no group has teed off whatever the
 * hour. A teed-off group's rule is `tee-sheet-moves.test.ts` (it needs the club's wall clock).
 * Fixture facts are read from the fixture. Service workers blocked (a save spec's rule on WebKit).
 * Memory: one browser context and one page each, about 150 MB.
 */

const ZONE = "UTC";

type Saved = Array<{ name: string; time: string; startHole: number; playerIds: string[] }>;
const readSheet = async (stageId: string) => {
  const s = await prisma.stage.findUnique({ where: { id: stageId }, select: { teeSheet: true, teeSheetPublished: true } });
  return { groups: (JSON.parse(s?.teeSheet ?? "{}").groups ?? []) as Saved, published: s?.teeSheetPublished ?? false, raw: s?.teeSheet ?? "" };
};

async function open(page: Page, stageId: string) {
  await page.goto(`/foursomes?round=${stageId}&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { name: "Tee sheet", exact: true }).first()).toBeVisible();
}

function sheetOf(ids: string[]) {
  return JSON.stringify({
    savedAt: new Date().toISOString(),
    startType: "tee",
    groups: [
      { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: ids.slice(0, 4) },
      { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: ids.slice(4, 6) },
      { name: "Group 3", startHole: 1, time: "8:20 AM", playerIds: ids.slice(6, 8) },
    ],
  });
}

test.describe("tee sheet moves: a tournament", () => {
  const MARK = "zz-sheetmoves";
  let club: Club;
  let eventId = "";
  let stageId = "";
  let ids: string[] = [];

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Monthly Medal", {
      status: "live",
      configUnlocked: false,
      stages: [{ playedOn: addDays(dayIn(ZONE), 1) }],
      players: 8,
    });
    eventId = made.event.id;
    stageId = made.stages[0].id;
    ids = made.players.map((p) => p.id);
    await prisma.stage.update({ where: { id: stageId }, data: { teeSheetPublished: true, teeSheet: sheetOf(ids) } });
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("the organizer moves a player and a group, cancels, is refused on a stale sheet, and saves once", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    await signIn(context, baseURL!, club, eventId);
    try {
      const page = await context.newPage();
      watchPageErrors(page, errors, "organizer");
      await open(page, stageId);
      const bea = NAMES[3];
      const before = await readSheet(stageId);

      // Nothing is written per tap: a draft, then Cancel throws it away.
      await page.getByLabel(`Move ${bea} to`, { exact: true }).selectOption({ label: "Group 3 · 8:20 AM · 2 players" });
      await expect(page.getByText("1 change not saved yet.")).toBeVisible();
      expect((await readSheet(stageId)).raw, "a tap wrote to the stored sheet").toBe(before.raw);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByText("not saved yet.")).toHaveCount(0);

      // A full group is listed and disabled, with its reason.
      const option = page.getByLabel(`Move ${NAMES[4]} to`, { exact: true }).locator("option", { hasText: "Group 1 · 8:00 AM · 4 players" });
      await expect(option).toBeDisabled();
      await expect(option).toContainText("Group 1 is full.");

      // The draft: Bea to Group 3, then Group 3 earlier twice — it goes first.
      await page.getByLabel(`Move ${bea} to`, { exact: true }).selectOption({ label: "Group 3 · 8:20 AM · 2 players" });
      await page.getByRole("button", { name: "Move Group 3 earlier" }).click();
      await page.getByRole("button", { name: "Move Group 2 earlier" }).click();
      await expect(page.getByText("3 changes not saved yet.")).toBeVisible();
      await expect(page.getByText("Group 2 goes out as a", { exact: false })).toBeVisible();

      // Somebody else saves the sheet under the desk: the press is refused, in a sentence, nothing half-saved.
      const other = JSON.parse(before.raw);
      other.savedAt = new Date(Date.now() + 1000).toISOString();
      await prisma.stage.update({ where: { id: stageId }, data: { teeSheet: JSON.stringify(other) } });
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "The sheet changed while you were choosing." })).toBeVisible();
      expect((await readSheet(stageId)).groups.map((g) => g.playerIds), "a refused save wrote something").toEqual(before.groups.map((g) => g.playerIds));

      // Look again and do it once.
      await open(page, stageId);
      await page.getByLabel(`Move ${bea} to`, { exact: true }).selectOption({ label: "Group 3 · 8:20 AM · 2 players" });
      await page.getByRole("button", { name: "Move Group 3 earlier" }).click();
      await page.getByRole("button", { name: "Move Group 2 earlier" }).click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect
        .poll(async () => (await readSheet(stageId)).groups.map((g) => g.playerIds), { timeout: 20_000, message: "the moves were not saved" })
        .toEqual([[ids[6], ids[7], ids[3]], ids.slice(0, 3), ids.slice(4, 6)]);
      const after = await readSheet(stageId);
      expect(after.groups.map((g) => `${g.name}|${g.time}|${g.startHole}`), "the times did not stay with the slots").toEqual(before.groups.map((g) => `${g.name}|${g.time}|${g.startHole}`));
      expect(after.published, "the move unpublished the sheet").toBe(true);

      // A card in locks its group: said on the row, and its players have no move.
      await returnCard(eventId, stageId, ids[4]);
      await open(page, stageId);
      await expect(page.getByText("Group 3 has a card in.", { exact: false }).first()).toBeVisible();
      await expect(page.getByLabel(`Move ${NAMES[4]} to`, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel(`Move ${NAMES[0]} to`, { exact: true }).locator("option", { hasText: "Group 3" })).toBeDisabled();
      expect(errors, "the page threw").toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("tee sheet moves: a league week", () => {
  const MARK = "zz-sheetmovesleague";
  let club: Club;
  let eventId = "";
  let stageId = "";
  let ids: string[] = [];
  let assistantSession = "";

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Thursday League", {
      status: "live",
      configUnlocked: false,
      stages: [{ playedOn: addDays(dayIn(ZONE), 1) }, { playedOn: addDays(dayIn(ZONE), 8) }],
      players: 8,
      event: { attendanceMode: "opt-out" },
    });
    eventId = made.event.id;
    stageId = made.stages[0].id;
    ids = made.players.map((p) => p.id);
    await prisma.stage.update({
      where: { id: stageId },
      data: {
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "6:30 PM", playerIds: ids.slice(0, 4) },
            { name: "Group 2", startHole: 1, time: "6:40 PM", playerIds: ids.slice(4, 6) },
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

  test("the organizer and then an assistant move a player and a group on the week's sheet, saving once each", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const who = [
      { role: "organizer", session: club.session },
      { role: "assistant", session: assistantSession },
    ];
    const results: string[][][] = [];
    for (const w of who) {
      const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
      await signInWith(context, baseURL!, w.session, eventId);
      try {
        const page = await context.newPage();
        watchPageErrors(page, errors, w.role);
        await open(page, stageId);
        const before = await readSheet(stageId);
        const mover = before.groups[0].playerIds[before.groups[0].playerIds.length - 1];
        const moverName = NAMES[ids.indexOf(mover)];
        await page.getByLabel(`Move ${moverName} to`, { exact: true }).selectOption({ index: 1 });
        await page.getByRole("button", { name: "Move Group 2 earlier" }).click();
        await expect(page.getByText("2 changes not saved yet.")).toBeVisible();
        await page.getByRole("button", { name: "Save changes" }).click();
        await expect
          .poll(async () => (await readSheet(stageId)).raw, { timeout: 20_000, message: `${w.role}: the moves were not saved` })
          .not.toBe(before.raw);
        const after = await readSheet(stageId);
        expect(after.groups.map((g) => g.time), `${w.role}: times moved with the players`).toEqual(before.groups.map((g) => g.time));
        expect(after.published, `${w.role}: the sheet was unpublished`).toBe(true);
        results.push(after.groups.map((g) => g.playerIds));
      } finally {
        await context.close();
      }
    }
    // The organizer: the fourth of Group 1 joins Group 2, and Group 2 (now of three) goes first.
    expect(results[0]).toEqual([[ids[4], ids[5], ids[3]], ids.slice(0, 3)]);
    // The assistant did the same on what the organizer left: the last of the new Group 1 (the same player) goes to the other group, which goes first — back as it began.
    expect(results[1]).toEqual([ids.slice(0, 4), ids.slice(4, 6)]);
    expect(errors, "the page threw").toEqual([]);
  });

  test("two no-shows leave a two-ball; the organizer moves the two into other groups, and the empty group is removed on Save", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    // Fresh sheet: Group 2 holds four, two of whom (ids 5 and 6) are marked out for the week.
    await prisma.stage.update({
      where: { id: stageId },
      data: {
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "6:30 PM", playerIds: ids.slice(0, 3) },
            { name: "Group 2", startHole: 1, time: "6:40 PM", playerIds: [ids[3], ids[4], ids[5], ids[6]] },
            { name: "Group 3", startHole: 1, time: "6:50 PM", playerIds: [ids[7]] },
          ],
        }),
      },
    });
    for (const out of [ids[5], ids[6]]) {
      await prisma.roundAttendance.upsert({
        where: { stageId_playerId: { stageId, playerId: out } },
        update: { status: "out" },
        create: { eventId, stageId, playerId: out, status: "out", decidedBy: "zz-sheetmoves" },
      });
    }
    const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    await signIn(context, baseURL!, club, eventId);
    try {
      const page = await context.newPage();
      watchPageErrors(page, errors, "organizer");
      await open(page, stageId);
      // The real gaps show at once: the players marked out are not on the card.
      await expect(page.getByText(NAMES[5], { exact: false })).toHaveCount(0);
      await page.getByLabel(`Move ${NAMES[3]} to`, { exact: true }).selectOption({ label: "Group 1 · 6:30 PM · 3 players" });
      await page.getByLabel(`Move ${NAMES[4]} to`, { exact: true }).selectOption({ label: "Group 3 · 6:50 PM · 1 player" });
      await expect(page.getByText("Group 2 will be removed (no players left).")).toBeVisible();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect
        .poll(async () => (await readSheet(stageId)).groups.map((g) => g.playerIds), { timeout: 20_000, message: "the moves were not saved" })
        .toEqual([[ids[0], ids[1], ids[2], ids[3]], [ids[7], ids[4]]]);
      const after = await readSheet(stageId);
      expect(after.groups.map((g) => g.time), "the remaining groups kept their own times").toEqual(["6:30 PM", "6:50 PM"]);
      expect(after.published).toBe(true);
      expect(errors, "the page threw").toEqual([]);
    } finally {
      await context.close();
    }
  });
});
