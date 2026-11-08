import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";

/**
 * AN EIGHT-PLAYER CLUB KNOCKOUT, WALKED THROUGH THE STATE MACHINE (J13; the
 * knockout family) — every panel asked the same question at every stage.
 *
 * Eight players make seven ties (a draw of n has n-1): four quarter-finals, two
 * semi-finals and the Final. The stages, each as a tournament director reads them:
 *
 *   no dates                 Launch refused in place, the way out is Tournament details
 *   dated                    Launch allowed (flights are not a step of a straight knockout)
 *   launched, no tie played  Live; Complete refused — nothing has been scored
 *   two quarter-finals in    Live; the round is under way, Complete allowed
 *   all four quarters        Live — the semi-finals are drawn and not played, the Final is TBD
 *   both semi-finals         Live — the Final is the competition (Rule 3.2)
 *   the Final decided        Play over · "Final decided · results not released", with NO round
 *                            closed: nobody closes a Bracket Stage, so this is not "every round closed"
 *   completed                Reopen is the one action
 *
 * Results are `BracketWinner` rows, as the Bracket screen writes them. The seeds
 * run by handicap (the fixture's players are entered in handicap order), so the
 * eight-draw is 1v8, 4v5, 3v6, 2v7: the higher seed wins every tie below.
 *
 * WHAT IT CANNOT SEE: the unit matrix (`tournament-status-by-family.test.ts`)
 * holds the same walk for every field from 2 to 17 and the play-off for third; a
 * tie reported by a player and approved is `knockout-reports`'s. "Launch" is
 * pressed in `status-stroke.spec.ts`; here the launch is its result (status
 * live), so this spec watches the knockout and not the dialog.
 *
 * Its own throwaway club (`zz-status-knockout-*`), deleted in `finally`.
 */

test("a knockout says the same thing on every panel from the draw to the Final (J13)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "knockout",
    players: 8,
    event: { shape: "knockout", qualifyMode: "overall", qualifyOverall: 8, bracketMode: "single" },
    rounds: [{ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);
    const [p1, p2, p3, p4] = f.playerIds;
    const win = (key: string, winnerId: string, result: string) =>
      prisma.bracketWinner.create({ data: { eventId: f.eventId, key, winnerId, result } });

    // No dates: refused in place, with the way out.
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: { because: "This tournament has no dates", wayOut: { says: "Open Tournament details", href: "/event" } },
    });
    expect(await f.status(), "refusing changed the tournament").toBe("draft");

    // Dated: nothing else holds a knockout.
    const day = dayFromNow(10);
    await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Club knockout", startOn: day, endOn: day } });
    await expectTournamentSays(page, { chip: "Setting up", nextAction: "Launch tournament", refused: null });

    // Launched (what the Launch press leaves behind): the draw is made, no tie played.
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "live", configUnlocked: false } });
    await expectTournamentSays(page, {
      chip: "Live",
      chipDetail: null,
      nextAction: "Complete tournament",
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
    });

    // Two quarter-finals in (seed 1 beats 8, seed 4 beats 5): live, and Complete is allowed.
    await win("winners-0-0", p1, "3&2");
    await win("winners-0-1", p4, "1 up");
    await expectTournamentSays(page, { chip: "Live", chipDetail: null, nextAction: "Complete tournament", refused: null });

    // All four quarter-finals: the semi-finals are drawn and unplayed, the Final is TBD. Still live.
    await win("winners-0-2", p3, "2&1");
    await win("winners-0-3", p2, "4&3");
    await expectTournamentSays(page, { chip: "Live", chipDetail: null, nextAction: "Complete tournament", refused: null });

    // Both semi-finals (1 beats 4; 2 beats 3): the Final is drawn and unplayed. STILL live —
    // a knockout is not over until its Final is.
    await win("winners-1-0", p1, "2 up");
    await win("winners-1-1", p2, "1 up");
    // The secretary's home has nothing of this tournament's own to do while its Final is unplayed (PR 6).
    await expectTournamentSays(page, { chip: "Live", chipDetail: null, nextAction: "Complete tournament", refused: null, home: null });

    // The Final decided, and no round closed: Play over, said as a knockout says it — and the
    // secretary's home says it too (D3k: "every round closed" never could, nobody closes a Bracket Stage).
    await win("winners-2-0", p1, "19th");
    await expectTournamentSays(page, {
      chip: "Play over",
      chipDetail: "Final decided · results not released",
      nextAction: "Complete tournament",
      refused: null,
      home: { text: "Final decided · results not released", action: "Complete tournament" },
    });
    const rounds = await prisma.stage.findMany({ where: { eventId: f.eventId }, select: { closedAt: true } });
    expect(rounds.every((r) => r.closedAt === null), "a Bracket Stage was closed by something other than Complete").toBe(true);

    // Complete it, on the dashboard where the status card draws the button.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await page.getByRole("button", { name: "Complete tournament" }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^(Complete tournament|Complete it)$/ }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "Complete did not complete it" }).toBe("completed");
    await expectTournamentSays(page, { chip: "Completed", chipDetail: null, nextAction: "Reopen tournament", refused: null });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
