import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateCutRound } from "../services/regroup";
import { loadEventState } from "../services/tournament";

/**
 * Who a cut advances, and whether it may be taken at all.
 *
 * Two faults that both come from the same place: the field a round is judged
 * on is every CONFIRMED player, while the results it is judged by belong to
 * one round. A player who is in the event but not in the round therefore
 * appears on zero — and zero is not last. It sorts above everyone who played
 * and lost, whose hole differential is negative.
 *
 * Needs a live DATABASE_URL, so it lives in the audit suite:
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CUT-QUALIFIERS";

let orgId = "";

/** Every hole to player A — an 18-0 win, differential +18 / -18. */
const A_WINS = JSON.stringify(new Array(18).fill("A"));
/** A scheduled but unplayed match: eighteen holes, no result on any of them. */
const NOT_PLAYED = JSON.stringify(new Array(18).fill(null));

async function seedEvent(): Promise<{ eventId: string }> {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${Date.now()}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "draft",
      shape: "series",
      formationRule: "balanced",
      shareToken: `audit-cutq-${Date.now()}-${Math.random()}`,
    },
  });
  return { eventId: event.id };
}

async function addFlight(eventId: string, name: string, position: number) {
  const g = await prisma.group.create({ data: { eventId, name, position } });
  return g.id;
}

async function addPlayer(
  eventId: string,
  groupId: string,
  label: string,
  handicap: number,
  seed: number,
) {
  const p = await prisma.player.create({
    data: {
      eventId,
      name: `${TAG} ${label}`,
      email: `${TAG.toLowerCase()}-${label}-${Date.now()}-${Math.random()}@example.invalid`,
      handicap,
      seed,
      status: "confirmed",
      groupId,
    },
  });
  return p.id;
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

/**
 * A player who is out of the tournament must not be seeded into the bracket.
 *
 * The stroke path has guarded this for a while — `strokeStandings.filter(s =>
 * s.ranked)`, with a comment saying a player holding no position cannot take a
 * qualifying place off somebody who does. The match path had no equivalent, so
 * the same event scored as match play seeded the eliminated player and left out
 * the survivor. The lit "advancing" rows on the dashboard and the public
 * leaderboard read off the same set, so the board agreed with the wrong answer
 * all the way to the first tee.
 */
describe("knockout qualifiers come from the players who contested the round", () => {
  it("does not seed a player who sat the round out above one who played and lost", async () => {
    const { eventId } = await seedEvent();
    const r1 = await prisma.stage.create({
      data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 },
    });
    const r2 = await prisma.stage.create({
      data: { eventId, position: 1, type: "Round Robin", format: "Match Play", holes: 18 },
    });
    await prisma.stage.create({
      data: { eventId, position: 2, type: "Bracket Stage", format: "Match Play", holes: 18 },
    });
    // Two advance per flight, which is the app's default.
    await prisma.event.update({
      where: { id: eventId },
      data: { qualifyMode: "perFlight", qualifyPerGroup: 2 },
    });

    const flight = await addFlight(eventId, "A", 0);
    // Handicaps ascending with the seed, so seed order and handicap order agree
    // and a fallback to either would pick out and out.
    const out1 = await addPlayer(eventId, flight, "OUT1", 2, 1);
    const out2 = await addPlayer(eventId, flight, "OUT2", 5, 2);
    const winner = await addPlayer(eventId, flight, "WINNER", 8, 3);
    const loser = await addPlayer(eventId, flight, "LOSER", 11, 4);

    // Round 1: everyone played. Round 2 is the ACTIVE round, and only the two
    // survivors are in it — out1 and out2 were cut and hold no round-2 match,
    // exactly the state a per-flight cut leaves them in. They are still
    // confirmed and still attached to the flight, which is the whole problem.
    await prisma.match.create({
      data: { eventId, stageId: r1.id, groupId: flight, round: 1, playerAId: out1, playerBId: out2, holes: A_WINS },
    });
    await prisma.match.create({
      data: { eventId, stageId: r1.id, groupId: flight, round: 2, playerAId: winner, playerBId: loser, holes: A_WINS },
    });
    await prisma.match.create({
      data: { eventId, stageId: r2.id, groupId: flight, round: 1, playerAId: winner, playerBId: loser, holes: A_WINS },
    });

    const state = await loadEventState(eventId);
    expect(state).not.toBeNull();

    const qualifierIds = new Set(state!.qualifiers.map((p) => p.id));

    // The two who actually contested round two are the two who advance —
    // including the one who LOST it, because a played loss outranks not
    // playing at all.
    expect(qualifierIds.has(winner)).toBe(true);
    expect(qualifierIds.has(loser)).toBe(true);
    // And neither eliminated player is seeded, though both sit on a hole
    // differential of 0 against the loser's -18.
    expect(qualifierIds.has(out1)).toBe(false);
    expect(qualifierIds.has(out2)).toBe(false);

    // The board lights the same set it seeds from; a disagreement here is how
    // an organizer is shown one bracket and handed another.
    expect(state!.advancingIds.has(loser)).toBe(true);
    expect(state!.advancingIds.has(out1)).toBe(false);
  });

  it("still seeds a pure knockout, where nobody has played anything", async () => {
    /**
     * The guard against the guard, and the reason the filter is conditional.
     *
     * An event that is nothing but a bracket has no qualifying round at all, so
     * every player has played zero and `overall` is still its zero-point
     * initialiser. Filtering unconditionally would return an EMPTY set and draw
     * a bracket with nobody in it — a working tournament broken by a fix for a
     * different one. With nothing contested, seed order is all there is, and
     * that is what this has always used.
     */
    const { eventId } = await seedEvent();
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 },
    });
    await prisma.event.update({
      where: { id: eventId },
      data: { qualifyMode: "perFlight", qualifyPerGroup: 2 },
    });

    const flight = await addFlight(eventId, "A", 0);
    const top = await addPlayer(eventId, flight, "SEED1", 3, 1);
    const second = await addPlayer(eventId, flight, "SEED2", 6, 2);
    await addPlayer(eventId, flight, "SEED3", 9, 3);
    await addPlayer(eventId, flight, "SEED4", 12, 4);

    const state = await loadEventState(eventId);
    expect(state).not.toBeNull();

    const qualifierIds = new Set(state!.qualifiers.map((p) => p.id));
    expect(qualifierIds.size).toBe(2);
    expect(qualifierIds.has(top)).toBe(true);
    expect(qualifierIds.has(second)).toBe(true);
  });
});

