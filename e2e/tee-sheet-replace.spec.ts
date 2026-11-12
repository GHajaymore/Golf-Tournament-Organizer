import { test, expect, type Page } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, returnCard, sessionOf, signInWith, signIn, addDays, dayIn, NAMES, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * "REPLACE …" ON A TEE-SHEET SLOT — a no-show, a last-minute cancellation (B43).
 *
 * Pressed as the people who would: the ORGANIZER replaces a player with a member of the field who is not
 * playing that week, and an ASSISTANT replaces another with a GUEST typed in with no handicap. The week's
 * sheet is the round's own, in an opt-out league, a day ahead (so no group has teed off whatever the hour,
 * on the club's UTC clock). Read back from the database: the stored sheet has one name changed and the
 * times, the other groups and the published state are as they were; the absentee is marked out "replaced
 * by" and the sub in; the guest is a guest entry with the typed index (the round is net, so a blank is refused).
 *
 *   organizer  → "Replace…" opens a panel beside the name; somebody already in a group is listed greyed
 *                with the reason; a member is chosen; the confirm states in one sentence what will happen;
 *                the answer is said on the screen
 *   assistant  → the same press with "A guest (not a member)…", "Type the handicap the committee gives…" (net round)
 *   a card in  → the group with a card in draws no Replace at all
 *
 * Fixture facts are read from the fixture. Service workers blocked (a save spec's rule on WebKit).
 * Memory: one browser context and one page each, about 150 MB.
 */

const ZONE = "UTC";
const MARK = "zz-sheetreplace";

type Saved = Array<{ name: string; time: string; startHole: number; playerIds: string[] }>;
const readSheet = async (stageId: string) => {
  const s = await prisma.stage.findUnique({ where: { id: stageId }, select: { teeSheet: true, teeSheetPublished: true } });
  return { groups: (JSON.parse(s?.teeSheet ?? "{}").groups ?? []) as Saved, published: s?.teeSheetPublished ?? false };
};

async function open(page: Page, stageId: string) {
  await page.goto(`/foursomes?round=${stageId}&bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { name: "Tee sheet", exact: true }).first()).toBeVisible();
}

test.describe("tee sheet replace: a league week", () => {
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
      stages: [{ playedOn: addDays(dayIn(ZONE), 1) }],
      players: 8,
      event: { attendanceMode: "opt-out" },
    });
    eventId = made.event.id;
    stageId = made.stages[0].id;
    ids = made.players.map((p) => p.id);
    // Six on the sheet in two groups; two more are in the field and on no group (free to step in).
    await prisma.stage.update({
      where: { id: stageId },
      data: {
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "6:30 PM", playerIds: ids.slice(0, 3) },
            { name: "Group 2", startHole: 1, time: "6:40 PM", playerIds: ids.slice(3, 6) },
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

  test("the organizer replaces a player with a member, and an assistant with a guest with a typed index", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const before = await readSheet(stageId);

    // 1. The ORGANIZER: Ffion out, the first free member in.
    {
      const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
      await signIn(context, baseURL!, club, eventId);
      try {
        const page = await context.newPage();
        watchPageErrors(page, errors, "organizer");
        await open(page, stageId);
        await page.getByRole("button", { name: `Replace ${NAMES[0]}`, exact: true }).click();
        const picker = page.getByLabel(`Who replaces ${NAMES[0]}`, { exact: true });
        // Somebody already playing is listed, greyed, with the reason.
        const busy = picker.locator("option", { hasText: NAMES[3] });
        // An <option> has no ARIA disabled state Playwright reads: read the real property.
        await expect(busy).toHaveJSProperty("disabled", true);
        await expect(busy).toContainText("Already in Group 2.");
        await picker.selectOption({ value: ids[6] });
        await expect(page.getByText(`${NAMES[6]} takes ${NAMES[0]}’s place in Group 1, 6:30 PM`, { exact: false })).toBeVisible();
        await page.getByRole("button", { name: `Replace ${NAMES[0]}`, exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: `${NAMES[6]} is in Group 1, 6:30 PM, in place of ${NAMES[0]}.` })).toBeVisible({ timeout: 20_000 });
      } finally {
        await context.close();
      }
      const after = await readSheet(stageId);
      expect(after.groups.map((g) => g.playerIds), "one name changed, in place").toEqual([[ids[6], ids[1], ids[2]], ids.slice(3, 6)]);
      expect(after.groups.map((g) => `${g.name}|${g.time}|${g.startHole}`)).toEqual(before.groups.map((g) => `${g.name}|${g.time}|${g.startHole}`));
      expect(after.published, "the replacement unpublished the sheet").toBe(true);
      const out = await prisma.roundAttendance.findUnique({ where: { stageId_playerId: { stageId, playerId: ids[0] } } });
      expect(out?.status).toBe("out");
      expect(out?.decidedBy).toContain(`replaced by ${NAMES[6]}`);
      expect((await prisma.roundAttendance.findUnique({ where: { stageId_playerId: { stageId, playerId: ids[6] } } }))?.status).toBe("in");
      expect(await prisma.player.findUnique({ where: { id: ids[0] } }), "the absentee's row was deleted").not.toBeNull();
      const line = await prisma.auditLog.findFirst({ where: { eventId, action: "replaced" } });
      expect(line?.detail).toContain(`Replaced ${NAMES[0]} with ${NAMES[6]}`);
    }

    // 2. An ASSISTANT: Mirela out, a guest in with no handicap typed.
    {
      const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
      await signInWith(context, baseURL!, assistantSession, eventId);
      try {
        const page = await context.newPage();
        watchPageErrors(page, errors, "assistant");
        await open(page, stageId);
        await page.getByRole("button", { name: `Replace ${NAMES[5]}`, exact: true }).click();
        await page.getByLabel(`Who replaces ${NAMES[5]}`, { exact: true }).selectOption({ label: "A guest (not a member)…" });
        await expect(page.getByText("this round is scored net.", { exact: false })).toBeVisible();
        await page.getByLabel(/Guest.s name/).fill("Hollis Verity");
        // A round scored net takes a guest only with a figure: the button waits for it.
        await expect(page.getByRole("button", { name: `Replace ${NAMES[5]}`, exact: true })).toBeDisabled();
        await page.getByLabel("Handicap index").fill("14.2");
        await page.getByLabel(`Why ${NAMES[5]} is replaced`, { exact: true }).selectOption({ label: "Cancelled" });
        await expect(page.getByText("playing off 14.2", { exact: false })).toBeVisible();
        await page.getByRole("button", { name: `Replace ${NAMES[5]}`, exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Hollis Verity is in Group 2, 6:40 PM" })).toBeVisible({ timeout: 20_000 });
      } finally {
        await context.close();
      }
      const guest = await prisma.player.findFirst({ where: { eventId, name: "Hollis Verity" } });
      expect(guest, "no guest entry").not.toBeNull();
      expect(guest).toMatchObject({ standing: "guest", handicapSource: "manual", handicap: 14.2, email: "", status: "confirmed" });
      expect((await readSheet(stageId)).groups[1].playerIds).toEqual([ids[3], ids[4], guest!.id]);
      const line = await prisma.auditLog.findFirst({ where: { eventId, action: "replaced", detail: { contains: "Hollis Verity" } } });
      expect(line?.actor).toBe("Corin Abernethy");
      expect(line?.detail).toContain("reason cancelled, handicap used 14.2");
    }

    // 3. A card in Group 2: it has started, so its players draw no Replace.
    await returnCard(eventId, stageId, ids[4]);
    const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    await signIn(context, baseURL!, club, eventId);
    try {
      const page = await context.newPage();
      watchPageErrors(page, errors, "organizer");
      await open(page, stageId);
      await expect(page.getByRole("note").filter({ hasText: "Group 2 has a card in." })).toBeVisible();
      await expect(page.getByRole("button", { name: `Replace ${NAMES[4]}`, exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: `Replace ${NAMES[1]}`, exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
    expect(errors, "the page threw").toEqual([]);
  });
});
