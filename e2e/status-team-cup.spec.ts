import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";
import { pressComplete } from "./end-early";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";

/**
 * A TWO-TEAM CUP, WALKED THROUGH THE STATE MACHINE (J13; the team cup family).
 *
 * Eight players, two teams of four, two singles sessions. A cup is two teams
 * with everybody on one — a third team is no cup, and a player on neither cannot
 * be picked for a session. Play is over when the cup is decided or every
 * session is closed. The stages:
 *
 *   three teams made           Launch refused: "A team cup is two teams, and this one has 3",
 *                              the way out is Team cup
 *   two teams, one on neither  Launch refused: "1 player is not on a team"
 *   everybody on a team        Launch allowed
 *   launched, nothing played   Live; Complete refused — nothing scored
 *   one match under way        Live; Complete allowed
 *   both sessions closed       Play over · "Every session closed · results not released"
 *                              (one match of the sessions' points is in, so the cup is not decided)
 *   completed                  Reopen
 *
 * The teams are the tournament's flights (a cup's two flights ARE its teams),
 * as `e2e/cup-fixture.mjs` makes them; the session is a head-to-head round of
 * type "Team Session". A cup decided before its sessions are closed ("Cup
 * decided") needs a points total that only the cup board can add, and is held
 * in `tournament-status-by-family.test.ts` (8.5 of 16 points; 8-8 is no winner).
 *
 * WHAT IT CANNOT SEE: the captains' lineups and the cup board's arithmetic
 * (`team-cup.spec.ts`, `a-finished-cup-shows-its-points.spec.ts`).
 *
 * Its own throwaway club (`zz-status-cup-*`), deleted in `finally`.
 */

test("a team cup says the same thing on every panel from the teams to the last session (J13)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const day = dayFromNow(14);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "cup",
    players: 8,
    event: { dates: "Autumn cup", startOn: day, endOn: dayFromNow(15), format: "match" },
    rounds: [
      { type: "Team Session", format: "Match Play", scoringBasis: "net" },
      { type: "Team Session", format: "Match Play", scoringBasis: "net" },
    ],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);
    const team = (name: string, position: number) => prisma.group.create({ data: { eventId: f.eventId, name, position } });
    const put = (ids: string[], groupId: string | null) => prisma.player.updateMany({ where: { id: { in: ids } }, data: { groupId } });

    // Three teams: a cup is two.
    const [blues, whites, greens] = [await team("zz Blues", 0), await team("zz Whites", 1), await team("zz Greens", 2)];
    await put(f.playerIds.slice(0, 3), blues.id);
    await put(f.playerIds.slice(3, 6), whites.id);
    await put(f.playerIds.slice(6, 8), greens.id);
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: { because: "A team cup is two teams, and this one has 3", wayOut: { says: "Open Team cup", href: "/cup" } },
    });

    // Two teams, and one player on neither.
    await put(f.playerIds.slice(6, 8), null);
    await prisma.group.delete({ where: { id: greens.id } });
    await put(f.playerIds.slice(0, 4), blues.id);
    await put(f.playerIds.slice(4, 7), whites.id);
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: { because: "1 player is not on a team", wayOut: { says: "Open Team cup", href: "/cup" } },
    });

    // Everybody on a team: ready.
    await put(f.playerIds.slice(4, 8), whites.id);
    await expectTournamentSays(page, { chip: "Setting up", nextAction: "Launch tournament", refused: null });

    // Launched, nothing played.
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "live", configUnlocked: false } });
    await expectTournamentSays(page, {
      chip: "Live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
    });

    // One singles match under way in the first session (Blues' first v Whites' first): live.
    const carrier = await prisma.group.create({
      data: { eventId: f.eventId, stageId: f.stageIds[0], isCarrier: true, name: "Match Play — Round 1", position: 3 },
    });
    await prisma.match.create({
      data: {
        eventId: f.eventId,
        stageId: f.stageIds[0],
        groupId: carrier.id,
        round: 1,
        playerAId: f.playerIds[0],
        playerBId: f.playerIds[4],
        holes: JSON.stringify(["A", "H", "H", ...new Array(15).fill(null)]),
      },
    });
    await expectTournamentSays(page, { chip: "Live", chipDetail: null, nextAction: END_EARLY, refused: null });

    // Both sessions closed by the Committee: play over. One match of a cup's points is in, so it is not decided.
    await prisma.stage.updateMany({ where: { eventId: f.eventId }, data: { closedAt: new Date() } });
    await expectTournamentSays(page, {
      chip: "Play over",
      chipDetail: "Every session closed · results not released",
      nextAction: "Complete tournament",
      refused: null,
    });

    await page.goto(`/dashboard?bust=${Date.now()}`);
    await pressComplete(page);
    await page.getByRole("alertdialog").getByRole("button", { name: /^(Complete tournament|Complete it)$/ }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "Complete did not complete it" }).toBe("completed");
    await expectTournamentSays(page, { chip: "Completed", chipDetail: null, nextAction: "Reopen tournament", refused: null });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
