import { test, expect } from "./coverage";
import { watchPageErrors } from "./page-errors";
import { expectTournamentSays } from "./expect-tournament-says";
import { statusFixture, dayFromNow, prisma } from "./status-fixture";
import { expectRoundDoors, expectScopeLock, FIELD_LOCKED_LATE_ENTRY_WITH_FLIGHT, LOCKED_LIVE } from "./expect-tournament-locks";
import { pressComplete, pressReopen } from "./end-early";
import { END_EARLY } from "../src/lib/domain/lifecycle-track";

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
      lock: "open",
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
      lock: "open",
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

/**
 * A ROUND ROBIN IN FLIGHTS, WALKED FROM THE DRAW TO THE DAY IT IS REOPENED (J13:
 * the weakest row of the family table — the walk above stops in setup).
 *
 * Six players in one flight. Every pair meets once: n(n−1)/2, so FIFTEEN matches,
 * drawn here over five rounds of three by the circle method, as rows (the
 * Generate button is `organizer-round-robin`'s). At each stage the status, the
 * lock and the one next action:
 *
 *   every pair drawn        Setting up; nothing locked; Launch allowed
 *   launched, none played   Live; Rounds and The field locked by the launch, the way
 *                           out the committee correction; Complete refused (nothing
 *                           scored); Round 1's format and holes still OPEN
 *   A LATE ENTRANT (7a)     no flight: refused where the press is, in the rule's
 *                           words. With the flight: taken INTO it, a match against
 *                           each of the six drawn for them — the re-draw — and
 *                           nobody else's pairing touched: 21 matches, 7·6/2
 *   one match under way     Live; Complete allowed; Round 1's format and holes SHUT
 *                           with the reason (7b)
 *   every match over, the   Play over · Every round closed · results not released
 *   round closed
 *   completed               Completed; locked by completion, the way out Reopen
 *   reopened, by the press  Play over again; locked by the launch again
 *
 * WHAT IT CANNOT SEE: every match over with the round still OPEN (live, by the
 * Committee's act of closing — held in `tournament-status-by-family.test.ts`); a
 * second round added after launch (held there too); two flights, and a knockout's
 * reserve, which are `field-changes-after-the-draw.spec.ts`'s.
 *
 * Its own throwaway club (`zz-status-rrwalk-*`), invented names, `@example.invalid`,
 * deleted in `finally`; the late entrant is a row of that tournament and goes with
 * it. The walk SAVES (the late entry), so it blocks the service worker. Memory: one
 * context and one page, about 150 MB.
 */

/** Invented, like every name here. */
const LATE = "Oriel Tamsin";
const NO_FLIGHT = "In a round robin, a late entrant needs a flight. Without one they have no matches. Choose their flight in the Add form.";
const FORMAT_SHUT = "Round 1 was scored as Match Play; its cards would mean something else. Clear its scores on Score entry first.";
const HOLES_SHUT = "Round 1 has scores; at another length its cards would mean something else. Clear its scores on Score entry first.";

/** Every pair once, in rounds nobody plays twice in (the circle method; an even field). */
function everyPair(ids: readonly string[]): Array<{ round: number; a: string; b: string }> {
  const ring = [...ids];
  const out: Array<{ round: number; a: string; b: string }> = [];
  for (let r = 0; r < ids.length - 1; r += 1) {
    for (let i = 0; i < ring.length / 2; i += 1) out.push({ round: r + 1, a: ring[i], b: ring[ring.length - 1 - i] });
    ring.splice(1, 0, ring.pop()!);
  }
  return out;
}
const holes = (first: Array<"A" | "B" | "H">): string => JSON.stringify([...first, ...new Array(18 - first.length).fill(null)]);

