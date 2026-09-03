import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState, standingRows } from "../services/tournament";

/**
 * Two players printed on the same position, one advanced and one sent home.
 *
 * The board shares a rank when a countback cannot separate two cards, and it is
 * right to. Qualification then takes the first N of that list, and inside a
 * tied pair the order is whatever the sort's last fallback left — seed, which
 * is handicap order. Nothing said so: the row was lit as advancing, the row
 * below it was not, and the exported sheet carried both at rank 2 with one
 * "Advancing" and one "Eliminated".
 *
 * Proven against real rows because the tie has to survive the whole pipeline —
 * two identical cards, the countback that cannot split them, the shared rank,
 * and the slice that then does. A hand-built fixture could assert the shared
 * rank into existence; this has to earn it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CUT-TIE";

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [1, 11, 17, 3, 7, 13, 15, 5, 9, 2, 12, 18, 4, 8, 14, 16, 6, 10];

let orgId = "";

/** A round of `n` on every hole, so two players can be made genuinely level. */
const card = (n: number) => JSON.stringify(new Array(18).fill(n));

async function seedTiedStrokeEvent() {
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
      status: "active",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      shareToken: `audit-tie-${Date.now()}-${Math.random()}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(SI),
      // Two advance overall, and the second place is the one in dispute.
      qualifyMode: "overall",
      qualifyOverall: 2,
    },
  });
  const eventId = event.id;
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Stroke Play",
      holes: 18,
      scoringBasis: "gross",
    },
  });
  // A knockout to qualify into, which is what makes "advancing" mean anything.
  await prisma.stage.create({
    data: { eventId, position: 1, type: "Bracket Stage", format: "Match Play", holes: 18 },
  });
  const flight = (await prisma.group.create({ data: { eventId, name: "A", position: 0 } })).id;

  /**
   * The winner, then TWO IDENTICAL CARDS, then a tail-ender.
   *
   * The two tied players are seeded 2 and 3 and given the same score on every
   * hole, so no countback can separate them — countback compares hole by hole
   * and they match all eighteen. Whichever of them the app advances, it does so
   * on seed order alone, which is the fault.
   */
  const spec = [
    { label: "WINNER", strokes: 4, handicap: 6, seed: 1 },
    { label: "TIED-A", strokes: 5, handicap: 9, seed: 2 },
    { label: "TIED-B", strokes: 5, handicap: 9, seed: 3 },
    { label: "LAST", strokes: 6, handicap: 12, seed: 4 },
  ];
  const ids: Record<string, string> = {};
  for (const s of spec) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${s.label}`,
        email: `${TAG.toLowerCase()}-${s.label}-${Date.now()}-${Math.random()}@example.invalid`,
        handicap: s.handicap,
        seed: s.seed,
        status: "confirmed",
        groupId: flight,
      },
    });
    ids[s.label] = p.id;
    await prisma.scorecard.create({
      data: { eventId, stageId: stage.id, playerId: p.id, strokes: card(s.strokes) },
    });
  }
  return { eventId, ids };
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

describe("a tie for the last qualifying place is reported, not silently broken", () => {
  it("really does produce two players on one position", async () => {
    // The fixture has to earn the shared rank rather than assert it — if the
    // countback separated them there would be no tie here to find, and every
    // assertion below would pass for the wrong reason.
    const { eventId, ids } = await seedTiedStrokeEvent();
    const state = await loadEventState(eventId);
    const rankOf = (id: string) =>
      state!.strokeStandings.find((s) => s.player.id === id)!.rank;

    expect(rankOf(ids["TIED-A"])).toBe(rankOf(ids["TIED-B"]));
    expect(rankOf(ids["TIED-A"])).toBe(2);
  });

  it("advances exactly one of them, and marks them both", async () => {
    const { eventId, ids } = await seedTiedStrokeEvent();
    const state = await loadEventState(eventId);
    const rows = standingRows(state!);
    const rowOf = (id: string) => rows.find((r) => r.id === id)!;

    // The provisional pick still happens — a tournament has to keep running.
    const advancing = [ids["TIED-A"], ids["TIED-B"]].filter((id) => rowOf(id).advancing);
    expect(advancing).toHaveLength(1);

    // But both rows now say the place is undecided.
    expect(rowOf(ids["TIED-A"]).tiedAtCut).toBe(true);
    expect(rowOf(ids["TIED-B"]).tiedAtCut).toBe(true);
  });

  it("leaves the players nowhere near the line alone", async () => {
    const { eventId, ids } = await seedTiedStrokeEvent();
    const rows = standingRows((await loadEventState(eventId))!);
    const rowOf = (id: string) => rows.find((r) => r.id === id)!;

    expect(rowOf(ids["WINNER"]).tiedAtCut).toBe(false);
    expect(rowOf(ids["WINNER"]).advancing).toBe(true);
    expect(rowOf(ids["LAST"]).tiedAtCut).toBe(false);
    expect(rowOf(ids["LAST"]).advancing).toBe(false);
  });

  it("says nothing once the tie is broken by a real score", async () => {
    /**
     * The guard against the guard. A marker that stayed put after the players
     * separated would tell an organizer to run a play-off that the golf has
     * already settled.
     */
    const { eventId, ids } = await seedTiedStrokeEvent();
    await prisma.scorecard.updateMany({
      where: { eventId, playerId: ids["TIED-B"] },
      data: { strokes: card(6) },
    });

    const rows = standingRows((await loadEventState(eventId))!);
    const rowOf = (id: string) => rows.find((r) => r.id === id)!;

    expect(rowOf(ids["TIED-A"]).tiedAtCut).toBe(false);
    expect(rowOf(ids["TIED-A"]).advancing).toBe(true);
    expect(rowOf(ids["TIED-B"]).tiedAtCut).toBe(false);
    expect(rowOf(ids["TIED-B"]).advancing).toBe(false);
  });
});
