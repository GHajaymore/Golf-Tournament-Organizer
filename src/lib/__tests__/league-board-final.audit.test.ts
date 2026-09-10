import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A LEAGUE NIGHT'S PUBLIC BOARD SAID LIVE FOR THE REST OF THE SEASON.
 *
 * `allIn`'s card branch asks that every confirmed player has BEGUN, and the
 * comment beside it says exactly why: "a player with nothing at all has either
 * not begun or is not coming, and the board cannot tell which. Live is the
 * honest reading of a board that has no result for somebody."
 *
 * True when it was written. On a weekly league it is unsatisfiable: six
 * members who opted out of Tuesday never begin, so the chip never turns. The
 * committee's word cannot resolve it either — the escape hatch that paragraph
 * names is marking the tournament Completed, and a league is not completed
 * until the season ends, months later.
 *
 * What changed is what the app knows. A league records who is out, so the
 * board can now tell the two apart, and asks about the players who are IN.
 *
 * Every protection in the original rule is asserted here as well, because the
 * risk of this change is loosening one of them: a short card still counts, a
 * player who is IN and has nothing still holds the board Live, and a
 * tournament is judged exactly as before.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

// The board is `unstable_cache`d in production. Identity here, so each read
// reflects the rows as they stand rather than a minute ago.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { liveBoard } from "@/lib/services/live-board";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LEAGUEFINAL";
const FULL = new Array(18).fill(4);

let eventId = "";
let stageId = "";
const player: Record<string, string> = {};
const WHO = ["ann", "bea", "cal"] as const;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const setMode = (mode: string) =>
  prisma.event.update({ where: { id: eventId }, data: { attendanceMode: mode } });

const mark = (who: string, status: "in" | "out") =>
  prisma.roundAttendance.create({
    data: { eventId, stageId, playerId: player[who], status, decidedBy: "Club office" },
  });

const card = (who: string, strokes: (number | null)[] = FULL) =>
  prisma.scorecard.create({
    data: { eventId, stageId, playerId: player[who], strokes: JSON.stringify(strokes) },
  });

const board = async () => {
  const b = await liveBoard(eventId);
  if (!b) throw new Error("no board");
  return b;
};

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "community" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} winter league`,
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
      attendanceMode: "opt-out",
      customPars: JSON.stringify(FULL),
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
  stageId = stage.id;

  for (const [i, who] of WHO.entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}-${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: 10,
      },
    });
    player[who] = p.id;
  }
});

beforeEach(async () => {
  await prisma.scorecard.deleteMany({ where: { eventId } });
  await prisma.roundAttendance.deleteMany({ where: { eventId } });
  await prisma.event.update({ where: { id: eventId }, data: { status: "live" } });
  await setMode("opt-out");
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a league night where one member opted out", () => {
  it("goes FINAL once everybody who was in has finished", async () => {
    // THE FAULT. Cal is out; Ann and Bea have full cards. Before this, `allIn`
    // asked whether all three had begun and the chip never turned.
    await mark("cal", "out");
    await card("ann");
    await card("bea");
    expect((await board()).allIn).toBe(true);
  });

  it("marks the absentee's row rather than calling them not started", async () => {
    /**
     * The half that keeps the board from contradicting itself. A FINAL chip
     * over a row reading "not started" is the exact fault the rule above this
     * one was written for, measured on a charity day — so the row has to say
     * which of the two it is.
     *
     * The row is KEPT. "The leaderboard shows the whole field, not just who
     * has scored", and a member who missed a Tuesday is still in the league.
     */
    await mark("cal", "out");
    await card("ann");
    const rows = (await board()).rows;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === player.cal)?.absent).toBe(true);
    expect(rows.find((r) => r.id === player.ann)?.absent).toBe(false);
  });

  it("stays LIVE while somebody who IS in has nothing", async () => {
    // The protection that must not be loosened. Bea is in and has not teed
    // off; a board announcing a winner over her is the failure that matters.
    await mark("cal", "out");
    await card("ann");
    expect((await board()).allIn).toBe(false);
  });

  it("stays LIVE on a short card from somebody who is in", async () => {
    // The original fixture's case, unchanged: a card that stopped at the turn
    // is not a finished round.
    await mark("cal", "out");
    await card("ann");
    await card("bea", [...new Array(9).fill(4), ...new Array(9).fill(null)]);
    expect((await board()).allIn).toBe(false);
  });

  it("still lets the committee's word outrank all of it", async () => {
    await mark("cal", "out");
    await prisma.event.update({ where: { id: eventId }, data: { status: "completed" } });
    expect((await board()).allIn).toBe(true);
  });

  it("does not go FINAL on a week nobody is in for", async () => {
    // Under opt-in before anybody signs up, the expected field is empty — and
    // an empty field is not a finished round, it is a round with nothing in
    // it. The `length > 0` guard is what stops "Final" on an empty board.
    await setMode("opt-in");
    expect((await board()).allIn).toBe(false);
  });
});

describe("a tournament, which has no week to be out of", () => {
  it("is judged exactly as it was before", async () => {
    await setMode("everyone");
    await card("ann");
    await card("bea");
    // Cal has nothing and is not marked out — because there is nothing to be
    // marked out of. The board is Live, which is the old rule intact.
    expect((await board()).allIn).toBe(false);
    await card("cal");
    expect((await board()).allIn).toBe(true);
  });

  it("marks no row absent, so no reader has to know about the field", async () => {
    await setMode("everyone");
    await card("ann");
    for (const r of (await board()).rows) expect(r.absent).toBeUndefined();
  });
});
