import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

// The board is `unstable_cache`d in production and the cache cannot run outside
// Next. Identity here, the same as `board-names-the-round-venue.audit.test.ts`.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { liveBoard } from "@/lib/services/live-board";

/**
 * THE BOARD SCORES THE ROUND AGAINST THE COURSE IT WAS PLAYED ON.
 *
 * `board-names-the-round-venue` is this file's other half: the public board
 * printed the event's course in the line under the heading while the round on
 * it was played somewhere else. That was the board saying the wrong WORD. This
 * is the board printing the wrong NUMBER for the same reason.
 *
 * Read off the seeded club on 2026-09-20. Its Four-Ball & Foursomes
 * Invitational finishes with "Evening nine at Ardmore" — nine holes, its own
 * `courseId`, par 32. The board scored those nine against Braid Hollow's front
 * nine, par 36, so every side read FOUR BETTER than it was:
 *
 *   /live and /reports   -5  -4  -3  -2  -1
 *   the player's board   -1   E  +1  +2  +3
 *
 * Same eight sides, same order, on the two screens a club sends to its members
 * and puts on a screen in the clubhouse. CLAUDE.md has a whole section on why
 * that is the dangerous direction: a constant offset cannot reorder anything,
 * so the ranking stays perfect and nobody has anything to report.
 *
 * ASSERTED AGAINST THE RULES RATHER THAN AGAINST ANOTHER SCREEN. Both readers
 * agreed on the wrong number for months, which read as confirmation. So the
 * fixture makes par the whole point: nine par-3 holes away from home, played
 * in fours. That is +9, and it is 0 against the eighteen par-4s on the
 * tournament — one number cannot be reached by both cards, which is what stops
 * this passing by accident.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-board-scores-venue";

/** Nine par 3s. A side round in fours is +9 here and level at home. */
const AWAY_PARS = new Array(9).fill(3);
/** Eighteen par 4s, so the front nine the old reader used is par 36. */
const HOME_PARS = new Array(18).fill(4);

let away = "";
let home = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeEvent(organizationId: string, name: string) {
  return prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "2026-09-17",
      course: `${TAG} Braid Hollow`,
      city: `${TAG} Glasgow`,
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
      customPars: JSON.stringify(HOME_PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
}

/**
 * A nine-hole foursomes, optionally at another club.
 *
 * Foursomes because one ball between two is the shape that files a single
 * `TeamScorecard` with a blank `playerId`, and gross because a net total
 * cannot see this defect at all: a side receives the same NUMBER of strokes
 * whichever card is read, so net is gross minus a constant and is blind by
 * construction. CLAUDE.md says so in the sweep section; this fixture is the
 * reason it does.
 */
async function nineHoleFoursomes(eventId: string, courseId?: string) {
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Evening nine",
      type: "Stroke Play Round",
      format: "Foursomes",
      scoringBasis: "gross",
      holes: 9,
      ...(courseId ? { courseId } : {}),
    },
    select: { id: true },
  });

  const players = [];
  for (const who of ["one", "two"]) {
    players.push(
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${who}`,
          email: `${TAG}-${who}-${randomBytes(3).toString("hex")}@example.invalid`,
          // Scratch, so nothing here turns on an allowance.
          handicap: 0,
          seed: players.length + 1,
          status: "confirmed",
        },
        select: { id: true },
      }),
    );
  }

  const team = await prisma.team.create({
    data: { eventId, stageId: stage.id, name: `${TAG} pair`, seed: 1 },
    select: { id: true },
  });
  for (let i = 0; i < players.length; i += 1) {
    await prisma.teamMember.create({ data: { teamId: team.id, playerId: players[i].id, position: i } });
  }
  await prisma.teamScorecard.create({
    data: {
      eventId,
      stageId: stage.id,
      teamId: team.id,
      playerId: "",
      strokes: JSON.stringify(new Array(9).fill(4)),
    },
  });
  return stage.id;
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const wee = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} Ardmore Wee Nine`,
      city: `${TAG} Kirkintilloch`,
      pars: JSON.stringify(AWAY_PARS),
      yards: JSON.stringify(new Array(9).fill(150)),
      strokeIndex: JSON.stringify(Array.from({ length: 9 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });

  {
    const event = await makeEvent(org.id, "away round");
    away = event.id;
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: wee.id } });
    await nineHoleFoursomes(event.id, wee.id);
  }

  {
    // The half a narrow fix breaks: most of golf, played at home.
    const event = await makeEvent(org.id, "home round");
    home = event.id;
    await nineHoleFoursomes(event.id);
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a team round played away from the tournament's own course", () => {
  it("is scored against the par of the course it was played on", async () => {
    const board = await liveBoard(away);
    expect(board, "no board at all").toBeTruthy();
    expect(board!.teamRows, "the side never reached the team board").toHaveLength(1);
    // Nine 4s over nine par 3s. Nothing else this fixture could mean.
    expect(board!.teamRows[0].gross).toBe(36);
    expect(board!.teamRows[0].toPar, "scored against the tournament's own card").toBe(9);
  });

  it("does not read level, which is what the tournament's own front nine gives", async () => {
    // The old number, stated so that a future change cannot drift back into it
    // while the assertion above is edited to match.
    const board = await liveBoard(away);
    expect(board!.teamRows[0].toPar).not.toBe(0);
  });

  it("still scores a round at the club's own course against the club's card", async () => {
    const board = await liveBoard(home);
    expect(board!.teamRows).toHaveLength(1);
    expect(board!.teamRows[0].gross).toBe(36);
    // Nine 4s over the first nine of eighteen par 4s.
    expect(board!.teamRows[0].toPar).toBe(0);
  });
});
