import { test, expect, type Page } from "./coverage";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { overflowing } from "./overflow";
import { savedBeforeReload } from "./save-settled";
import { prisma, makeClub, dropClub, makeEvent, addDays, dayIn, signIn } from "./rounds-fixture";
import { pressComplete, pressReopen } from "./end-early";
import { withTeeTimesAs } from "./console/teeTimes";

const data = JSON.parse(readFileSync(join(process.cwd(), ".e2e", "data.json"), "utf8"));
const league = data.league as {
  eventId: string;
  topClub: string;
  clubCount: number;
  pairsPerClub: number;
};

/**
 * THE INTERCLUB LEAGUE, IN A BROWSER, AT EVERY WIDTH.
 *
 * Twelve clubs and six pairs each is the league Ajay is running, and until
 * this file existed not one of its screens had ever been rendered by a test.
 * `layout.spec` visits `/teams` and `/week` on every run — with a stroke-play
 * medal as the active event, so `LeagueSection` returns null and the sweep
 * measures an empty page. A twelve-row table with a club column, six meetings
 * of six four-balls and a play-off bracket had no measured width anywhere.
 *
 * That is not a theoretical gap. On 2026-09-17 a fourth option on the club's
 * role picker pushed `/organization` past a 320px screen, and the only reason
 * anybody found out is that `layout.spec` renders that screen with data. A
 * control is exactly as wide as what it is given.
 *
 * WHAT EACH ASSERTION IS FOR, since a layout test is the easiest kind to write
 * as a no-op: the CONTENT check comes first every time. An empty page has no
 * horizontal overflow either, and this suite has been fooled by that before —
 * the note in `e2e/fixture.mjs` about a 404 passing the public-leaderboard
 * spec is the same failure. So each test proves the league is on the screen
 * before it measures anything about it.
 *
 * READ-ONLY, like every other spec sharing this fixture. Nothing here
 * nominates, draws or records a play-off hole: the league fixture is seeded
 * once and three viewports run against it.
 */

/**
 * The strings that prove the league actually rendered, not an empty section.
 *
 * By TEXT rather than by role, because the two screens title it differently
 * and both are correct: `/teams` opens a section with an `h2`, and `/week`
 * puts it in a card whose title is a `card-title` span. Binding to the role
 * would have made this assert the markup rather than what a member reads.
 */
async function leagueIsOnScreen(page: Page, heading: string) {
  await expect(page.getByText(heading, { exact: true }).first()).toBeVisible();
  // The club column, at its most awkward: an em dash, two curly apostrophes
  // and an ampersand in one name.
  await expect(page.getByText(league.topClub, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/League table|Season table/).first()).toBeVisible();
}

/** Nothing sticks out, and the document itself has not been widened. */
async function fitsTheViewport(page: Page, where: string) {
  const width = page.viewportSize()?.width ?? 0;
  const offenders = await overflowing(page);
  expect(
    offenders,
    `${where}: ${offenders.length} element(s) past the right edge — ${JSON.stringify(offenders.slice(0, 3))}`,
  ).toEqual([]);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `${where}: body is ${scrollWidth}px in a ${width}px viewport`).toBeLessThanOrEqual(
    width + 1,
  );
}

test.describe("the league secretary's screen", () => {
  test.use({ storageState: ".e2e/league-organizer.json" });

  test("/teams shows twelve clubs and their week, and fits the viewport", async ({ page }) => {
    await page.goto("/teams");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, "/teams redirected away — not signed in?").toBe("/teams");
    await expect(page.locator("#__next_error__")).toHaveCount(0);

    await leagueIsOnScreen(page, "Clubs, pairs and meetings");

    // The staff half: team sheets to nominate into, and the draw.
    await expect(page.getByText("This week’s team sheets")).toBeVisible();
    await expect(page.getByRole("button", { name: /Nominate pair/ }).first()).toBeVisible();

    /**
     * EVERY CLUB, not just the one at the top. A table that renders its first
     * row and drops the rest would satisfy every assertion above, and the
     * twelfth club is the row furthest down a phone.
     */
    const rows = await page.locator("table tbody tr").count();
    expect(rows, "fewer rows than the league has clubs").toBeGreaterThanOrEqual(league.clubCount);

    await fitsTheViewport(page, "/teams");
  });
});

