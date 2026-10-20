import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * CLEARING CHOSEN PLAYERS' SCORES CLEARS THEIRS, AND ONLY THEIRS (2026-10-21).
 *
 * `clearRoundScores(stageId, playerIds)` asked the match cards for a
 * `playerId` column they do not have — a match card is keyed by match and
 * slot. So ticking a name and pressing Clear THREW, after it had already
 * deleted that player's cards and emptied their matches: no audit line, and
 * "Something went wrong" on the screen over a clear that had half happened.
 * Found by `e2e/match-results.spec.ts`, the first test to tick a name.
 *
 * Real rows: a round with two matches, each with both players' stroke cards,
 * and a medal card per player. Clearing ONE player empties their match and its
 * two cards, deletes their medal card, and leaves the other match, its cards
 * and everybody else's medal card exactly as they were.
 */

const prisma = new PrismaClient();
const TAG = "zz-clear-chosen";

const session = { email: `${TAG}@example.invalid`, name: `${TAG} secretary`, eventId: "", role: "admin", viewRole: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { clearRoundScores } = await import("@/app/actions/tournament");

const id: Record<string, string> = {};
const FULL = JSON.stringify(new Array(18).fill(4));

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
      name: `${TAG} matchplay`,
      status: "live",
      configUnlocked: true,
      shape: "single",
      format: "match",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  session.eventId = event.id;
  id.event = event.id;
  await prisma.account.create({ data: { eventId: event.id, email: session.email, name: session.name, role: "admin" } });
  id.stage = (
    await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Round Robin", format: "Match Play", holes: 18, scoringBasis: "gross" } })
  ).id;
  const flight = await prisma.group.create({ data: { eventId: event.id, name: `${TAG} A`, position: 0 } });
  for (const [i, who] of ["One", "Two", "Three", "Four"].entries()) {
    id[who] = (
      await prisma.player.create({
        data: { eventId: event.id, groupId: flight.id, name: `${TAG} ${who}`, email: `${TAG}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0 },
      })
    ).id;
  }
  const match = async (a: string, b: string) => {
    const m = await prisma.match.create({
      data: {
        eventId: event.id, stageId: id.stage, groupId: flight.id, round: 1,
        playerAId: id[a], playerBId: id[b], teamAId: "", teamBId: "",
        holes: JSON.stringify(new Array(18).fill("H")), scoreStatus: "pending",
      },
    });
    for (const slot of ["A", "B"]) await prisma.matchScorecard.create({ data: { eventId: event.id, matchId: m.id, slot, strokes: FULL } });
    return m.id;
  };
  id.oneTwo = await match("One", "Two");
  id.threeFour = await match("Three", "Four");
  for (const who of ["One", "Two", "Three", "Four"]) {
    await prisma.scorecard.create({ data: { eventId: event.id, stageId: id.stage, playerId: id[who], strokes: FULL, status: "entered" } });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const played = async (matchId: string) =>
  (JSON.parse((await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).holes) as unknown[]).filter((h) => h !== null).length;

describe("clearing one chosen player", () => {
  it("does not throw, and says what it cleared", async () => {
    const res = await clearRoundScores(id.stage, [id.One]);
    expect(res.ok).toBe(true);
    // Their medal card and their match.
    expect(res.cleared).toBe(2);
  });

  it("clears their match, both of its cards, and their own card", async () => {
    expect(await played(id.oneTwo)).toBe(0);
    expect(await prisma.matchScorecard.count({ where: { matchId: id.oneTwo } })).toBe(0);
    expect(await prisma.scorecard.count({ where: { stageId: id.stage, playerId: id.One } })).toBe(0);
  });

  it("leaves everybody else's exactly as they were", async () => {
    expect(await played(id.threeFour)).toBe(18);
    expect(await prisma.matchScorecard.count({ where: { matchId: id.threeFour } })).toBe(2);
    for (const who of ["Two", "Three", "Four"]) {
      expect(await prisma.scorecard.count({ where: { stageId: id.stage, playerId: id[who] } }), who).toBe(1);
    }
  });

  it("writes the audit line the clear owes", async () => {
    const line = await prisma.auditLog.findFirst({ where: { eventId: id.event, action: "clear-round-scores" } });
    expect(line?.detail ?? "").toMatch(/for 1 player/);
  });
});
