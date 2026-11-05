import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";

/**
 * THE CLUB FINAL — ONE 18-HOLE MATCH BETWEEN TWO PLAYERS — WALKED THROUGH THE
 * STATE MACHINE (J13; the single match family).
 *
 * A match is over the moment it cannot be caught (Rule 3.2a(1): a lead greater
 * than the holes remaining) — before the 18th, and whether or not the Committee
 * has closed the round. Level after 18 is not over (3.2a(4)). The stages:
 *
 *   no dates                       Launch refused in place, the way out is Tournament details
 *   dated, the match not made      Launch refused: "has no match made yet", the way out is Rounds & formats
 *   the match made                 Launch allowed (a single match is never held on Flights)
 *   launched, no hole played       Live; Complete refused — nothing scored
 *   a hole played                  Live; Complete allowed
 *   won 3&2, round NOT closed      Play over · "Every match over · results not released"
 *   completed                      Reopen
 *
 * The match is written as the app writes one (`createSingleMatch`): a carrier
 * group for the round and a `Match` with `round: 1` and a card of eighteen
 * holes, each 'A', 'B', 'H' (halved) or null. 3&2 is A winning the first three
 * and halving to the sixteenth: three up with two to play. The result is
 * confirmed, so what is being watched is the step and not the sign-off queue.
 *
 * WHAT IT CANNOT SEE: the tapping of holes (`match-results.spec.ts`), and a
 * two-leg series, held in `tournament-status-by-family.test.ts`.
 *
 * Its own throwaway club (`zz-status-match-*`), deleted in `finally`.
 */

const eighteen = (first: Array<"A" | "B" | "H">): string =>
  JSON.stringify([...first, ...new Array(18 - first.length).fill(null)]);

test("a single match says the same thing on every panel from the draw to the last green (J13)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "match",
    players: 2,
    rounds: [{ type: "Single Match Stage", format: "Match Play", scoringBasis: "gross" }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);
    const [a, b] = f.playerIds;

    // No dates.
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: { because: "This tournament has no dates", wayOut: { says: "Open Tournament details", href: "/event" } },
    });

    // Dated, but nobody has made the match: there is nothing to score.
    const day = dayFromNow(10);
    await prisma.event.update({ where: { id: f.eventId }, data: { dates: "Club final", startOn: day, endOn: day } });
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: { because: "has no match made yet", wayOut: { says: "Open Rounds & formats", href: "/stages" } },
    });

    // The match made, as `createSingleMatch` makes it.
    const carrier = await prisma.group.create({
      data: { eventId: f.eventId, stageId: f.stageIds[0], isCarrier: true, name: "Match Play — Round 1", position: 0 },
    });
    const match = await prisma.match.create({
      data: { eventId: f.eventId, stageId: f.stageIds[0], groupId: carrier.id, round: 1, playerAId: a, playerBId: b, holes: eighteen([]) },
    });
    await expectTournamentSays(page, { chip: "Setting up", nextAction: "Launch tournament", refused: null });

    // Launched, no hole played.
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "live", configUnlocked: false } });
    await expectTournamentSays(page, {
      chip: "Live",
      chipDetail: null,
      nextAction: "Complete tournament",
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
    });

    // Three holes played (A wins the first, the next two halved): live — a match is not over until it cannot be caught.
    await prisma.match.update({ where: { id: match.id }, data: { holes: eighteen(["A", "H", "H"]), scoreStatus: "confirmed", confirmedBy: "zz" } });
    await expectTournamentSays(page, { chip: "Live", chipDetail: null, nextAction: "Complete tournament", refused: null });

    // Won 3&2 with the round still open: the match is over, so play is over.
    await prisma.match.update({
      where: { id: match.id },
      data: { holes: eighteen(["A", "A", "A", ...new Array(13).fill("H")]) },
    });
    await expectTournamentSays(page, {
      chip: "Play over",
      chipDetail: "Every match over · results not released",
      nextAction: "Complete tournament",
      refused: null,
    });
    const round = await prisma.stage.findUniqueOrThrow({ where: { id: f.stageIds[0] }, select: { closedAt: true } });
    expect(round.closedAt, "the round was closed before Complete").toBeNull();

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
