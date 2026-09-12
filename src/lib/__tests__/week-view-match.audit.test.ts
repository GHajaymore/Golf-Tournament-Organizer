import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { weekViewFor } from "@/lib/services/week-view";

/**
 * A MATCH-PLAY LEAGUE NIGHT IS NOT AN EMPTY ONE.
 *
 * The week sheet decided whether a night had been played by looking for
 * CARDS — and a match-play week keeps its results on the matches, so every
 * player's `thru` was nought, the night's results list came back empty, and
 * the screen said "No scores are in for week 1 yet".
 *
 * Demo Cup showed exactly that over FORTY-SEVEN completed matches. And the
 * emptiness blanked the whole screen, including the season table beneath it —
 * which has a match branch (`chainRoundStandings`) and had the points all
 * along. The one section that could answer the question was hidden by the one
 * that could not.
 *
 * The same fault as `PlayerLeaderboard` reading `thru > 0` for a match board.
 * That one was fixed; this one was not, which is why it is asserted here
 * rather than left to be noticed a third time.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WEEK-MATCH";

let eventId = "";
let stageId = "";
let medalWeekId = "";
let legacyWeekId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "society" } });

  // A weekly league of match play — `series`, which is what the landing page
  // advertises and what Demo Cup is.
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      shape: "series",
      format: "match",
      status: "active",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
    },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Week 1",
      type: "Round Robin",
      format: "Match Play",
      holes: 18,
    },
  });
  stageId = stage.id;

  const group = await prisma.group.create({ data: { eventId, name: `${TAG} group`, position: 0 } });

  const [a, b] = await Promise.all([
    prisma.player.create({
      data: { eventId, groupId: group.id, name: `${TAG} Ann`, email: `${TAG}-ann@example.invalid`.toLowerCase(), seed: 1, status: "confirmed", handicap: 10 },
    }),
    prisma.player.create({
      data: { eventId, groupId: group.id, name: `${TAG} Bob`, email: `${TAG}-bob@example.invalid`.toLowerCase(), seed: 2, status: "confirmed", handicap: 12 },
    }),
  ]);

  /**
   * One match, decided, and NOT A SINGLE SCORECARD.
   *
   * That absence is the whole fixture: it is exactly the state a match-play
   * league is in every week, and the state the old code read as "nobody has
   * played".
   */
  await prisma.match.create({
    data: {
      eventId,
      stageId,
      groupId: group.id,
      round: 1,
      playerAId: a.id,
      playerBId: b.id,
      holes: JSON.stringify(["A", "A", "H", "B", "A", ...new Array(13).fill(null)]),
    },
  });

  /**
   * WEEK 2 IS A MEDAL, inside the same match-format league.
   *
   * WEEKLY_ROUND_TYPES is Round Robin AND Stroke Play Round, so this is an
   * ordinary league that plays one medal night — not an exotic setup. It is
   * the MIRROR of the fixture above, and the strip got it wrong the same way
   * round: it asked event.format, which says "match" for the whole season, so
   * it went looking for matches on a week that keeps its result on cards.
   */
  const medal = await prisma.stage.create({
    data: {
      eventId,
      position: 1,
      description: "Week 2",
      type: "Stroke Play Round",
      format: "Stroke Play",
      scoringBasis: "gross",
      holes: 18,
    },
  });
  medalWeekId = medal.id;

  // One card, and NOT A SINGLE MATCH on it — the absence is the fixture, just
  // as the missing scorecard was above.
  await prisma.scorecard.create({
    data: {
      eventId,
      stageId: medalWeekId,
      playerId: a.id,
      strokes: JSON.stringify([4, 5, 4, 3, 5, ...new Array(13).fill(null)]),
    },
  });

  /**
   * WEEK 3 IS THE LEGACY MEDAL: a Round Robin whose FORMAT is Stroke Play.
   *
   * Before `Stroke Play Round` existed that was the only way to run a medal
   * night, so a league of any age has weeks of this shape and they are still
   * scored off cards. `roundIsStroke` first read the TYPE alone, which calls
   * this one head-to-head — so the strip went looking for matches on a week
   * that has none, and `empty` blanked the sheet under it.
   *
   * The board hit the identical fault on the identical day; this is the week
   * sheet's half of it.
   */
  const legacy = await prisma.stage.create({
    data: {
      eventId,
      position: 2,
      description: "Week 3",
      type: "Round Robin",
      format: "Stroke Play",
      scoringBasis: "gross",
      holes: 18,
    },
  });
  legacyWeekId = legacy.id;

  await prisma.scorecard.create({
    data: {
      eventId,
      stageId: legacyWeekId,
      playerId: b.id,
      strokes: JSON.stringify([5, 4, 4, 4, 5, ...new Array(13).fill(null)]),
    },
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a match-play league night", () => {
  it("is not reported as having no scores", async () => {
    const view = await weekViewFor(eventId, stageId);
    expect(view, "the week sheet did not build at all").toBeTruthy();
    expect(
      view!.empty,
      "a week with a decided match was called empty, which blanks the whole screen",
    ).toBe(false);
  });

  it("still shows the season table, which is where its result lives", async () => {
    // The point of not blanking. `chainRoundStandings` had these points the
    // whole time; nothing rendered them.
    const view = await weekViewFor(eventId, stageId);
    expect(view!.standings.length, "no standings on a played match week").toBeGreaterThan(0);
    const total = view!.standings.reduce((a, r) => a + r.value, 0);
    expect(total, "a decided match awarded nobody anything").toBeGreaterThan(0);
  });

  it("offers no gross-and-net table, because a match night has none", async () => {
    /**
     * `empty` and `hasScoreTable` are different questions, and conflating them
     * is what caused this. A played match week is NOT empty and has NO score
     * table; rendering one would print an empty gross/net grid headed
     * "0 played".
     */
    const view = await weekViewFor(eventId, stageId);
    expect(view!.hasScoreTable).toBe(false);
    expect(view!.results).toEqual([]);
  });

  it("marks a MEDAL week in the same league as played too", async () => {
    /**
     * THE MIRROR, and the one this file did not have. The strip asked
     * event.format — one value for a whole season — so a league that plays one
     * medal night looked for MATCHES on it and found none, however many cards
     * were in. Seen on the Demo Cup on 2026-09-12: week 2 is a Stroke Play
     * Round with seven cards returned and it wore the "no scores yet" dot.
     *
     * It reads the WEEK’S OWN TYPE now — roundIsStroke — which is the same
     * correction the boards got.
     */
    const view = await weekViewFor(eventId, medalWeekId);
    const week = view!.weeks.find((w) => w.stageId === medalWeekId);
    expect(week, "the medal week is missing from the strip").toBeTruthy();
    expect(week!.played, "a medal week with a card was marked unplayed").toBe(true);
    // And the match week beside it is still right, which is the half a fix
    // keyed on the wrong thing would have broken.
    expect(view!.weeks.find((w) => w.stageId === stageId)!.played).toBe(true);

    /**
     * THE SAME QUESTION ASKED TWICE, AND BOTH HAD TO BE FIXED. The strip's dot
     * and the sheet's own `empty` are separate computations of "has this week
     * been played" — and `empty` is the one that blanks the whole screen,
     * including the season table beneath it.
     *
     * Asserted because a mutation proved it had to be: reverting the strip
     * alone went red here and reverting `empty` alone did not, so without this
     * line half the fix was untested.
     */
    expect(view!.empty, "the medal week blanked the whole sheet").toBe(false);
  });

  it("marks a ROUND ROBIN SET TO STROKE PLAY as played too", async () => {
    /**
     * The shape the type alone gets wrong. Head-to-head by type, a medal in
     * fact, one card in and no matches at all — so reading the type sent the
     * strip after matches and it found none.
     */
    const view = await weekViewFor(eventId, legacyWeekId);
    const week = view!.weeks.find((w) => w.stageId === legacyWeekId);
    expect(week, "the legacy medal week is missing from the strip").toBeTruthy();
    expect(week!.played, "a medal week with a card was marked unplayed").toBe(true);
    // The sheet's own copy of the same question, which is the one that blanks
    // the screen. Both had to be fixed for the board; both have to be here.
    expect(view!.empty, "the legacy medal week blanked the whole sheet").toBe(false);
    // And it has a real score table, because it is genuinely scored off cards.
    expect(view!.hasScoreTable).toBe(true);
    expect(view!.results.length).toBeGreaterThan(0);
  });

  it("marks the week as played in the strip", async () => {
    // The dot beside each week read cards too, so every night of a match
    // league wore "no scores yet" however many matches had been decided.
    const view = await weekViewFor(eventId, stageId);
    const week = view!.weeks.find((w) => w.stageId === stageId);
    expect(week, "this week is missing from its own strip").toBeTruthy();
    expect(week!.played).toBe(true);
  });
});
