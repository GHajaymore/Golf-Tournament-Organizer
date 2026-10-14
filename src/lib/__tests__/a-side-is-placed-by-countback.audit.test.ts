import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { teamStandings } from "@/lib/services/teams";

/**
 * A SIDE'S PLACE IS DECIDED BY COUNTBACK, AS A PLAYER'S IS.
 *
 * The boards print the place countback decides (Ajay's ruling of 2026-09-26).
 * The individual board always did; the team boards numbered their sides on the
 * figure alone, so three sides on 70 were a three-way tie for first where a
 * committee counts back. Since 2026-10-14 `teamStandings` decides the place
 * (`TeamStanding.place`) and every board prints it.
 *
 * Worked by hand, a gross scramble, every par a 4:
 *
 *     Ants   out 38 (two 5s)    home 32 (four 3s)   70
 *     Bees   out 32             home 38             70
 *     Cats   Ants' card exactly                     70
 *     Dots   no card
 *
 * Ants and Cats are level on everything, so they share first. Bees is behind
 * them on the last nine, so third — not tied. Dots holds no place.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SIDECOUNTBACK";
const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
let eventId = "";
let stageId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const OUT_HIGH = [5, 5, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 4, 4, 4, 4, 4];
const OUT_LOW = [3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 4, 4, 4, 4, 4, 4, 4];

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} scramble`,
        status: "live",
        format: "stroke",
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${process.pid}`,
        customPars: JSON.stringify(PARS),
        customYards: JSON.stringify(new Array(18).fill(380)),
        customStrokeIndex: JSON.stringify(SI),
      },
    })
  ).id;
  stageId = (
    await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Scramble", holes: 18, scoringBasis: "gross" } })
  ).id;
  for (const [i, [name, card]] of ([["Ants", OUT_HIGH], ["Bees", OUT_LOW], ["Cats", OUT_HIGH], ["Dots", null]] as const).entries()) {
    const team = await prisma.team.create({ data: { eventId, stageId, name: `${TAG} ${name}`, seed: i + 1 } });
    if (card) {
      await prisma.teamScorecard.create({ data: { eventId, stageId, matchId: "", teamId: team.id, playerId: "", strokes: JSON.stringify(card) } });
    }
  }
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a gross scramble with three sides on 70", () => {
  it("CONTROL: the fixture is what it says — three sides on gross 70, one with no card", async () => {
    expect(OUT_HIGH.reduce((a, b) => a + b, 0)).toBe(70);
    expect(OUT_LOW.reduce((a, b) => a + b, 0)).toBe(70);
    const rows = await teamStandings(eventId, stageId, "Scramble", PARS, SI, "gross");
    expect(rows.filter((r) => r.played > 0).map((r) => r.gross)).toEqual([70, 70, 70]);
  });

  it("shares first between the two level on countback, and puts the third behind them", async () => {
    const rows = await teamStandings(eventId, stageId, "Scramble", PARS, SI, "gross");
    expect(rows.map((r) => [r.name.replace(`${TAG} `, ""), r.place])).toEqual([
      ["Ants", 1],
      ["Cats", 1],
      ["Bees", 3],
      ["Dots", null],
    ]);
  });
});
