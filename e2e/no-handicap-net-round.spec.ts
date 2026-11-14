import { test, expect } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, addDays, dayIn, type Club } from "./rounds-fixture";
import { watchPageErrors } from "./page-errors";

/**
 * A PLAYER WITH NO HANDICAP INDEX IN A ROUND SCORED NET — CAUGHT AND GIVEN (lane N, PR A).
 *
 * Pressed as the secretary who would: two members in the field have no index, in a tournament of two net
 * rounds on one card. Entries says so after the field is in ("2 players have no handicap index … scored as
 * scratch, off 0") with Give strokes; the link lands on the band at the top of Rounds & formats with the
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
      await expect(note).toContainText("Until you give them strokes they are scored as scratch, off 0.");

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
        expect(row?.override, `${p.name} in ${stageId}`).toBe([18, 14][i]);
      }
      const player = await prisma.player.findUniqueOrThrow({ where: { id: p.id } });
      expect([player.handicap, player.handicapSource], "the roster still says no index").toEqual([0, "none"]);
    }
    console.log(`[no-index-net] presses ${presses}, characters typed ${typed}, players ${noIndex.length}`);
    expect(presses, "one link, then one Enter per player").toBe(1 + noIndex.length);
    expect(errors).toEqual([]);
  });
});