/**
 * A cut needs something to cut on.
 *
 * Pressing Generate before the qualifying round has been played ranked the
 * whole field on zero, so the sort fell through to the last thing separating
 * them — seed, which is handicap order. "Top N advance" advanced the N lowest
 * handicaps, and with the default overall scope it dissolved the existing
 * flights to do it. The button's own hint said "run it once this round is
 * complete", which is a rule the organizer had to remember.
 */
describe("generateCutRound refuses a round with nothing to cut on", () => {
  async function seedTwoRounds(r1Holes: string) {
    const { eventId } = await seedEvent();
    const r1 = await prisma.stage.create({
      data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 },
    });
    const r2 = await prisma.stage.create({
      data: {
        eventId,
        position: 1,
        type: "Round Robin",
        format: "Match Play",
        holes: 18,
        cutEnabled: true,
        cutScope: "overall",
        cutMode: "count",
        cutCount: 2,
      },
    });
    const fa = await addFlight(eventId, "A", 0);
    const fb = await addFlight(eventId, "B", 1);
    const a1 = await addPlayer(eventId, fa, "A1", 2, 1);
    const a2 = await addPlayer(eventId, fa, "A2", 14, 2);
    const b1 = await addPlayer(eventId, fb, "B1", 5, 3);
    const b2 = await addPlayer(eventId, fb, "B2", 20, 4);
    await prisma.match.create({
      data: { eventId, stageId: r1.id, groupId: fa, round: 1, playerAId: a1, playerBId: a2, holes: r1Holes },
    });
    await prisma.match.create({
      data: { eventId, stageId: r1.id, groupId: fb, round: 1, playerAId: b1, playerBId: b2, holes: r1Holes },
    });
    return { eventId, r1: r1.id, r2: r2.id, flights: [fa, fb], lowHandicaps: [a1, b1] };
  }

  it("refuses, and names the round, when not a hole has been entered", async () => {
    const { eventId, r2 } = await seedTwoRounds(NOT_PLAYED);

    const result = await generateCutRound(eventId, r2);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("no-results");
  });

  it("changes nothing at all when it refuses", async () => {
    /**
     * The refusal has to come BEFORE the reform, not after it. An overall cut
     * detaches every player from their flight and rebuilds the field; a guard
     * that ran late would return an error having already destroyed round one's
     * flights, which is the more expensive half of the bug.
     */
    const { eventId, r2, flights } = await seedTwoRounds(NOT_PLAYED);
    const before = await prisma.player.findMany({
      where: { eventId },
      select: { id: true, groupId: true },
      orderBy: { seed: "asc" },
    });

    await generateCutRound(eventId, r2);

    const after = await prisma.player.findMany({
      where: { eventId },
      select: { id: true, groupId: true },
      orderBy: { seed: "asc" },
    });
    expect(after).toEqual(before);
    // Every player still in a real flight, and no round-2 matches invented.
    for (const p of after) expect(flights).toContain(p.groupId);
    expect(await prisma.match.count({ where: { eventId, stageId: r2 } })).toBe(0);
  });

  it("proceeds the moment the round holds a single result", async () => {
    /**
     * Deliberately narrow. A cut taken with a match still out is a real thing
     * clubs do, so one entered result is enough to make it the organizer's
     * call again. A guard that demanded a COMPLETE round would refuse a
     * legitimate cut, which is the worse failure of the two.
     */
    const { eventId, r1, r2 } = await seedTwoRounds(NOT_PLAYED);
    const one = await prisma.match.findFirst({ where: { eventId, stageId: r1 } });
    await prisma.match.update({ where: { id: one!.id }, data: { holes: A_WINS } });

    const result = await generateCutRound(eventId, r2);

    expect(result.ok).toBe(true);
  });

  it("counts a conceded match as a result, though it leaves no card", async () => {
    /**
     * A flight settled by concessions has no strokes and no holes — Rule
     * 3.2b(1) ends the match without a card. Reading only for entered scores
     * would call that round empty and refuse a cut that is perfectly proper,
     * so `forfeitedBy` is counted alongside them.
     */
    const { eventId, r1, r2 } = await seedTwoRounds(NOT_PLAYED);
    const matches = await prisma.match.findMany({ where: { eventId, stageId: r1 } });
    for (const m of matches) {
      await prisma.match.update({ where: { id: m.id }, data: { forfeitedBy: "B" } });
    }

    const result = await generateCutRound(eventId, r2);

    expect(result.ok).toBe(true);
  });
});
