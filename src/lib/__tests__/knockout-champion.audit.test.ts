import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { finishOrderFor } from "../services/series";
import { championFor } from "../services/honours";

/**
 * Who won a knockout, according to the two things that record it for keeps.
 *
 * The honours board and the season table both asked the points standings, and a
 * knockout has no points — so `computeStandings` gave every player zero and
 * sorted them by seed, which is handicap order. The board proposed the lowest
 * handicap in the field as champion; the season table scored the field in
 * handicap order behind them. Neither had looked at the bracket, which is the
 * one place the answer was written down.
 *
 * Needs a live DATABASE_URL:
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-KO-CHAMPION";

let orgId = "";

/**
 * A four-player knockout, played out so that the LOWEST seed wins it.
 *
 * Handicaps ascend with the seed, so seed order, handicap order and the true
 * result disagree in every direction — an answer that happens to match the
 * standings cannot pass by accident.
 */
async function seedPlayedKnockout() {
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
      status: "completed",
      shape: "knockout",
      formationRule: "balanced",
      shareToken: `audit-ko-${Date.now()}-${Math.random()}`,
      qualifyMode: "overall",
      qualifyOverall: 4,
      bracketMode: "single",
      completedAt: new Date(),
    },
  });
  const eventId = event.id;
  await prisma.stage.create({
    data: { eventId, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 },
  });
  const flight = (await prisma.group.create({ data: { eventId, name: "A", position: 0 } })).id;

  const ids: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    // A roster member, because the season table only scores linked players.
    const member = await prisma.member.create({
      data: {
        organizationId: orgId,
        name: `${TAG} M${i + 1}`,
        email: `${TAG.toLowerCase()}-m${i}-${Date.now()}-${Math.random()}@example.invalid`,
      },
    });
    const p = await prisma.player.create({
      data: {
        eventId,
        memberId: member.id,
        name: `${TAG} Seed${i + 1}`,
        email: member.email,
        handicap: 2 + i * 4,
        seed: i + 1,
        status: "confirmed",
        groupId: flight,
      },
    });
    ids.push(p.id);
  }

  // Play it out with the B side winning every match, which in a bracket of four
  // means the champion is never the top seed.
  let state = await loadEventState(eventId);
  for (let r = 0; r < state!.brackets.winners.rounds.length; r += 1) {
    for (const m of state!.brackets.winners.rounds[r].matches) {
      if (!m.a.playerId || !m.b.playerId) continue;
      await prisma.bracketWinner.create({
        data: { eventId, key: m.key, winnerId: m.b.playerId },
      });
    }
    state = await loadEventState(eventId);
  }

  return { eventId, ids, state: state! };
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

describe("a knockout's champion is the player who won the final", () => {
  it("is what the honours board proposes", async () => {
    const { eventId, ids, state } = await seedPlayedKnockout();
    const champion = state.brackets.winners.champion!.playerId!;
    expect(champion).toBeTruthy();
    expect(champion).not.toBe(ids[0]); // not the top seed, which is the fault

    const proposed = await championFor(orgId, eventId);

    expect(proposed).not.toBeNull();
    expect(proposed!.suggestion.ok).toBe(true);
    expect(proposed!.suggestion.ok && proposed!.suggestion.playerId).toBe(champion);
  });

  it("is first in the order the season table scores", async () => {
    const { eventId, ids, state } = await seedPlayedKnockout();
    const champion = state.brackets.winners.champion!.playerId!;
    const nameOf = new Map(state.players.map((p) => [p.id, p.name]));

    const finish = await finishOrderFor(eventId);

    expect(finish).not.toBeNull();
    // Every player placed, and the champion first.
    expect(finish!.finishers).toHaveLength(4);
    expect(finish!.finishers[0].name).toBe(nameOf.get(champion));
    expect(finish!.finishers[0].rank).toBe(1);
    // The top seed does not collect the winner's points for turning up.
    const topSeed = finish!.finishers.find((f) => f.name === nameOf.get(ids[0]));
    expect(topSeed!.rank).toBeGreaterThan(1);
  });

  it("places the beaten semi-finalists joint third, not second and third", async () => {
    // Two players lost at the same stage. Splitting them would hand one of
    // them runner-up points for a match they never played.
    const { eventId } = await seedPlayedKnockout();
    const finish = await finishOrderFor(eventId);
    expect(finish!.finishers.map((f) => f.rank)).toEqual([1, 2, 3, 3]);
  });

  it("proposes nothing while the knockout is unfinished", async () => {
    /**
     * The fallback must not reintroduce the fault from the other side. With no
     * champion the bracket says nothing, and the standings behind it are all
     * zeroes in handicap order — so the honours board has to decline rather
     * than crown the lowest handicap in the field.
     */
    const { eventId } = await seedPlayedKnockout();
    await prisma.bracketWinner.deleteMany({ where: { eventId } });

    const proposed = await championFor(orgId, eventId);

    expect(proposed!.suggestion.ok).toBe(false);
  });
});
