import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, cardsIn, dayFromNow, prisma } from "./status-fixture";
import { pressComplete, pressReopen } from "./end-early";
import { expectScopeLock, expectRoundDoors, FIELD_LOCKED_LATE_ENTRY_OPEN, LOCKED_LIVE, LOCKED_COMPLETED, ROUNDS_FINAL } from "./expect-tournament-locks";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";

/**
 * A MEDAL, WALKED THROUGH EVERY STEP OF THE STATE MACHINE (PR 3; proposal 5c,
 * QA 8.4) — every panel asked the same question at every step, through
 * `expectTournamentSays`, as the organizer meets them.
 *
 * One Stroke Play round, six entered, the money answered, NO flights and NO
 * dates — a venue only. Two of the disagreements the machine settles:
 *
 *   D4  named, a venue, no dates: the details step used to tick ("a date or a
 *       venue") while Launch refused "no dates". Now the step holds, the rail
 *       points at it, and Launch is refused in place with the way out to
 *       Tournament details.
 *   D1  a medal with no flights: the rail, the checklist and the journey card
 *       used to say "No flights yet" and setup not done, while Launch worked.
 *       Now one field is a complete setup (Golf Pro, 8.2): Flights is marked
 *       "Optional" on the rail, nothing on the dashboard waits for it, and
 *       the journey says Launch.
 *
 * Then: launched (Complete refused — nothing scored — with the way out to
 * Score entry), the round's FIRST CARD in, every card in and the round closed
 * (Play over · Every round closed · results not released), completed, and
 * REOPENED by the press (play over again, Complete back).
 *
 * AND WHAT IS SHUT AT EACH OF THOSE, WITH THE REASON AND THE WAY OUT (J13's lock
 * column; state machine PR 5b and 7b, which came after this walk was written):
 *
 *   setting up        nothing locked on Rounds & formats or Tournament details;
 *                     Round 1's format and holes open
 *   launched          Rounds, Details and The field each "Locked because the
 *                     tournament is live.", the way out the Organizer's committee
 *                     correction (never Unlock) — and Round 1's format and holes
 *                     STILL OPEN: launching invalidates nothing a round setting decides
 *   the first card    Round 1's format and holes shut, the rounds rule's sentence
 *                     under them, the way out its scores cleared on Score entry
 *   completed         Rounds and Details "Locked because the tournament is
 *                     completed.", the way out a link to Reopen, NO correction
 *                     offered (Rule 20.2e); Round 1's settings shut as final
 *   reopened          locked by launch again, the correction back; Round 1 still
 *                     shut by its own cards
 *
 * WHAT IT CANNOT SEE: the cards are written as rows (approved), not typed — the
 * typing is `organizer-medal.spec.ts`'s; a late entrant, walked on a medal in
 * `day-of-field-changes.spec.ts` and on a Stableford in `status-stableford.spec.ts`;
 * a correction opened and what it then lets through (`locked-setup-refuses-in-words.spec.ts`).
 */

/** The rounds rule's sentences for a medal round with a card in (`round-change.ts`), written out. */
const FORMAT_SHUT = "Round 1 was scored as Stroke Play; its cards would mean something else. Clear its scores on Score entry first.";
const HOLES_SHUT = "Round 1 has scores; at another length its cards would mean something else. Clear its scores on Score entry first.";

