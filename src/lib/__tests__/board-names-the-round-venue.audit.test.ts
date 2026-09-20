import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

// The board is `unstable_cache`d in production, and the cache cannot run
// outside Next. Identity here, the same as `completed-board.audit.test.ts`, so
// each read reflects the rows as they stand.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

import { liveBoard } from "@/lib/services/live-board";

/**
 * THE PUBLIC BOARD SAYS WHERE THE ROUND ON IT IS PLAYED.
 *
 * The line under the heading is `roundLabel · dates · venue`, so the venue
 * reads as a fact about the ROUND named beside it. It was the event's own
 * course every time. Read off the seeded club on 2026-09-20:
 *
 *   Evening nine at Ardmore · 2026-09-17 · Braid Hollow — Championship Course
 *
 * Ardmore in the round's name and Braid Hollow as the venue, on one line, on
 * the screen a club puts up in the clubhouse — and the one surface where a
 * stranger cannot ask anybody which it is.
 *
 * TWO TOURNAMENTS, not one with a round deleted between assertions: `liveBoard`
 * is wrapped in `unstable_cache` keyed by event, so mutating one event's rows
 * mid-file would test the cache rather than the rule. The second is also the
 * case that keeps the fix honest — a club with one venue must keep its venue
 * line rather than losing it to a rule about two.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-board-venue";

let twoVenues = "";
let oneVenue = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A tournament whose own venue is Braid Hollow, in Glasgow. */
async function makeEvent(orgId: string, name: string) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "2026-09-17",
      course: `${TAG} Braid Hollow`,
      city: `${TAG} Glasgow`,
      address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
}

async function round(eventId: string, position: number, description: string, holes: number, courseId?: string) {
  return prisma.stage.create({
    data: {
      eventId,
      position,
      description,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes,
      scoringBasis: "gross",
      ...(courseId ? { courseId } : {}),
    },
    select: { id: true },
  });
}

async function card(eventId: string, stageId: string, playerId: string, holes: number) {
  await prisma.scorecard.create({
    data: { eventId, stageId, playerId, strokes: JSON.stringify(new Array(holes).fill(4)) },
  });
}

async function entrant(eventId: string, name: string) {
  return prisma.player.create({
    data: {
      eventId,
      name: `${TAG} ${name}`,
      email: `${TAG}-${name}@example.invalid`,
      handicap: 10,
      seed: 1,
      status: "confirmed",
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const away = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} Ardmore Wee Nine`,
      city: `${TAG} Kirkintilloch`,
      pars: JSON.stringify(new Array(9).fill(4)),
      yards: JSON.stringify(new Array(9).fill(300)),
      strokeIndex: JSON.stringify(Array.from({ length: 9 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });

  {
    const event = await makeEvent(org.id, "two venues");
    twoVenues = event.id;
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: away.id } });
    const home = await round(event.id, 0, "Morning medal", 18);
    const evening = await round(event.id, 1, "Evening nine at Ardmore", 9, away.id);
    const player = await entrant(event.id, "two-venues");
    // A card on each, the away one last: the board follows the newest results.
    await card(event.id, home.id, player.id, 18);
    await card(event.id, evening.id, player.id, 9);
  }

  {
    const event = await makeEvent(org.id, "one venue");
    oneVenue = event.id;
    const only = await round(event.id, 0, "Morning medal", 18);
    const player = await entrant(event.id, "one-venue");
    await card(event.id, only.id, player.id, 18);
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the venue on the public board", () => {
  it("names the course the round on the board is played at", async () => {
    const board = await liveBoard(twoVenues);
    expect(board, "no board at all").toBeTruthy();
    expect(board!.roundLabel, "the board is not on the away round").toContain("Ardmore");
    expect(board!.venue, "the away round printed the club's own course").not.toContain("Braid Hollow");
    expect(board!.venue).toContain("Ardmore Wee Nine");
  });

  it("prints the away course's OWN town, not the tournament's", async () => {
    // Half a fix reads worse than none: "Ardmore Wee Nine, Glasgow" puts a real
    // course in the wrong town, on a public screen.
    const board = await liveBoard(twoVenues);
    expect(board!.venue).toContain("Kirkintilloch");
    expect(board!.venue).not.toContain("Glasgow");
  });

  it("still prints the tournament's venue when the round names no course", async () => {
    // Most of golf, and the half a narrow fix would break.
    const board = await liveBoard(oneVenue);
    expect(board!.roundLabel).toContain("Morning medal");
    expect(board!.venue).toContain("Braid Hollow");
    expect(board!.venue).toContain("Glasgow");
  });
});