test.describe("what a club's member sees", () => {
  test.use({ storageState: ".e2e/league-member.json" });

  test("/week shows their league read-only, and fits the viewport", async ({ page }) => {
    await page.goto("/week");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, "/week redirected away — not signed in?").toBe("/week");
    await expect(page.locator("#__next_error__")).toHaveCount(0);

    await leagueIsOnScreen(page, "Clubs and meetings");

    /**
     * READ-ONLY IS THE PRODUCT RULE, not a detail of this screen: players
     * enter scores, opt in and out, and sign up. Nominating a pair, drawing a
     * week and settling a play-off are the club's, and a captain hands their
     * six pairs to the organizer rather than typing them in here.
     *
     * Asserted as an ABSENCE on the screen a member actually opens, because
     * the server action refusing them is invisible to somebody looking at a
     * button they should never have been shown.
     */
    for (const staffOnly of [/Nominate pair/, /Draw the week/, /Record the play-off hole/, /Overturn this result/]) {
      await expect(page.getByRole("button", { name: staffOnly })).toHaveCount(0);
    }

    await fitsTheViewport(page, "/week");
  });
});

/**
 * @redesign: A LEAGUE'S WEEK ON TEE TIMES & DRAW (R9b). A league is built by the redesigned screen, titled for the
 * week ("This week"), with the same draw section as a medal. Unlike the read-only walks above, which share the
 * seeded interclub league, this one writes, so it has a throwaway weekly league of its own (a zz- club, deleted
 * after): the secretary makes the week's groups, sees them after a reload, and the match generator, which a league
 * never has (its sides are nominated), is not on the screen. Service workers blocked; memory: one browser context
 * and one page, about 150 MB.
 */
test.describe("@redesign the league week on Tee times & draw", () => {
  const WALKED = ["desktop", "phone"];
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("the secretary makes the week's groups for the whole field, kept after a reload, and no match generator is offered", async ({ browser, baseURL }, testInfo) => {
    test.skip(!WALKED.includes(testInfo.project.name), "two sizes: a third seeding proves nothing more");
    test.setTimeout(180_000);
    const mark = `zz-league-rd-${testInfo.project.name}`;
    const club = await makeClub(mark);
    try {
      const today = dayIn("");
      const made = await makeEvent(club, "Thursday League", {
        status: "live",
        stages: [
          { playedOn: addDays(today, 7), format: "Stroke Play" },
          { playedOn: addDays(today, 14), format: "Stroke Play" },
        ],
        players: 4,
        event: { attendanceMode: "opt-out" },
      });
      const round = made.stages[0];
      const sheet = async () => {
        const row = await prisma.stage.findUniqueOrThrow({ where: { id: round.id }, select: { teeSheet: true } });
        return ((JSON.parse(row.teeSheet || "{}").groups ?? []) as { playerIds: string[] }[]).flatMap((g) => g.playerIds).sort();
      };
      expect(await sheet(), "CONTROL: the week already has a sheet").toEqual([]);

      await withTeeTimesAs(browser, baseURL!, testInfo, { club, eventId: made.event.id }, async (screen, page) => {
        await screen.open(round.id);
        await expect(page.locator(".page-kicker").first()).toHaveText("This week");
        const draw = await screen.openSection("draw");
        await expect(draw.locator("[data-team-matches]"), "a league was offered Generate matches").toHaveCount(0);
        await draw.getByRole("button", { name: /^Balanced handicap/ }).click();
        await draw.getByLabel("First tee").fill("07:30");
        await draw.getByRole("button", { name: /^Save sheet/ }).click();
        await expect
          .poll(sheet, { message: "the week's sheet is not the four in the field" })
          .toEqual(made.players.map((p) => p.id).sort());
        await savedBeforeReload(draw); // "Save sheet" reads "Saving…" until the refresh is back (FoursomeMaker)
        await page.reload();
        const kept = await screen.openSection("draw");
        await expect(kept, "after a reload the draw section does not hold the week's sheet").toContainText("Saved as a draft");
        for (const p of made.players) await expect(kept).toContainText(p.name);
      });
    } finally {
      await dropClub(mark);
    }
  });
});

