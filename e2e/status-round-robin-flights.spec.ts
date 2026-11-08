import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";

/**
 * A ROUND ROBIN WITH NOTHING DRAWN SAYS WHY (J06; state machine PR 3).
 *
 * The dashboard's Matches tile read "Matches complete 0/0 · 0% of this round"
 * over a round robin with no flights — true, and no use: nothing said why
 * nothing was drawn, or what to press. A round robin is played inside its
 * flights (every player meets everyone in theirs), so:
 *
 *   no flights           "No flights yet" — and the link to make them;
 *   flights, no draw     "Not drawn yet" — and the link to generate the pairings.
 *
 * And the D1 control the Golf Pro asked for (8.2): flights stay REQUIRED for a
 * round robin — Launch is refused in place, the rail holds on Flights, and
 * nothing calls them optional.
 */

test("a round robin with nothing drawn says why on the dashboard, and flights stay required (J06)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const day = dayFromNow(9);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "rr",
    event: { dates: "Club match play", startOn: day, endOn: day },
    rounds: [{ type: "Round Robin", format: "Match Play", playedOn: day }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);

    // No flights: refused in place, held on Flights — never "Optional".
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: { because: "Round 1 has no pairings, so there are no matches to score.", wayOut: { says: "Open Flights", href: "/grouping" } },
      setup: { holds: "Flights", done: 4, of: 5 },
      journey: "Set up",
    });
    await page.goto(`/dashboard?bust=${Date.now()}`);
    const tile = page.locator(".nothing-drawn");
    await expect(tile, "the Matches tile does not say why nothing is drawn").toContainText("No flights yet", { timeout: 30_000 });
    await expect(tile).toContainText("A round robin is played inside flights, and none are made yet, so nobody has anyone to play.");
    await expect(tile.getByRole("link", { name: "Make the flights on Flights" })).toHaveAttribute("href", "/grouping");
    await expect(page.locator("main"), "the tile's old fraction came back").not.toContainText("0/0");

    // A flight made with everybody in it, and no draw: the pairings are owed.
    const flight = await prisma.group.create({ data: { eventId: f.eventId, name: "zz Flight A", position: 0 } });
    await prisma.player.updateMany({ where: { id: { in: f.playerIds } }, data: { groupId: flight.id } });
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await expect(tile).toContainText("Not drawn yet", { timeout: 30_000 });
    await expect(tile).toContainText("The flights are made, but Round 1's pairings have not been generated.");
    await expect(tile.getByRole("link", { name: "Generate them on Rounds & formats" })).toHaveAttribute("href", "/stages");
    // And Launch's way out is where the refusal says Generate is — Rounds & formats, not Flights
    // (state machine PR 5c review) — on the dashboard, the rail and the Course day timeline alike.
    await expectTournamentSays(page, {
      chip: "Setting up",
      nextAction: "Launch tournament",
      refused: { because: "Generate them on Rounds & formats", wayOut: { says: "Open Rounds & formats", href: "/stages" } },
      setup: { holds: "Rounds & formats", done: 4, of: 5 },
      timeline: true,
    });
    expect(await f.status(), "nothing here changed the tournament").toBe("draft");
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
