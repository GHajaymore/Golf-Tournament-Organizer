import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { repairPlayerPairings } from "../services/regroup";

/**
 * Moving a player between flights, against the real database.
 *
 * The bug this pins: a move wrote one foreign key and stopped. The round-robin
 * matches drawn for the old flight stayed where they were, so the player still
 * held a full card against a flight they had left and none at all against the
 * one they had joined — and the flight standings happily showed them under the
 * new flight with results earned in the old one. Every count still added up,
 * which is why nothing caught it.
 *
 * Needs a live DATABASE_URL and writes real rows, so it lives in the audit
 * suite:
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FLIGHT-MOVE";

let eventId = "";
let stageId = "";
let flightA = "";
let flightB = "";
let mover = "";

const empty = JSON.stringify(new Array(18).fill(null));

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  /**
   * Its own club, not whichever one happens to already exist.
   *
   * This borrowed a REAL organization via `organization.findFirst()`. On an
   * empty database there is none, so the file died in setup — which is how
   * CI found it. The quieter half is worse: on a machine that HAS data it
   * silently hung these fixtures off whatever club sorted first, which can
   * be a live one. Every other audit file makes its own; these two did not.
   */
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} manual draw`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "draft",
      shape: "series",
      formationRule: "manual",
      shareToken: `audit-move-${Date.now()}`,
    },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 },
  });
  stageId = stage.id;

  const a = await prisma.group.create({ data: { eventId, name: "A", position: 0 } });
  const b = await prisma.group.create({ data: { eventId, name: "B", position: 1 } });
  flightA = a.id;
  flightB = b.id;

  // Three a side, so both flights have a real round robin to disturb.
  const made: Record<string, string[]> = { [flightA]: [], [flightB]: [] };
  for (const [i, name] of ["A1", "A2", "A3", "B1", "B2", "B3"].entries()) {
    const groupId = i < 3 ? flightA : flightB;
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${name}`,
        email: `${TAG.toLowerCase()}-${i}@example.invalid`,
        handicap: 10 + i,
        seed: i + 1,
        status: "confirmed",
        groupId,
      },
    });
    made[groupId].push(p.id);
  }
  mover = made[flightA][2];

  let round = 1;
  for (const groupId of [flightA, flightB]) {
    const ids = made[groupId];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        await prisma.match.create({
          data: {
            eventId,
            stageId,
            groupId,
            round: round++,
            playerAId: ids[i],
            playerBId: ids[j],
            holes: empty,
          },
        });
      }
    }
    round = 1;
  }
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  // The club goes last: the events hanging off it are deleted above.
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("repairPlayerPairings", () => {
  it("leaves nobody playing a flight they are not in", async () => {
    await prisma.player.update({ where: { id: mover }, data: { groupId: flightB } });
    await repairPlayerPairings(eventId, mover);

    const players = await prisma.player.findMany({ where: { eventId } });
    const groupOf = new Map(players.map((p) => [p.id, p.groupId]));
    const matches = await prisma.match.findMany({ where: { eventId, stageId } });

    // The invariant the move used to break: both sides of every match are in
    // the flight the match is recorded under.
    for (const m of matches) {
      expect(groupOf.get(m.playerAId)).toBe(m.groupId);
      expect(groupOf.get(m.playerBId)).toBe(m.groupId);
    }
  });

  it("plays them against everyone in the new flight and nobody in the old", async () => {
    const matches = await prisma.match.findMany({
      where: { eventId, stageId, OR: [{ playerAId: mover }, { playerBId: mover }] },
    });
    const opponents = matches.map((m) => (m.playerAId === mover ? m.playerBId : m.playerAId));

    const newMates = await prisma.player.findMany({
      where: { eventId, groupId: flightB, status: "confirmed", id: { not: mover } },
      select: { id: true },
    });
    expect([...opponents].sort()).toEqual(newMates.map((p) => p.id).sort());
  });

  it("does not double-book anyone in a round", async () => {
    const matches = await prisma.match.findMany({ where: { eventId, stageId } });
    const seen = new Set<string>();
    for (const m of matches) {
      for (const id of [m.playerAId, m.playerBId]) {
        const key = `${id}#${m.round}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it("keeps the flights they left a complete round robin among who is left", async () => {
    const left = await prisma.player.findMany({
      where: { eventId, groupId: flightA, status: "confirmed" },
      select: { id: true },
    });
    const matches = await prisma.match.findMany({ where: { eventId, stageId, groupId: flightA } });
    const n = left.length;
    expect(matches).toHaveLength((n * (n - 1)) / 2);
  });
});