/**
 * A LEAGUE'S SIDES LOCK ONLY AT COMPLETION (B115b, PR A), PRESSED AS THE ORGANIZER.
 *
 * Journey: a secretary runs a club league: nominates each club's pairs for the week on Teams & pairs, withdraws one that
 * cannot play, draws the week, and at the end of the season makes the results final. Just before this change they could
 * nominate and withdraw all season; just after, they draw the week and play on. What changed is the two ends: a LIVE league
 * has no "is live" banner over controls that work, and a COMPLETED one shuts nominating, withdrawing and the league's
 * settings under the banner "Locked because the tournament is completed.", with Reopen the way out.
 *
 * What is pressed, as the organizer, on a throwaway league of its own (a zz- club, deleted after):
 *   1. CONTROL: live, Teams & pairs draws NO "is live" banner; Nominate pair writes a pair, Withdraw takes it down, and
 *      Save league settings saves (`nominatePair`, `withdrawPair`, `setLeagueSettings`).
 *   2. The page is left open (stale). On the dashboard, in another tab, the tournament is completed.
 *   3. Nominate pair is pressed on the stale page: the refusal is said beside the press in an alert, the banner arrives with
 *      the machine's words and Reopen, and Nominate, Withdraw and Save league settings are shut. After a reload the rows
 *      in the database are the ones from before the press.
 *   4. Reopen on the dashboard, and the same press nominates the pair.
 *
 * REACH: `nominatePair`, `withdrawPair` and `setLeagueSettings` are pressed live; `nominatePair` is pressed refused. NOT
 * pressed: `setPlayoffHoleWinner` (a play-off meeting needs a played, level week; its refusal is proved against real
 * rows in `league-writes-are-refused-when-completed.audit.test.ts`) and a refused `withdrawPair`/`setLeagueSettings`
 * (shut by the page after the first refusal, asserted as disabled).
 *
 * Service workers blocked; memory: two pages in one context, about 200 MB.
 */