test("a medal says the same thing on every panel at every step (D1, D4)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "stroke",
    rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    // D4: a venue and no dates — the details step holds, and Launch is refused in place.
    await expectTournamentSays(page, {
      chip: "Setting up",
      lock: "open",
      nextAction: "Launch tournament",
      refused: { because: "This tournament has no dates, so nobody can plan around it.", wayOut: { says: "Open Tournament details", href: "/event" } },
      setup: { holds: "Tournament details", done: 3, of: 5 },
      journey: "Set up",
    });
    expect(await f.status(), "refusing changed the tournament").toBe("draft");
    // Setting up: nothing is locked, and the round's own settings are open.
    await expectScopeLock(page, "/event", null);
    await expectRoundDoors(page, f.stageIds[0], "Round 1", { format: null, holes: null });

    // The dates set. D1: nothing else holds — Flights is optional, never "No flights yet".
    const day = dayFromNow(10);
    await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Saturday medal", startOn: day, endOn: day } });
    await expectTournamentSays(page, {
      chip: "Setting up",
      lock: "open",
      nextAction: "Launch tournament",
      refused: null,
      setup: { ready: true, done: 4, of: 5, optional: ["Flights"] },
      journey: "Launch",
    });
    await expect(page.locator("main"), "Tournament details still says flights are missing").not.toContainText("No flights yet");
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(page.locator("main"), "the dashboard still says flights are missing").not.toContainText("No flights yet");

    // Launch: the dialog lists the one field as a choice, not a gap — and the press launches.
    await page.getByRole("button", { name: "Launch tournament" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("region", { name: "Still open" })).toContainText("There are no flights, so the whole field plays as one division.", { timeout: 15_000 });
    await dialog.getByRole("button", { name: "Launch tournament" }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "the press did not launch it" }).toBe("live");

    // Live, nothing scored: Complete is the button, refused in place with the way out.
    await expectTournamentSays(page, {
      chip: "Live",
      lock: "live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
      setup: null,
      journey: "Play",
    });

    // Launched: each scope says it is locked by the launch, with the Organizer's committee
    // correction as the way out (PR 5b) — and the round's own format and holes are NOT under
    // that lock: with no card in, they are still open (PR 7b).
    await expectScopeLock(page, "/stages", { scope: "Rounds", because: LOCKED_LIVE, wayOut: "correction" });
    await expect(page.getByRole("region", { name: "Locked", exact: true }), "the banner does not say what launch leaves open").toContainText(
      "Until a round has scores, its format, holes, allowance, tees and day can change.",
    );
    await expectScopeLock(page, "/event", { scope: "Details", because: LOCKED_LIVE, wayOut: "correction" });
    await expectScopeLock(page, "/registration", { scope: "The field", because: FIELD_LOCKED_LATE_ENTRY_OPEN, wayOut: "correction" });
    await expectRoundDoors(page, f.stageIds[0], "Round 1", { format: null, holes: null });

    // THE ROUND'S FIRST CARD: one of six in, the round open. Still live, Complete now allowed —
    // and Round 1's format and holes are shut, each with the reason and the way out.
    await cardsIn(f, f.stageIds[0], f.playerIds.slice(0, 1));
    await expectTournamentSays(page, { chip: "Live", lock: "live", chipDetail: null, nextAction: END_EARLY, refused: null, setup: null, journey: "Play" });
    await expectRoundDoors(page, f.stageIds[0], "Round 1", { format: FORMAT_SHUT, holes: HOLES_SHUT });

    // Every card in and approved, and the committee closes the round: Play over (2d).
    await cardsIn(f, f.stageIds[0], f.playerIds.slice(1));
    await prisma.stage.update({ where: { id: f.stageIds[0] }, data: { closedAt: new Date() } });
    await expectTournamentSays(page, {
      chip: "Play over",
      lock: "live",
      chipDetail: "Every round closed · results not released",
      nextAction: "Complete tournament",
      refused: null,
      // The secretary's home offers the dashboard's own next action, in its words (PR 6).
      home: { text: "Every round closed · results not released", action: "Complete tournament" },
      setup: null,
      journey: "Play",
    });

    // Complete it (the free plan's keeping notice answered if the club is on it). On the
    // dashboard, where the status card draws the button: `setup: null` ended the helper on
    // Tournament details, which has no lifecycle button.
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await pressComplete(page);
    await page.getByRole("alertdialog").getByRole("button", { name: /^(Complete tournament|Complete it)$/ }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "Complete did not complete it" }).toBe("completed");
    await expectTournamentSays(page, { chip: "Completed", lock: "completed", chipDetail: null, nextAction: "Reopen tournament", refused: null, setup: null, journey: "Finish" });
    // Completed: locked by completion, the way out Reopen — and no correction opens a final result.
    const reopenIt = { says: "Reopen it on the dashboard", href: "/dashboard" };
    await expectScopeLock(page, "/event", { scope: "Details", because: LOCKED_COMPLETED, wayOut: reopenIt });
    await expectRoundDoors(page, f.stageIds[0], "Round 1", { format: ROUNDS_FINAL, holes: ROUNDS_FINAL });

    // REOPENED, by the press: live again with its round still closed, so play is over and
    // Complete is back; the lock is the launch's again, and Round 1 is still shut by its cards.
    await pressReopen(page);
    await expect.poll(f.status, { timeout: 20_000, message: "Reopen did not reopen it" }).toBe("live");
    await expectTournamentSays(page, {
      chip: "Play over",
      lock: "live",
      chipDetail: "Every round closed · results not released",
      nextAction: "Complete tournament",
      refused: null,
      setup: null,
      journey: "Play",
    });
    await expectRoundDoors(page, f.stageIds[0], "Round 1", { format: FORMAT_SHUT, holes: HOLES_SHUT });
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
