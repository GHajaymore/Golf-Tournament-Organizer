import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE STATE MACHINE'S ONE READER, AGAINST REAL ROWS (proposal 3 Nov, PR 1).
 *
 * `tournamentFactsFor` answers "has this round been played" ONCE — `hasResult`
 * — and section 2b says it is the widest of today's three spellings,
 * `roundsWithResults`. A value, not a spelling, so it is asserted on rows: a
 * draft stroke round with one card, a draft knockout whose only result is a
 * `BracketWinner` (D2 — the row `resultsIn` cannot see), and a live round robin
 * with one forfeit and one round nobody has touched.
 *
 * Throwaway club and events marked `zz-state-facts`, invented names,
 * `@example.invalid`, removed before and after. Development database only.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/tournament-facts.audit.test.ts
 */

vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { tournamentFactsFor } = await import("@/lib/services/tournament-facts");
const { loadEventState } = await import("@/lib/services/tournament");
const { tournamentStatus } = await import("@/lib/domain/tournament-status");

const prisma = new PrismaClient();
const TAG = "zz-state-facts";
const ids = { stroke: "", knockout: "", rr: "" };
const TODAY = "2026-11-03";

async function clean() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function eventWith(orgId: string, name: string, status: string) {
  const ev = await prisma.event.create({
    data: { name: `${TAG} ${name}`, organizationId: orgId, status, dates: "14 Nov 2026", startOn: "2026-11-14", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${name}` },
    select: { id: true },
  });
  return ev.id;
}

async function players(eventId: string, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = await prisma.player.create({
      data: { eventId, name: `Invented Player ${i + 1}`, email: `${TAG}-${eventId.slice(-6)}-${i + 1}@example.invalid`, seed: i + 1, status: "confirmed", handicap: 10 },
      select: { id: true },
    });
    out.push(p.id);
  }
  return out;
}

beforeAll(async () => {
  await clean();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });

  // A medal in draft with one card in.
  ids.stroke = await eventWith(org.id, "medal", "draft");
  const medal = await prisma.stage.create({ data: { eventId: ids.stroke, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 }, select: { id: true } });
  const [m1] = await players(ids.stroke, 3);
  await prisma.scorecard.create({ data: { eventId: ids.stroke, stageId: medal.id, playerId: m1, strokes: JSON.stringify([4, 5, 3]) } });

  // A knockout in draft whose only result is a slot in the draw (D2).
  ids.knockout = await eventWith(org.id, "knockout", "draft");
  await prisma.stage.create({ data: { eventId: ids.knockout, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  const [k1] = await players(ids.knockout, 4);
  await prisma.bracketWinner.create({ data: { eventId: ids.knockout, key: "winners-0-0", winnerId: k1, result: "3&2" } });

  // A live round robin: round 1 has a forfeit, round 2 a match nobody has touched.
  ids.rr = await eventWith(org.id, "round-robin", "live");
  const r1 = await prisma.stage.create({ data: { eventId: ids.rr, position: 0, type: "Round Robin", format: "Match Play", holes: 18 }, select: { id: true } });
  const r2 = await prisma.stage.create({ data: { eventId: ids.rr, position: 1, type: "Round Robin", format: "Match Play", holes: 18 }, select: { id: true } });
  const [a, b] = await players(ids.rr, 2);
  const flight = await prisma.group.create({ data: { eventId: ids.rr, name: "Flight 1", position: 0 }, select: { id: true } });
  await prisma.player.updateMany({ where: { id: { in: [a, b] } }, data: { groupId: flight.id } });
  await prisma.match.create({ data: { eventId: ids.rr, stageId: r1.id, groupId: flight.id, round: 1, playerAId: a, playerBId: b, holes: "[]", forfeitedBy: b } });
  await prisma.match.create({ data: { eventId: ids.rr, stageId: r2.id, groupId: flight.id, round: 2, playerAId: a, playerBId: b, holes: "[]" } });
}, 120_000);

afterAll(async () => {
  try {
    await clean();
  } finally {
    await prisma.$disconnect();
  }
});

describe("tournamentFactsFor, on real rows", () => {
  it("THE CONTROL: the fixtures are what they say — one card, one slot, one forfeit, nothing else", async () => {
    expect(await prisma.scorecard.count({ where: { eventId: ids.stroke } })).toBe(1);
    expect(await prisma.scorecard.count({ where: { eventId: ids.knockout } })).toBe(0);
    expect(await prisma.match.count({ where: { eventId: ids.knockout } })).toBe(0);
    expect(await prisma.bracketWinner.count({ where: { eventId: ids.knockout } })).toBe(1);
  });

  for (const which of ["stroke", "knockout", "rr"] as const) {
    it(`${which}: hasResult is exactly roundsWithResults`, async () => {
      const facts = await tournamentFactsFor(ids[which], TODAY);
      const state = await loadEventState(ids[which]);
      expect(facts).not.toBeNull();
      const mine = new Set(facts!.rounds.filter((r) => r.hasResult).map((r) => r.id));
      expect([...mine].sort()).toEqual([...state!.roundsWithResults].sort());
      expect(mine.size, "a fixture with no result proves nothing").toBeGreaterThan(0);
      expect(facts!.today).toBe(TODAY);
      expect(facts!.confirmed).toBe(state!.confirmed.length);
    });
  }

  it("D2 on real rows: resultsIn reads the knockout as unplayed; the machine reads it under way", async () => {
    const state = await loadEventState(ids.knockout);
    expect(state!.resultsIn, "today's count of results misses the BracketWinner").toBe(0);
    const st = tournamentStatus((await tournamentFactsFor(ids.knockout, TODAY))!);
    expect(st.family).toBe("knockout");
    expect(st.underWayUnlaunched).toBe(true);
    expect(st.journey).toBe("play");
    expect(st.refusals.play).toBeNull();
  });

  it("the round robin: round 1 played by forfeit, round 2 not started, and the review queue read while live", async () => {
    const facts = (await tournamentFactsFor(ids.rr, TODAY))!;
    expect(facts.rounds.map((r) => [r.label, r.hasResult, r.matches, r.matchesOver])).toEqual([
      ["Round 1", true, 1, 1],
      ["Round 2", false, 1, 0],
    ]);
    const state = await loadEventState(ids.rr);
    expect(facts.review).toEqual({ pendingConfirmations: state!.pendingConfirmations, disputed: state!.reviewing.disputed });
    const st = tournamentStatus(facts);
    expect(st.step).toBe("live");
    expect(st.rounds.map((r) => r.state)).toEqual(["under-way", "not-started"]);
  });

  it("an event that does not exist reads as null", async () => {
    expect(await tournamentFactsFor("zz-state-facts-no-such-event", TODAY)).toBeNull();
  });
});