test.describe("a league's sides lock only at completion (B115b)", () => {
  const WALKED = ["desktop", "phone"];
  // Club 0 (Aldwick): One..Four are nominated by the walk, Five and Six are the drawn week's pair. Club 1 (Brenham): One and Two are spare, Three and Four are the drawn week's pair.
  const NAMES: [string, number][] = [["Aldwick One", 0], ["Aldwick Two", 0], ["Aldwick Three", 0], ["Aldwick Four", 0], ["Aldwick Five", 0], ["Aldwick Six", 0], ["Brenham One", 1], ["Brenham Two", 1], ["Brenham Three", 1], ["Brenham Four", 1]];
  const DRAWN = ["Aldwick Five / Aldwick Six", "Brenham Three / Brenham Four"];
  const REFUSED = "Locked because the tournament is completed. Reopen it on the dashboard to nominate a pair.";

  test("a live league has no banner and nominates, withdraws and saves; completed, it is shut in words until Reopen", async ({ browser, baseURL }, testInfo) => {
    test.skip(!WALKED.includes(testInfo.project.name), "two sizes: a third seeding proves nothing more");
    test.setTimeout(240_000);
    const mark = `zz-league-lock-${testInfo.project.name}`;
    const club = await makeClub(mark);
    const context = await browser.newContext({ baseURL: baseURL!, serviceWorkers: "block" });
    try {
      // The fixture's facts, built here and read back below: a LAUNCHED, live league of two clubs and one team round.
      const made = await makeEvent(club, "Lock League", {
        status: "live",
        // A DATED week: a league whose next week has no day and no deadline offers "Set Round 1's day" as the dashboard's
        // job and no way to complete (the machine's `schedule` action), so the week is given its day like a real season's.
        stages: [{ type: "Round Robin", format: "Four-Ball", scoringBasis: "net", playedOn: addDays(dayIn(""), 7) }],
        players: 0,
        event: { shape: "series", leaguePoints: "match", leagueMatchBonus: 2, leaguePairs: 2, leaguePlayoffClubs: 0, launchedAt: new Date() },
      });
      const eventId = made.event.id;
      const round = made.stages[0];
      const clubs = [];
      for (const [i, name] of ["Aldwick", "Brenham"].entries()) {
        clubs.push(await prisma.group.create({ data: { eventId, name: `${mark} ${name}`, position: i }, select: { id: true } }));
      }
      const ids: Record<string, string> = {};
      for (const [i, [name, c]] of NAMES.entries()) {
        ids[name] = (
          await prisma.player.create({
            data: { eventId, name, email: `${mark}-lp${i}@example.invalid`, handicap: 8 + i, seed: i + 1, status: "confirmed", groupId: clubs[c].id },
            select: { id: true },
          })
        ).id;
      }
      /**
       * THE WEEK IS ALREADY DRAWN, as a real season's is when it is completed. Measured on CI (run 46055710250, the dashboard's
       * snapshot): with no match drawn the dashboard's job is "Generate Round 1 pairings" and the machine offers no Complete
       * or More at all (`owesDraw`; `nextAction` is the draw while a round owes one). So one pair a club is drawn into one
       * four-ball here, at seed 99 so they sit after the pairs the walk nominates, and the walk's counts leave them out.
       */
      const carrier = await prisma.group.create({ data: { eventId, stageId: round.id, isCarrier: true, name: "fixtures", position: 99 }, select: { id: true } });
      const drawn: string[] = [];
      for (const [c, [a, b]] of [[0, ["Aldwick Five", "Aldwick Six"]], [1, ["Brenham Three", "Brenham Four"]]] as [number, string[]][]) {
        const side = await prisma.team.create({ data: { eventId, stageId: round.id, clubGroupId: clubs[c].id, name: `${a} / ${b}`, seed: 99 }, select: { id: true } });
        await prisma.teamMember.createMany({ data: [{ teamId: side.id, playerId: ids[a], position: 0 }, { teamId: side.id, playerId: ids[b], position: 1 }] });
        drawn.push(side.id);
      }
      await prisma.match.create({
        data: { eventId, stageId: round.id, groupId: carrier.id, round: 1, playerAId: "", playerBId: "", teamAId: drawn[0], teamBId: drawn[1], holes: JSON.stringify(new Array(18).fill(null)) },
      });
      const status = async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true } })).status;
      expect(await status(), "the fixture's league is not live").toBe("live");
      const pairs = () => prisma.team.findMany({ where: { eventId, stageId: round.id, clubGroupId: { not: null }, name: { notIn: DRAWN } }, select: { name: true }, orderBy: { name: "asc" } });
      // A nominated pair's own row on the page: the drawn week's pairs have Withdraw buttons too.
      const rowOf = (p: Page, pair: string) => p.locator("li").filter({ hasText: pair });
      const pairCount = async () => (await pairs()).length;
      const settings = () => prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { leaguePoints: true, leaguePairs: true, leagueMatchBonus: true } });
      const banner = (p: Page) => p.getByRole("region", { name: "Locked" });

      await signIn(context, baseURL!, club, eventId);
      const page = await context.newPage();
      await page.goto(`/teams?round=${round.id}`);
      await expect(page.getByText("Clubs, pairs and meetings"), "the league is not on the screen").toBeVisible({ timeout: 30_000 });

      // ── 1. CONTROL: live. No banner; the three presses write ──
      await expect(banner(page), "a live league drew a lock banner over controls that work").toHaveCount(0);
      const nominate = page.getByRole("button", { name: /Nominate pair/ }).first();
      const pick = async (a: string, b: string) => {
        for (const who of [a, b]) await page.getByRole("button", { name: new RegExp(`^${who}`) }).click();
      };
      await pick("Aldwick One", "Aldwick Two");
      await nominate.click();
      await expect(page.getByText("Aldwick One / Aldwick Two"), "the nominated pair is not on the screen").toBeVisible({ timeout: 20_000 });
      await expect.poll(pairCount, { message: "Nominate pair wrote nothing" }).toBe(1);

      await rowOf(page, "Aldwick One / Aldwick Two").getByRole("button", { name: "Withdraw" }).click();
      await expect.poll(pairCount, { message: "Withdraw took nothing down" }).toBe(0);

      await page.getByText("League settings", { exact: true }).click();
      await page.getByLabel(/^Pairs per club each week/).fill("3");
      await page.getByRole("button", { name: "Save league settings" }).click();
      await expect(page.getByText("Saved.")).toBeVisible({ timeout: 20_000 });
      expect((await settings()).leaguePairs, "Save league settings wrote nothing").toBe(3);

      // The pair that is kept, and two names picked and waiting: the screen is now left as it is.
      await pick("Aldwick One", "Aldwick Two");
      await nominate.click();
      await expect.poll(pairCount, { message: "the pair to keep was not nominated" }).toBe(1);
      await pick("Aldwick Three", "Aldwick Four");
      const kept = await pairs();
      const savedSettings = await settings();

      // ── 2. In another tab, the tournament is completed ──
      const other = await context.newPage();
      await other.goto(`/dashboard?bust=${Date.now()}`);
      await pressComplete(other);
      // The week is unplayed, so ending asks about it first ("End this event early…" under More): "Complete anyway".
      await other.getByRole("alertdialog").getByRole("button", { name: /^(Complete anyway|Make results final|Complete it)$/ }).click();
      await expect.poll(status, { timeout: 30_000, message: "Complete did not complete it" }).toBe("completed");

      // ── 3. The stale page: Nominate is refused beside the press, and the screen catches up ──
      await nominate.click();
      const said = page.locator('[role="alert"]:not(#__next-route-announcer__)').filter({ hasText: REFUSED });
      await expect(said, "the refusal was not said beside Nominate").toBeVisible({ timeout: 20_000 });
      await expect(said, "the refusal was said off screen").toBeInViewport();
      await expect(banner(page), "the screen did not catch up with the lock").toContainText("Locked because the tournament is completed.", { timeout: 20_000 });
      await expect(banner(page).getByRole("link", { name: "Reopen it on the dashboard" }), "Reopen is not offered on the banner").toBeVisible();
      await expect(page.getByRole("button", { name: /Nominate pair/ }).first(), "Nominate stayed live").toBeDisabled();
      await expect(rowOf(page, "Aldwick One / Aldwick Two").getByRole("button", { name: "Withdraw" }), "Withdraw stayed live").toBeDisabled();
      await expect(page.getByRole("button", { name: "Save league settings" }), "Save league settings stayed live").toBeDisabled();

      await page.reload();
      await expect(page.getByText("Clubs, pairs and meetings")).toBeVisible({ timeout: 30_000 });
      expect(await pairs(), "a pair was written or taken while completed").toEqual(kept);
      expect(await settings(), "the league's settings changed while completed").toEqual(savedSettings);
      await expect(banner(page)).toContainText("Locked because the tournament is completed.");

      // ── 4. Reopen, and the same press nominates ──
      await pressReopen(other);
      await expect.poll(status, { timeout: 30_000, message: "Reopen did not reopen it" }).toBe("live");
      await page.reload();
      await expect(page.getByText("Clubs, pairs and meetings")).toBeVisible({ timeout: 30_000 });
      await expect(banner(page), "the banner stayed after Reopen").toHaveCount(0);
      await pick("Aldwick Three", "Aldwick Four");
      await page.getByRole("button", { name: /Nominate pair/ }).first().click();
      await expect.poll(pairCount, { message: "after Reopen the pair was not nominated" }).toBe(2);
    } finally {
      await context.close();
      await dropClub(mark);
    }
  });
});
