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

  it("marks the week as played in the strip", async () => {
    // The dot beside each week read cards too, so every night of a match
    // league wore "no scores yet" however many matches had been decided.
    const view = await weekViewFor(eventId, stageId);
    const week = view!.weeks.find((w) => w.stageId === stageId);
    expect(week, "this week is missing from its own strip").toBeTruthy();
    expect(week!.played).toBe(true);
  });
});
