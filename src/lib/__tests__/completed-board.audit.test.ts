import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A TOURNAMENT THE CLUB HAS MARKED COMPLETED IS FINAL ON THE PUBLIC BOARD.
 *
 * The console shows "Completed", locks the configuration and starts the
 * retention clock. The public share link — the one screen a club actually
 * SENDS to members and families — went on saying LIVE, because `allIn` only
 * ever asked whether every card was in.
 *
 * A card can legitimately stop short: a withdrawal, a match won 5&4, somebody
 * who walked in at the turn. So a finished tournament with one short card read
 * as still being played, to the audience least able to know otherwise.
 *
 * Two readers of one fact, and the authoritative one was never asked.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

// The board is `unstable_cache`d in production. Identity here, so each read
// reflects the row as it stands rather than a minute ago.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { liveBoard } from "@/lib/services/live-board";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-COMPLETED";

let eventId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open`,
      status: "live",
      format: "stroke",
      shape: "single",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      leaderboardVisibility: "public",
      shareToken: `${TAG}-${Date.now()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Round 1",
      type: "Stroke Play Round",
      format: "Individual Stroke Play",
      holes: 18,
      scoringBasis: "gross",
    },
  });

  const player = await prisma.player.create({
    data: {
      eventId,
      name: `${TAG} Ann`,
      email: `${TAG}-ann@example.invalid`.toLowerCase(),
      seed: 1,
      status: "confirmed",
      handicap: 10,
    },
  });

  /**
   * ONE CARD, NINE HOLES OF EIGHTEEN — the whole fixture.
   *
   * A short card is not a broken one, and it is exactly what keeps `allIn`
   * false on a day that has finished: somebody withdrew at the turn, or the
   * match ended 5&4. Without it this asserts nothing, because a complete card
   * makes the board Final for the ordinary reason.
   */
  await prisma.scorecard.create({
    data: {
      eventId,
      stageId: stage.id,
      playerId: player.id,
      strokes: JSON.stringify([...new Array(9).fill(4), ...new Array(9).fill(null)]),
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

describe("the public board and the committee agree about being finished", () => {
  it("says LIVE while the club is still playing and a card is short", async () => {
    // The precondition. If this were already Final the test below would pass
    // for the wrong reason — a fixture that cannot express the bug.
    const board = await liveBoard(eventId);
    expect(board, "the board did not build").toBeTruthy();
    expect(board!.allIn, "a live round with a nine-hole card is not final").toBe(false);
  });

  it("says FINAL once the club marks the tournament completed", async () => {
    await prisma.event.update({
      where: { id: eventId },
      data: { status: "completed", completedAt: new Date() },
    });

    const board = await liveBoard(eventId);
    expect(
      board!.allIn,
      "the club called it finished and its own share link still said LIVE",
    ).toBe(true);
  });

  it("goes back to LIVE if the club reopens it", async () => {
    /**
     * Reopening is a real action — `setEventStatus` clears `completedAt` for
     * it, because a club that un-completes an event has said the result is not
     * final after all. The board must follow, or it would be stuck Final over
     * a tournament being scored again.
     */
    await prisma.event.update({
      where: { id: eventId },
      data: { status: "live", completedAt: null },
    });

    const board = await liveBoard(eventId);
    expect(board!.allIn, "a reopened tournament is being played again").toBe(false);
  });
});

/**
 * AND A ROUND IS NOT FINAL WHILE SOMEBODY IS STILL TO TEE OFF.
 *
 * The card reading asked whether every player who had BEGUN was finished, and
 * that is true of a morning tee time at one o'clock while the afternoon groups
 * are in the car park.
 *
 * Walked on 2026-09-10, on a charity day built from its own template: four
 * complete cards, two players with none, and a grey FINAL chip directly above
 * two rows the same board had rendered as "not started". The screen
 * contradicted itself, to the audience least able to know otherwise — which is
 * the audience a charity day's public board exists for.
 *
 * A SEPARATE EVENT from the one above, deliberately. That fixture is one
 * player with a SHORT card, which is the case that must keep working: a
 * withdrawal at the turn returns some holes and must not hold the board Live
 * for ever. This one is about a player with NOTHING, which the app cannot
 * distinguish from a no-show — so "Live" is the honest reading, and the
 * committee's own "Completed" is what resolves it.
 */
describe("a round with somebody still to start", () => {
  let dayId = "";
  const DAY = `${TAG} day`;
  const PARS = new Array(18).fill(4);

  beforeAll(async () => {
    const org = await prisma.organization.findFirst({ where: { name: { startsWith: TAG } } });
    const event = await prisma.event.create({
      data: {
        organizationId: org!.id,
        name: DAY,
        status: "live",
        format: "stroke",
        shape: "single",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        leaderboardVisibility: "public",
        shareToken: `${TAG}-day-${Date.now()}`,
        customPars: JSON.stringify(PARS),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
      select: { id: true },
    });
    dayId = event.id;
    const stage = await prisma.stage.create({
      data: {
        eventId: dayId,
        position: 0,
        description: "Round 1",
        type: "Stroke Play Round",
        format: "Individual Stroke Play",
        holes: 18,
        scoringBasis: "gross",
      },
      select: { id: true },
    });

    // Two players. One has walked in with a full card; the other has not
    // teed off, which is what an afternoon tee time looks like at lunchtime.
    for (const [i, who] of ["early", "late"].entries()) {
      const player = await prisma.player.create({
        data: {
          eventId: dayId,
          name: `${TAG} ${who}`,
          email: `${TAG}-${who}@example.invalid`.toLowerCase(),
          seed: i + 1,
          status: "confirmed",
          handicap: 12,
        },
        select: { id: true },
      });
      if (who === "early") {
        await prisma.scorecard.create({
          data: { eventId: dayId, stageId: stage.id, playerId: player.id, strokes: JSON.stringify(PARS) },
        });
      }
    }
  });

  it("says LIVE, not FINAL, while a player has no card at all", async () => {
    const board = await liveBoard(dayId);
    expect(board, "the board did not build").toBeTruthy();
    // The precondition, asserted rather than assumed: the board itself is
    // showing somebody as not started. If it were not, this would pass on a
    // fixture that cannot express the bug.
    expect(board!.rows.some((r) => r.thru === 0), "somebody is still to tee off").toBe(true);
    expect(board!.rows.some((r) => r.thru >= 18), "and somebody has finished").toBe(true);
    expect(board!.allIn, "a field still on the course is not a final result").toBe(false);
  });

  it("and FINAL once the last card is in", async () => {
    /**
     * THE ASSERTION THAT STOPS THIS BECOMING "NEVER SAY FINAL". Without it the
     * rule could refuse for ever and the test above would still pass.
     */
    const stage = await prisma.stage.findFirst({ where: { eventId: dayId }, select: { id: true } });
    const late = await prisma.player.findFirst({
      where: { eventId: dayId, name: `${TAG} late` },
      select: { id: true },
    });
    await prisma.scorecard.create({
      data: { eventId: dayId, stageId: stage!.id, playerId: late!.id, strokes: JSON.stringify(PARS) },
    });

    const board = await liveBoard(dayId);
    expect(board!.rows.every((r) => r.thru >= 18), "everybody is in").toBe(true);
    expect(board!.allIn).toBe(true);
  });
});
