import { test, expect } from "./coverage";
import { prisma, makeClub, dropClub, makeEvent, addDays, dayIn } from "./rounds-fixture";
import { withTeeTimesAs } from "./console/teeTimes";
import { consoleUrl } from "../src/lib/console-url";

/**
 * @redesign: AN INTERCLUB LEAGUE'S "DRAW THIS WEEK" IS MADE ON TEE TIMES & DRAW (B110; the Tournament Director's ruling
 * of 23 Nov). It is a weekly job, so it sits in the week's draw section beside the times, while the pairs are still
 * nominated on Teams & pairs. The secretary opens the week on the redesigned screen, presses it, and after a reload the
 * four-balls are there: the section offers a redraw instead of a first draw and the matches are stored. Teams & pairs,
 * opened in the same preview, says where the control went and does not draw a second one.
 *
 * Its own throwaway league (a zz- club, deleted after): two clubs of two, one pair nominated by each, so the week is two
 * four-balls' worth of pairs against pairs, read from the fixture. Service workers blocked; memory: one browser context
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
        players: 4,
        event: { leaguePoints: "match", leaguePairs: 1 },
      });
      const round = made.stages[0];
      // Two clubs (a flight each) of two players, and each club's one nominated pair for the week.
      const clubs = [];
      for (const [c, name] of ["Ardlui", "Balfron"].entries()) {
        const g = await prisma.group.create({ data: { eventId: made.event.id, name: `${mark} ${name}`, position: c } });
        const own = made.players.slice(c * 2, c * 2 + 2);
        await prisma.player.updateMany({ where: { id: { in: own.map((p) => p.id) } }, data: { groupId: g.id } });
        await prisma.team.create({
          data: {
            eventId: made.event.id,
            stageId: round.id,
            name: `${name} pair`,
            seed: 1,
            clubGroupId: g.id,
            members: { create: own.map((p, position) => ({ playerId: p.id, position })) },
          },
        });
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
});
