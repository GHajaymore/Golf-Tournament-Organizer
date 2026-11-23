import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";
import { pressComplete, pressReopen } from "./end-early";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";
import { expectLateEntryRefused } from "./status-late-entrant";

/**
 * A LATE ENTRANT IN A KNOCKOUT (PR 9c; `field-change.ts`): REFUSED once launched, whether or not a tie
 * has been played, and the RESERVE is the way out. Before any result the draw is the field and an
 * Organizer's committee correction would open it; after the first result the draw is made, and the way
 * to draw again is clearing the results on the Bracket. Each sentence is the rule's, written out.
 */
const KNOCKOUT_LAUNCHED =
  "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. An Organizer can open the field with a committee correction.";
const KNOCKOUT_DRAWN =
  "The draw is made, so nobody can join the knockout. Add them as a reserve: they wait on the waiting list. To draw it again, clear its results on the Bracket.";
const LATE = "Idris Calloway";

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
  test.setTimeout(420_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "knockout",
    players: 8,
    // The reserve is typed and saved on Entries: a save spec blocks the service worker.
    saves: true,
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
      lock: "open",
      nextAction: "Launch tournament",
      refused: { because: "This tournament has no dates", wayOut: { says: "Open Tournament details", href: "/event" } },
    });
    expect(await f.status(), "refusing changed the tournament").toBe("draft");

    // Dated: nothing else holds a knockout.
    const day = dayFromNow(10);
    await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Club knockout", startOn: day, endOn: day } });
    await expectTournamentSays(page, { chip: "Setting up", lock: "open", nextAction: "Launch tournament", refused: null });

    // Launched (what the Launch press leaves behind): the draw is made, no tie played.
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "live" } });
    await expectTournamentSays(page, {
      chip: "Live",
      lock: "live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
    });

    // A late entrant (PR 9c): refused, with the reserve as the way out, and the reserve is taken.
    await expectLateEntryRefused(page, f, LATE, KNOCKOUT_LAUNCHED);
    await page.getByRole("button", { name: "Add as a reserve" }).click();
    await expect
      .poll(async () => (await prisma.player.findFirst({ where: { eventId: f.eventId, name: LATE }, select: { status: true } }))?.status ?? "", {
        timeout: 20_000,
        message: "the reserve was not taken",
      })
      .toBe("waitlisted");
    await expect(page.getByRole("status").filter({ hasText: `${LATE} is on the waiting list as a reserve. The draw does not change.` })).toBeVisible({ timeout: 20_000 });
    // Waiting is not entering: the tournament is where it was, the draw unchanged. The reserve goes so the walk is the eight's.
    expect(await f.status()).toBe("live");
    await prisma.player.deleteMany({ where: { eventId: f.eventId, name: LATE } });

    // Two quarter-finals in (seed 1 beats 8, seed 4 beats 5): live, and Complete is allowed.
    await win("winners-0-0", p1, "3&2");
    await win("winners-0-1", p4, "1 up");
    await expectTournamentSays(page, { chip: "Live", lock: "live", chipDetail: null, nextAction: END_EARLY, refused: null });
    // The draw now made at its first result: still refused, in the words that say how to draw again.
    await expectLateEntryRefused(page, f, LATE, KNOCKOUT_DRAWN);

    // All four quarter-finals: the semi-finals are drawn and unplayed, the Final is TBD. Still live.
    await win("winners-0-2", p3, "2&1");
    await win("winners-0-3", p2, "4&3");
    await expectTournamentSays(page, { chip: "Live", lock: "live", chipDetail: null, nextAction: END_EARLY, refused: null });

    // Both semi-finals (1 beats 4; 2 beats 3): the Final is drawn and unplayed. STILL live —
    // a knockout is not over until its Final is.
    await win("winners-1-0", p1, "2 up");
    await win("winners-1-1", p2, "1 up");
    // The secretary's home has nothing of this tournament's own to do while its Final is unplayed (PR 6).
    await expectTournamentSays(page, { chip: "Live", lock: "live", chipDetail: null, nextAction: END_EARLY, refused: null, home: null });

    // The Final decided, and no round closed: Play over, said as a knockout says it — and the
    // secretary's home says it too (D3k: "every round closed" never could, nobody closes a Bracket Stage).
    await win("winners-2-0", p1, "19th");
    await expectTournamentSays(page, {
      chip: "Play over",
      lock: "live",
      chipDetail: "Final decided · results not released",
      nextAction: "Make results final",
      refused: null,
      home: { text: "Final decided · results not released", action: "Make results final" },
    });
    const rounds = await prisma.stage.findMany({ where: { eventId: f.eventId }, select: { closedAt: true } });
    expect(rounds.every((r) => r.closedAt === null), "a Bracket Stage was closed by something other than Complete").toBe(true);

    // Complete it, on the dashboard where the status card draws the button.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await pressComplete(page);
    await page.getByRole("alertdialog").getByRole("button", { name: /^(Make results final|Complete it)$/ }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "Complete did not complete it" }).toBe("completed");
    await expectTournamentSays(page, { chip: "Completed", lock: "completed", chipDetail: null, nextAction: "Reopen tournament", refused: null });

    // Reopened by the press (a result entered the wrong way round): the Final is still decided, so play is over again.
    await pressReopen(page);
    await expect.poll(f.status, { timeout: 20_000, message: "Reopen did not reopen it" }).toBe("live");
    await expectTournamentSays(page, {
      chip: "Play over",
      lock: "live",
      chipDetail: "Final decided · results not released",
      nextAction: "Make results final",
      refused: null,
    });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
