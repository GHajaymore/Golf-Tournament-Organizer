import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readSource } from "./source";

const { loadEventState } = await import("@/lib/services/tournament");

/**
 * A FINISHED CARD IS NOT SOMEBODY ON THE COURSE.
 *
 * Found 2026-09-26: a newcomer typed in all eight of a Stableford's cards, the
 * leaderboard ranked all eight on eighteen holes, and the dashboard said
 * "0/8 scorecards certified · 8 still out on the course". The cards were
 * finished and waiting for a signature. `boardProgress.unreturned` counts
 * those, and the dashboard says them separately.
 *
 * One card of each kind, so the counts can only come out right one way:
 * finished and unsigned, part-played, and certified.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-UNRETURNED";
let eventId = "";

const full = JSON.stringify(new Array(18).fill(4));
const nine = JSON.stringify([...new Array(9).fill(4), ...new Array(9).fill(null)]);

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      dates: "2026-10-24",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      format: "stroke",
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  const cards: Array<[string, string]> = [
    [full, "entered"], // finished, nobody has signed it
    [nine, "entered"], // still out there, at the turn
    [full, "certified"], // returned
  ];
  for (const [i, [strokes, status]] of cards.entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} player ${i + 1}`,
        email: `${TAG}-p${i + 1}@example.invalid`.toLowerCase(),
        handicap: 10,
        handicapType: "18",
        status: "confirmed",
        seed: i + 1,
      },
    });
    await prisma.scorecard.create({ data: { eventId, stageId: stage.id, playerId: p.id, strokes, status } });
  }
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the round's progress", () => {
  it("counts the finished, unsigned card apart from the one still out", async () => {
    const bp = (await loadEventState(eventId))!.boardProgress;
    expect(bp.started, "cards with anything on them").toBe(3);
    expect(bp.certified).toBe(1);
    expect(bp.unreturned, "finished and unsigned").toBe(1);
    // What the dashboard prints as "still out on the course".
    expect(bp.started - bp.certified - bp.disputed - (bp.unreturned ?? 0), "still out on the course").toBe(1);
  });
});

describe("the dashboard", () => {
  it("subtracts the finished cards from 'still out on the course' and names them", () => {
    const src = readSource("src/app/(app)/dashboard/page.tsx");
    expect(src).toMatch(
      /state\.boardProgress\.started - state\.boardProgress\.certified - state\.boardProgress\.disputed - \(state\.boardProgress\.unreturned \?\? 0\) > 0/,
    );
    expect(src).toMatch(/finished, not yet certified/);
  });
});
