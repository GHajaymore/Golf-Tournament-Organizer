import { test, expect } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, addDays, dayIn, returnCard, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * A PLAYER WITH NO HANDICAP INDEX IN A ROUND SCORED NET — CAUGHT AND GIVEN (lane N, PR A).
 *
 * Pressed as the secretary who would: two members in the field have no index, in a tournament of two net
 * rounds on one card. Entries says so after the field is in ("2 players have no handicap index … scored as
 * a scratch golfer (handicap index 0)") with Give strokes; the link lands on the band at the top of Rounds & formats with the
 * first box focused; the secretary types a figure and presses Enter, which gives it and moves to the next
 * box, twice, with no pointer. Read back from the database: each figure on each round as the round's own
 * (never on the player, whose roster row still says no index), and the band, the note and the dashboard's
 * What's next line gone.
 *
 * It prints its presses: two players cost two figures and two Enters after the one link (the panel's
 * keyboard path, 12.2), which is the budget this spec holds.
 *
 * Fixture facts are read from the fixture. Service workers blocked (a save spec's rule on WebKit).
 * Memory: one browser context and one page, about 150 MB.
 */

const ZONE = "UTC";
const MARK = "zz-noindexnet";

test.describe("no handicap index in a net round", () => {
  let club: Club;
  let eventId = "";
  let rounds: string[] = [];
  let noIndex: { id: string; name: string }[] = [];

  test.beforeAll(async () => {
    await dropClub(MARK);
    club = await makeClub(MARK, { timeZone: ZONE });
    const made = await makeEvent(club, "Autumn Medal", {
      status: "registration",
      stages: [
        { scoringBasis: "net", playedOn: addDays(dayIn(ZONE), 7) },
        { scoringBasis: "net", playedOn: addDays(dayIn(ZONE), 8) },
      ],
      players: 4,
    });
    eventId = made.event.id;
    rounds = made.stages.map((s) => s.id);
    // The last two in the field have no index: what a roster row with a blank handicap stores.
    noIndex = made.players.slice(2).map((p) => ({ id: p.id, name: p.name }));
    await prisma.player.updateMany({ where: { id: { in: noIndex.map((p) => p.id) } }, data: { handicap: 0, handicapSource: "none" } });
  });
  test.afterAll(async () => {
    try {
      await dropClub(MARK);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("Entries says so, the link opens the band, and Enter gives each figure and moves on", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    let presses = 0;
    let typed = 0;
    const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    await signIn(context, baseURL!, club, eventId);
    try {
      const page = await context.newPage();
      watchPageErrors(page, errors, "secretary");

      // 1. The door's note, on Entries.
      await page.goto(`/registration?bust=${Date.now()}`);
      const note = page.getByRole("note").filter({ hasText: "have no handicap index" });
      await expect(note).toContainText(`${noIndex.length} players have no handicap index and Round 1 and Round 2 are scored net.`);
      await expect(note).toContainText("Until you give them strokes they are scored as a scratch golfer (handicap index 0).");

      // 2. Give strokes → the band, first box focused.
      await note.getByRole("link", { name: "Give strokes" }).click();
      presses += 1;
      await page.waitForURL(/\/stages#needs-strokes$/);
      const band = page.locator("#needs-strokes");
      await expect(band.getByRole("heading", { name: `${noIndex.length} players need strokes for Round 1.` })).toBeVisible();
      const first = band.getByLabel("Strokes for Round 1 (whole number, 0 to 54)").first();
      await expect(first).toBeFocused();
      await expect(first).toHaveAttribute("inputmode", "numeric");

      // A figure the band does not take is refused beside the box, before any press.
      await page.keyboard.type("12.4");
      await expect(band.getByRole("alert").filter({ hasText: "Whole strokes from 0 to 54. 12, not 12.4." })).toBeVisible();
      await first.fill("");

      // 3. Type, Enter; type, Enter. No pointer.
      const figures = [18, 14];
      for (const [i, figure] of figures.entries()) {
        await page.keyboard.type(String(figure));
        typed += String(figure).length;
        await expect(band.getByText("Not saved yet").first()).toBeVisible();
        await page.keyboard.press("Enter");
        presses += 1;
        await expect(band.getByRole("status")).toContainText(`${noIndex[i].name}: ${figure} strokes, given by you.`, { timeout: 20_000 });
      }
      await expect(band.getByRole("status")).toContainText("Everyone in Round 1 has a handicap.", { timeout: 20_000 });

      // A figure given by mistake: Change on its line, before the round's first card. 18 was meant to be 16.
      await band.getByRole("button", { name: `Change ${noIndex[0].name}'s strokes for Round 1` }).click();
      const again = band.getByLabel("Strokes for Round 1 (whole number, 0 to 54)");
      await expect(again).toHaveCount(1);
      await again.fill("16");
      await again.press("Enter");
      await expect(band.getByRole("status")).toContainText(`${noIndex[0].name}: 16 strokes, given by you.`, { timeout: 20_000 });

      // 4. The dashboard's What's next has no line for it.
      await page.goto(`/dashboard?bust=${Date.now()}`);
      await expect(page.getByText(/need(s)? strokes from you/)).toHaveCount(0);
      await page.goto(`/registration?bust=${Date.now()}`);
      await expect(page.getByRole("note").filter({ hasText: "have no handicap index" })).toHaveCount(0);
    } finally {
      await context.close();
    }

    // Read back: the round's own figure, for both rounds; never on the player.
    for (const [i, p] of noIndex.entries()) {
      for (const stageId of rounds) {
        const row = await prisma.roundHandicap.findUnique({ where: { stageId_playerId: { stageId, playerId: p.id } } });
        expect(row?.override, `${p.name} in ${stageId}`).toBe([16, 14][i]);
      }
      const player = await prisma.player.findUniqueOrThrow({ where: { id: p.id } });
      expect([player.handicap, player.handicapSource], "the roster still says no index").toEqual([0, "none"]);
    }
    console.log(`[no-index-net] presses ${presses}, characters typed ${typed}, players ${noIndex.length}`);
    expect(presses, "one link, then one Enter per player").toBe(1 + noIndex.length);
    expect(errors).toEqual([]);
  });

  test("a player frozen at the scratch figure by the first card is still named, and corrected with a reason", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    // A second tournament: one net round with a card in, frozen as the app freezes at a first card —
    // every confirmed player, the one with no index at the stored 0 — and nobody gave strokes.
    const made = await makeEvent(club, "Winter Stableford", { status: "live", stages: [{ scoringBasis: "net", playedOn: dayIn(ZONE) }], players: 3 });
    const stageId = made.stages[0].id;
    const nox = made.players[2];
    await prisma.player.update({ where: { id: nox.id }, data: { handicap: 0, handicapSource: "none" } });
    await returnCard(made.event.id, stageId, made.players[0].id);
    await prisma.roundHandicap.createMany({
      data: made.players.map((p, i) => ({ eventId: made.event.id, stageId, playerId: p.id, frozen: p.id === nox.id ? 0 : Math.round(6 + i * 3.4), frozenAt: new Date() })),
    });

    const context = await browser.newContext({ ...testInfo.project.use, baseURL, serviceWorkers: "block" });
    await signIn(context, baseURL!, club, made.event.id);
    try {
      const page = await context.newPage();
      watchPageErrors(page, errors, "secretary");
      await page.goto(`/stages?bust=${Date.now()}#needs-strokes`);
      const band = page.locator("#needs-strokes");
      await expect(band).toContainText(`${nox.name} has no handicap index and is scored as a scratch golfer (handicap index 0) in Round 1`);
      await band.getByLabel("Strokes for Round 1 (whole number, 0 to 54)").fill("14");
      await band.getByLabel("Why (kept in the history)").fill("Handicap card shown at the desk");
      await band.getByRole("button", { name: `Correct the strokes for ${nox.name} in Round 1` }).click();
      // Nothing is re-scored before the confirm says who, from what and to what.
      expect((await prisma.roundHandicap.findUniqueOrThrow({ where: { stageId_playerId: { stageId, playerId: nox.id } } })).override).toBeNull();
      const confirm = band.getByRole("alertdialog", { name: `Confirm the correction for ${nox.name}` });
      await expect(confirm).toContainText(`${nox.name}: from a scratch golfer (handicap index 0) to 14 strokes in Round 1. Their net, points and place in Round 1 are worked out again.`);
      await confirm.getByRole("button", { name: "Confirm" }).click();
      await expect(band.getByRole("status")).toContainText(`${nox.name}: 14 strokes in Round 1, corrected by you.`, { timeout: 20_000 });
    } finally {
      await context.close();
    }
    const row = await prisma.roundHandicap.findUniqueOrThrow({ where: { stageId_playerId: { stageId, playerId: nox.id } } });
    expect([row.override, row.frozen, row.frozenExact]).toEqual([14, 14, null]);
    const line = await prisma.auditLog.findFirst({ where: { eventId: made.event.id, action: "strokes-corrected" } });
    expect(line?.detail).toContain("Reason: Handicap card shown at the desk");
    expect(errors).toEqual([]);
  });
});
