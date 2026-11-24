import { test, expect } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, signIn, addDays, dayIn } from "./rounds-fixture";
import { withTeeTimesAs } from "./console/teeTimes";
import { consoleUrl } from "../src/lib/console-url";

/**
 * @redesign: AN INTERCLUB LEAGUE'S "DRAW THIS WEEK" IS MADE ON TEE TIMES & DRAW (B110; the Tournament Director's ruling
 * of 23 Nov). It is a weekly job, so it sits in the week's draw section beside the times, while the pairs are still
 * nominated on Teams & pairs. The secretary opens the week on the redesigned screen, presses it, and after a reload the
 * four-balls are there: the section offers a redraw instead of a first draw and the matches are stored. Teams & pairs,
 * opened in the same preview, says where the control went and does not draw a second one.
 *
 * Its own throwaway league (a zz- club, deleted after): two clubs of four, two pairs nominated by each, so the week is two
 * four-balls (first pair against first, second against second: `drawMeeting`), read from the fixture. Service workers blocked; memory: one browser context
 * and one page, about 150 MB.
 */
test.describe("@redesign interclub: Draw this week on Tee times & draw", () => {
  const WALKED = ["desktop", "phone"];
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("the secretary draws the week where the times are set, and sees the four-balls after a reload; Teams points there once", async ({ browser, baseURL }, testInfo) => {
    test.skip(!WALKED.includes(testInfo.project.name), "two sizes: a third seeding proves nothing more");
    test.setTimeout(180_000);
    const mark = `zz-interclub-draw-${testInfo.project.name}`;
    const club = await makeClub(mark);
    try {
      const made = await makeEvent(club, "Thursday Interclub", {
        status: "live",
        stages: [{ type: "Round Robin", format: "Four-Ball", playedOn: addDays(dayIn(""), 7) }],
        players: 8,
        event: { leaguePoints: "match", leaguePairs: 2 },
      });
      const round = made.stages[0];
      // Two clubs (a flight each) of two players, and each club's one nominated pair for the week.
      const clubs = [];
      for (const [c, name] of ["Ardlui", "Balfron"].entries()) {
        const g = await prisma.group.create({ data: { eventId: made.event.id, name: `${mark} ${name}`, position: c } });
        const own = made.players.slice(c * 4, c * 4 + 4);
        await prisma.player.updateMany({ where: { id: { in: own.map((p) => p.id) } }, data: { groupId: g.id } });
        // Two pairs a club: `drawMeeting` makes min(pairs of A, pairs of B) four-balls, so the week is two.
        for (const k of [0, 1]) {
          await prisma.team.create({
            data: {
              eventId: made.event.id,
              stageId: round.id,
              name: `${name} pair ${k + 1}`,
              seed: k + 1,
              clubGroupId: g.id,
              members: { create: own.slice(k * 2, k * 2 + 2).map((p, position) => ({ playerId: p.id, position })) },
            },
          });
        }
        clubs.push(g.id);
      }
      const drawn = () => prisma.match.count({ where: { eventId: made.event.id, stageId: round.id } });
      expect(await drawn(), "CONTROL: the week starts undrawn").toBe(0);

      await withTeeTimesAs(browser, baseURL!, testInfo, { club, eventId: made.event.id }, async (screen, page) => {
        await screen.open(round.id);
        const draw = await screen.openSection("draw");
        await expect(draw.locator("[data-league-pairs-pointer]"), "the draw section does not say where the pairs are nominated").toContainText("Teams & pairs");
        await expect(draw.getByRole("button", { name: "Redraw this week" }), "CONTROL: a week not drawn offers no redraw").toHaveCount(0);
        await draw.getByRole("button", { name: "Draw this week", exact: true }).click();
        await expect.poll(drawn, { message: "the week's four-balls were not stored" }).toBe(2);

        await page.reload();
        const kept = await screen.openSection("draw");
        await expect(kept.getByRole("button", { name: "Redraw this week" }), "after a reload the draw section does not hold the drawn week").toBeVisible();
        await expect(kept.getByRole("button", { name: "Draw this week", exact: true })).toHaveCount(0);

        // The old home of the control, in the same preview: a line that says where it went, and no second button.
        await page.goto(consoleUrl(`/teams?round=${round.id}`, "build"));
        const moved = page.locator("[data-league-draw-moved]");
        await expect(moved).toContainText("Tee times & draw");
        await expect(page.getByRole("button", { name: /^(Draw|Redraw) this week$/ }), "the week's draw is on Teams too").toHaveCount(0);
        await moved.getByRole("link", { name: "Tee times & draw" }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Tee times & draw" })).toBeVisible();
      });
    } finally {
      await dropClub(mark);
    }
  });

  /**
   * B115: A COMPLETED LEAGUE IS NOT REDRAWN (the Principal Engineer's design, 24 Nov). A live league is drawn every week, so
   * launch refuses nothing here; completion does, and Reopen is the way out. The secretary's screen is drawn while the league
   * is live and its week is drawn; the tournament is completed "in another tab" (the database, as the locked-setup spec does);
   * Redraw is pressed on the stale screen and refused in words beside the press; after a reload the four-balls are the same
   * rows, the banner is up and the button is shut; reopened, the same press replaces the week.
   */
  test("a completed league's week is not redrawn: refused in words beside the press, the same four-balls after a reload, drawn again once reopened", async ({ browser, baseURL }, testInfo) => {
    test.skip(!WALKED.includes(testInfo.project.name), "two sizes: a third seeding proves nothing more");
    test.setTimeout(180_000);
    const mark = `zz-interclub-done-${testInfo.project.name}`;
    const club = await makeClub(mark);
    try {
      const made = await makeEvent(club, "Thursday Interclub", {
        status: "live",
        stages: [{ type: "Round Robin", format: "Four-Ball", playedOn: addDays(dayIn(""), 7) }],
        players: 8,
        event: { leaguePoints: "match", leaguePairs: 2 },
      });
      const round = made.stages[0];
      for (const [c, name] of ["Ardlui", "Balfron"].entries()) {
        const g = await prisma.group.create({ data: { eventId: made.event.id, name: `${mark} ${name}`, position: c } });
        const own = made.players.slice(c * 4, c * 4 + 4);
        await prisma.player.updateMany({ where: { id: { in: own.map((p) => p.id) } }, data: { groupId: g.id } });
        for (const k of [0, 1]) {
          await prisma.team.create({
            data: {
              eventId: made.event.id,
              stageId: round.id,
              name: `${name} pair ${k + 1}`,
              seed: k + 1,
              clubGroupId: g.id,
              members: { create: own.slice(k * 2, k * 2 + 2).map((p, position) => ({ playerId: p.id, position })) },
            },
          });
        }
      }
      const matchIds = async () =>
        (await prisma.match.findMany({ where: { eventId: made.event.id, stageId: round.id }, select: { id: true }, orderBy: { id: "asc" } })).map((m) => m.id);
      const setStatus = (status: "live" | "completed") => prisma.event.update({ where: { id: made.event.id }, data: { status } });

      await withTeeTimesAs(browser, baseURL!, testInfo, { club, eventId: made.event.id }, async (screen, page) => {
        await screen.open(round.id);
        const draw = await screen.openSection("draw");
        await draw.getByRole("button", { name: "Draw this week", exact: true }).click();
        await expect.poll(async () => (await matchIds()).length, { message: "the week's four-balls were not stored" }).toBe(2);
        const drawnIds = await matchIds();
        await page.reload();
        const live = await screen.openSection("draw");
        await expect(live.getByRole("button", { name: "Redraw this week" }), "CONTROL: a live, launched league offers the redraw").toBeEnabled();
        await expect(live.getByText(/Locked because the tournament is completed/), "CONTROL: a live league says nothing of completion").toHaveCount(0);
        await expect(live.locator('[role="alert"]'), "CONTROL: a live league shows no refusal").toHaveCount(0);

        // Completed in another tab: this screen is stale and still offers the button.
        await setStatus("completed");
        await live.getByRole("button", { name: "Redraw this week" }).click();
        const refusal = live.locator('[role="alert"]').filter({ hasText: /Locked because the tournament is completed\..*draw a league week/ });
        await expect(refusal, "the refusal is not said beside the press").toBeVisible();
        await expect(refusal).toContainText("Reopen it on the dashboard");
        expect(await matchIds(), "a refused press changed the four-balls").toEqual(drawnIds);

        await page.reload();
        const shut = await screen.openSection("draw");
        // The banner's own sides line, in words (the tee sheet's lock also draws the banner, so its presence alone proves nothing).
        await expect(shut.locator('[data-locked-once="locked"]').getByText(/Locked because the tournament is completed/).first(), "the banner does not say why after the reload").toBeVisible();
        await expect(shut.getByRole("button", { name: "Redraw this week" }), "the button is still open on a completed league").toBeDisabled();
        expect(await matchIds(), "the four-balls changed").toEqual(drawnIds);

        // Reopen (the dashboard's button sets the status back); the same press now asks to replace, and replaces.
        await setStatus("live");
        await page.reload();
        const reopened = await screen.openSection("draw");
        await expect(reopened.getByRole("button", { name: "Redraw this week" })).toBeEnabled();
        await reopened.getByRole("button", { name: "Redraw this week" }).click();
        await reopened.getByRole("button", { name: "Replace them" }).click();
        await expect.poll(async () => (await matchIds()).some((id) => drawnIds.includes(id)), { message: "the week was not redrawn after Reopen" }).toBe(false);
        expect(await matchIds()).toHaveLength(2);
      });
    } finally {
      await dropClub(mark);
    }
  });

  /**
   * B115, THE TEAMS PAGE (the design's walk; QA gate 1): with the redesign switch OFF, Teams & pairs is where every club draws the
   * week today. Same story as above on `/teams`: a live league offers the draw and no completed words; completed in another tab,
   * the stale Redraw is refused beside the press; after a reload the button is shut, the banner says completed, the four-balls are
   * the same rows; reopened, the redraw goes through.
   */
  test("Teams & pairs: a completed league's Redraw is refused in words beside the press and stays shut after a reload; live, it draws", async ({ browser, baseURL }, testInfo) => {
    test.skip(!WALKED.includes(testInfo.project.name), "two sizes: a third seeding proves nothing more");
    test.setTimeout(180_000);
    const mark = `zz-interclub-teams-${testInfo.project.name}`;
    const club = await makeClub(mark);
    try {
      const made = await makeEvent(club, "Thursday Interclub", {
        status: "live",
        stages: [{ type: "Round Robin", format: "Four-Ball", playedOn: addDays(dayIn(""), 7) }],
        players: 8,
        event: { leaguePoints: "match", leaguePairs: 2 },
      });
      const round = made.stages[0];
      for (const [c, name] of ["Ardlui", "Balfron"].entries()) {
        const g = await prisma.group.create({ data: { eventId: made.event.id, name: `${mark} ${name}`, position: c } });
        const own = made.players.slice(c * 4, c * 4 + 4);
        await prisma.player.updateMany({ where: { id: { in: own.map((p) => p.id) } }, data: { groupId: g.id } });
        for (const k of [0, 1]) {
          await prisma.team.create({
            data: {
              eventId: made.event.id,
              stageId: round.id,
              name: `${name} pair ${k + 1}`,
              seed: k + 1,
              clubGroupId: g.id,
              members: { create: own.slice(k * 2, k * 2 + 2).map((p, position) => ({ playerId: p.id, position })) },
            },
          });
        }
      }
      const matchIds = async () =>
        (await prisma.match.findMany({ where: { eventId: made.event.id, stageId: round.id }, select: { id: true }, orderBy: { id: "asc" } })).map((m) => m.id);
      const setStatus = (status: "live" | "completed") => prisma.event.update({ where: { id: made.event.id }, data: { status } });

      const context = await browser.newContext({ ...testInfo.project.use, baseURL: baseURL!, serviceWorkers: "block" });
      try {
        await signIn(context, baseURL!, club, made.event.id);
        const page = await context.newPage();
        await page.goto(`/teams?round=${round.id}`);
        await expect(page.getByRole("heading", { level: 1, name: "Teams & pairs" })).toBeVisible();
        const draw = page.getByRole("button", { name: "Draw this week", exact: true });
        await expect(draw, "CONTROL: a live league offers the draw on Teams").toBeEnabled();
        await expect(page.getByText(/Locked because the tournament is completed/), "CONTROL: live says nothing of completion").toHaveCount(0);
        await draw.click();
        await expect.poll(async () => (await matchIds()).length, { message: "the week's four-balls were not stored" }).toBe(2);
        const drawnIds = await matchIds();
        await page.reload();
        const redraw = page.getByRole("button", { name: "Redraw this week" });
        await expect(redraw).toBeEnabled();

        // Completed in another tab: the stale screen still offers the press.
        await setStatus("completed");
        await redraw.click();
        const refusal = page.locator('[role="alert"]').filter({ hasText: /Locked because the tournament is completed\..*draw a league week/ });
        await expect(refusal, "the refusal is not said beside the press").toBeVisible();
        expect(await matchIds(), "a refused press changed the four-balls").toEqual(drawnIds);

        await page.reload();
        await expect(page.getByRole("button", { name: "Redraw this week" }), "the button is open on a completed league").toBeDisabled();
        await expect(page.locator("#scope-lock-banner").getByText(/Locked because the tournament is completed/).first(), "the banner does not say why").toBeVisible();
        expect(await matchIds(), "the four-balls changed").toEqual(drawnIds);

        await setStatus("live");
        await page.reload();
        await expect(page.getByRole("button", { name: "Redraw this week" })).toBeEnabled();
        await page.getByRole("button", { name: "Redraw this week" }).click();
        await page.getByRole("button", { name: "Replace them" }).click();
        await expect.poll(async () => (await matchIds()).some((id) => drawnIds.includes(id)), { message: "the week was not redrawn after Reopen" }).toBe(false);
        expect(await matchIds()).toHaveLength(2);
      } finally {
        await context.close();
      }
    } finally {
      await dropClub(mark);
    }
  });
});