test("a round robin in flights says the same thing at every stage, and takes a late entrant only with a flight (J13)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  const day = dayFromNow(9);
  const f = await statusFixture(browser, baseURL, testInfo, {
    family: "rrwalk",
    saves: true,
    event: { dates: "Club match play", startOn: day, endOn: day },
    rounds: [{ type: "Round Robin", format: "Match Play", playedOn: day }],
  });
  try {
    const page = await f.ctx.newPage();
    watchPageErrors(page, errors);
    const round1 = f.stageIds[0];
    const drawn = () => prisma.match.findMany({ where: { eventId: f.eventId, stageId: round1 }, select: { id: true, playerAId: true, playerBId: true }, orderBy: { id: "asc" } });

    // ── the flight made and every pair drawn: ready ─────────────────────────
    const flight = await prisma.group.create({ data: { eventId: f.eventId, name: "zz Flight A", position: 0 } });
    await prisma.player.updateMany({ where: { id: { in: f.playerIds } }, data: { groupId: flight.id } });
    const pairs = everyPair(f.playerIds);
    // The director's count, not the helper's: six players, fifteen matches, no pair twice.
    expect(f.playerIds.length, "the fixture's field is not six").toBe(6);
    expect(pairs.length).toBe(15);
    expect(new Set(pairs.map((p) => [p.a, p.b].sort().join("|"))).size, "a pair was drawn twice").toBe(15);
    await prisma.match.createMany({
      data: pairs.map((p) => ({ eventId: f.eventId, stageId: round1, groupId: flight.id, round: p.round, playerAId: p.a, playerBId: p.b, holes: holes([]) })),
    });
    await expectTournamentSays(page, { chip: "Setting up", lock: "open", nextAction: "Launch tournament", refused: null, home: { text: "ready to launch", action: "Launch tournament" } });

    // ── launched, no match played ───────────────────────────────────────────
    await prisma.event.update({ where: { id: f.eventId }, data: { status: "live", launchedAt: new Date(), configUnlocked: false } });
    await expectTournamentSays(page, {
      chip: "Live",
      lock: "live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
      home: null,
    });
    // Launch shuts none of a round's own settings: drawn and unplayed, its format and holes are open.
    await expectRoundDoors(page, round1, "Round 1", { format: null, holes: null });

    // ── a late entrant (7a): a flight is REQUIRED, and their matches are drawn against it ──
    const before = await drawn();
    expect(before.length).toBe(15);
    await expectScopeLock(page, "/registration", { scope: "The field", because: FIELD_LOCKED_LATE_ENTRY_WITH_FLIGHT, wayOut: "correction" });
    await expect(page.getByText("You can withdraw a player, put one back or add a late entry with a flight.", { exact: false }).first()).toBeVisible();
    await page.getByLabel("Player name").fill(LATE);
    // The Add form's own box ("Email · …"), not a row's "Email for …".
    await page.getByLabel(/^Email ·/).fill(`${f.mark}-late@example.invalid`);
    const pick = page.getByLabel("Flight · required in a round robin");
    await expect(pick).toHaveValue("");
    const add = page.getByRole("button", { name: "Add late entry" });
    await expect(add, "a late entry with no flight is offered in a round robin").toBeDisabled();
    await expect(page.getByText(NO_FLIGHT, { exact: false }).first()).toBeVisible();
    expect(await prisma.player.count({ where: { eventId: f.eventId, name: LATE } }), "a refused add wrote a row").toBe(0);

    await pick.selectOption(flight.id);
    await expect(add).toBeEnabled();
    await add.click();
    await expect
      .poll(async () => (await prisma.player.findFirst({ where: { eventId: f.eventId, name: LATE }, select: { groupId: true, status: true } })) ?? null, {
        timeout: 20_000,
        message: "the late entrant was not taken into the flight",
      })
      .toEqual({ groupId: flight.id, status: "confirmed" });
    // The answer first, then the rows: the action writes the player, THEN draws their matches, THEN
    // answers — the sentence under the press is said only once both are done (round G569-3).
    await expect(
      page.getByRole("status").filter({ hasText: new RegExp(`${LATE}’s matches against .+ are drawn\\. Each player in it has one more to play\\.`) }),
    ).toBeVisible({ timeout: 20_000 });
    const late = (await prisma.player.findFirstOrThrow({ where: { eventId: f.eventId, name: LATE }, select: { id: true } })).id;
    const after = await drawn();
    const theirs = after.filter((m) => m.playerAId === late || m.playerBId === late);
    expect(theirs.map((m) => (m.playerAId === late ? m.playerBId : m.playerAId)).sort(), "not one match against each player in the flight").toEqual([...f.playerIds].sort());
    expect(after.filter((m) => m.playerAId !== late && m.playerBId !== late), "somebody else's pairing changed").toEqual(before);
    // Seven players, every pair once: 7·6/2.
    expect(after.length).toBe(21);
    // Placed with the entry: never flagged as in no flight. And a late entrant is not a step.
    await page.goto(`/registration?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByRole("heading", { name: "Entries" })).toBeVisible();
    await expect(page.getByTestId("unplaced-flag")).toHaveCount(0);
    await expectTournamentSays(page, {
      chip: "Live",
      lock: "live",
      chipDetail: null,
      nextAction: END_EARLY,
      refused: { because: "Nothing has been scored yet", wayOut: { says: "Open Score entry", href: "/entry" } },
      home: null,
    });

    // ── one match under way (A wins the first, two halved): live, and the round's settings shut ──
    await prisma.match.update({ where: { id: before[0].id }, data: { holes: holes(["A", "H", "H"]), scoreStatus: "confirmed", confirmedBy: "zz" } });
    await expectTournamentSays(page, { chip: "Live", lock: "live", chipDetail: null, nextAction: END_EARLY, refused: null, home: null });
    await expectRoundDoors(page, round1, "Round 1", { format: FORMAT_SHUT, holes: HOLES_SHUT });

    // ── every match over (each won 3&2) and the Committee closes the round: play over ──
    await prisma.match.updateMany({
      where: { eventId: f.eventId, stageId: round1 },
      data: { holes: holes(["A", "A", "A", ...new Array<"H">(13).fill("H")]), scoreStatus: "confirmed", confirmedBy: "zz" },
    });
    await prisma.stage.update({ where: { id: round1 }, data: { closedAt: new Date() } });
    const over = {
      chip: "Play over",
      lock: "live",
      chipDetail: "Every round closed · results not released",
      home: { text: "Every round closed · results not released", action: "Complete tournament" },
      nextAction: "Complete tournament",
      refused: null,
    } as const;
    await expectTournamentSays(page, over);

    // ── completed, then reopened by the press ───────────────────────────────
    await page.goto(`/dashboard?bust=${Date.now()}`);
    await pressComplete(page);
    await page.getByRole("alertdialog").getByRole("button", { name: /^(Complete tournament|Complete it)$/ }).click();
    await expect.poll(f.status, { timeout: 20_000, message: "Complete did not complete it" }).toBe("completed");
    await expectTournamentSays(page, { chip: "Completed", lock: "completed", chipDetail: null, nextAction: "Reopen tournament", refused: null, home: null });
    await pressReopen(page);
    await expect.poll(f.status, { timeout: 20_000, message: "Reopen did not reopen it" }).toBe("live");
    await expectTournamentSays(page, over);
    expect(errors).toEqual([]);
  } finally {
    await f.done();
    await prisma.$disconnect();
  }
});
