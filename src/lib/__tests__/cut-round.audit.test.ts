import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { generateCutRound } from "../services/regroup";
import { loadEventState } from "../services/tournament";

/**
 * Cutting into the next round, against the real database.
 *
 * The bug this pins: an overall cut takes the best players across every flight,
 * so the survivors land unevenly — four out of one flight, one out of another.
 * generateCutRound used to draw a round robin inside the OLD flights, so a
 * flight left with a single survivor got no matches at all, and that player was
 * in the round with nobody to play and nothing saying so.
 *
 * Its own throwaway ORGANIZATION so no club's settings can bleed in, torn down
 * in afterAll. Needs a live DATABASE_URL, so it lives in the audit suite:
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CUT-ROUND";

let orgId = "";

async function seedEvent(
  round2: { type: string; format: string } = { type: "Round Robin", format: "Match Play" },
): Promise<{
  eventId: string;
  r1: string;
  r2: string;
  flights: string[];
  players: { id: string; group: number; seed: number }[];
}> {
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
      shareToken: `audit-cut-${Date.now()}-${Math.random()}`,
    },
  });
  const eventId = event.id;

  // Two Round Robin rounds: round 1 played, round 2 cut-gated.
  const r1 = await prisma.stage.create({
    data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 },
  });
  const r2 = await prisma.stage.create({
    data: { eventId, position: 1, type: round2.type, format: round2.format, holes: 18 },
  });

  // Three flights of four = twelve players.
  const flights: string[] = [];
  for (let f = 0; f < 3; f += 1) {
    const g = await prisma.group.create({
      data: { eventId, name: String.fromCharCode(65 + f), position: f },
    });
    flights.push(g.id);
  }

  const players: { id: string; group: number; seed: number }[] = [];
  let seed = 1;
  for (let f = 0; f < 3; f += 1) {
    for (let k = 0; k < 4; k += 1) {
      const p = await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${String.fromCharCode(65 + f)}${k + 1}`,
          email: `${TAG.toLowerCase()}-${seed}-${Date.now()}@example.invalid`,
          handicap: 4 + k * 3 + f,
          seed,
          status: "confirmed",
          groupId: flights[f],
        },
      });
      players.push({ id: p.id, group: f, seed });
      seed += 1;
    }
  }

  // Round 1: a full round robin inside each flight, every match won 18-0 by the
  // better seed. Every flight's point distribution is then identical (36/24/12/0),
  // and the cross-flight ties break by the lower handicap set above — so the
  // overall order is A1, B1, C1, A2, B2, C2, … A top-4 overall cut therefore
  // lands {A:2, B:1, C:1}: lone survivors in B and C, the shape that strands.
  const holes = JSON.stringify(new Array(18).fill("A")); // playerA wins every hole
  for (let f = 0; f < 3; f += 1) {
    const ids = players.filter((p) => p.group === f).map((p) => p.id);
    let round = 1;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        await prisma.match.create({
          data: {
            eventId,
            stageId: r1.id,
            groupId: flights[f],
            round: round++,
            playerAId: ids[i], // better seed
            playerBId: ids[j],
            holes,
          },
        });
      }
    }
  }

  return { eventId, r1: r1.id, r2: r2.id, flights, players };
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({
    data: { name: `${TAG} org`, kind: "club" },
  });
  orgId = org.id;
});

afterAll(async () => {
  // Cascades to every event, stage, group, player and match we created.
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("generateCutRound with an overall cut", () => {
  it("reforms the survivors so nobody is left in a flight of one", async () => {
    const { eventId, r2, players } = await seedEvent();
    // Top 4 overall lands {A:2, B:1, C:1}: B and C each send a single survivor,
    // and under the old code that lone survivor got a round robin of one — no
    // matches, silently.
    await prisma.stage.update({
      where: { id: r2 },
      data: { cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 4 },
    });

    await generateCutRound(eventId, r2);

    const r2Matches = await prisma.match.findMany({ where: { eventId, stageId: r2 } });
    const survivors = await prisma.player.findMany({
      where: { eventId, groupId: { not: null } },
      select: { id: true, groupId: true },
    });

    // Four survivors, reformed into flights that each hold at least two — so
    // every survivor has an opponent, and there are matches to prove it.
    expect(survivors).toHaveLength(4);
    const sizeByGroup = new Map<string, number>();
    for (const s of survivors) sizeByGroup.set(s.groupId!, (sizeByGroup.get(s.groupId!) ?? 0) + 1);
    for (const size of sizeByGroup.values()) expect(size).toBeGreaterThanOrEqual(2);

    // Every survivor appears in at least one round-2 match.
    const played = new Set<string>();
    for (const m of r2Matches) {
      played.add(m.playerAId);
      played.add(m.playerBId);
    }
    for (const s of survivors) expect(played.has(s.id), `${s.id} has a match`).toBe(true);

    // Both sides of every round-2 match are in the flight it is recorded under
    // — the same invariant a plain flight draw keeps.
    const groupOf = new Map(survivors.map((s) => [s.id, s.groupId]));
    for (const m of r2Matches) {
      expect(groupOf.get(m.playerAId)).toBe(m.groupId);
      expect(groupOf.get(m.playerBId)).toBe(m.groupId);
    }

    // The players the cut removed are detached, so no reused flight row carries
    // a non-survivor into round two.
    const cut = players.length - survivors.length;
    expect(cut).toBe(8);
  });

  it("leaves a per-flight cut's flights exactly as they were", async () => {
    const { eventId, r2, flights, players } = await seedEvent();
    const groupBefore = new Map(
      players.map((p) => [p.id, flights[p.group]] as const),
    );
    // Top 2 per flight: each flight keeps its two best, in the same flight, and
    // nobody is re-flighted — an overall cut reforms, a per-flight one does not.
    await prisma.stage.update({
      where: { id: r2 },
      data: { cutEnabled: true, cutScope: "perFlight", cutMode: "count", cutCount: 2 },
    });

    await generateCutRound(eventId, r2);

    // Untouched: every player is still in the exact flight they started in —
    // including the eight the cut did not advance.
    const after = await prisma.player.findMany({
      where: { eventId },
      select: { id: true, groupId: true },
    });
    expect(after).toHaveLength(12);
    for (const p of after) expect(p.groupId).toBe(groupBefore.get(p.id));

    const r2Matches = await prisma.match.findMany({ where: { eventId, stageId: r2 } });
    // One match per flight (a round robin of the two survivors), on the
    // original flight rows.
    expect(r2Matches).toHaveLength(3);
    for (const m of r2Matches) expect(flights).toContain(m.groupId);
  });
});

describe("cutting a match-play field into a stroke-play final", () => {
  it("gives each survivor a playable card and none to anyone cut", async () => {
    // The cross-format case: qualify by match play, then a stroke-play final.
    // The cut has to chain across the boundary even though round two draws no
    // pairings — the survivors advance by each being handed an empty card.
    const { eventId, r2, players } = await seedEvent({ type: "Stroke Play Round", format: "Stroke Play" });
    await prisma.stage.update({
      where: { id: r2 },
      data: { cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 4 },
    });

    await generateCutRound(eventId, r2);

    // Four survivors, each with an empty, playable card in round two; nobody
    // else has one, so the field of the final is exactly who advanced.
    const cards = await prisma.scorecard.findMany({ where: { eventId, stageId: r2 } });
    expect(cards).toHaveLength(4);
    for (const c of cards) {
      const strokes = JSON.parse(c.strokes) as (number | null)[];
      expect(strokes).toHaveLength(18);
      expect(strokes.every((s) => s === null)).toBe(true);
    }
    // A stroke round draws no matches.
    const matches = await prisma.match.findMany({ where: { eventId, stageId: r2 } });
    expect(matches).toHaveLength(0);
    // The cut removed eight; only survivors carry a card.
    expect(players.length - cards.length).toBe(8);

    // And the leaderboard is not a wall of zeroes: round one is a fully played
    // Round Robin, so the standings the console shows still hold its real
    // results — generating the empty final did not blank them.
    const state = await loadEventState(eventId);
    expect(state).not.toBeNull();
    expect(state!.overall[0].stats.totalPoints).toBeGreaterThan(0);
  });
});
