import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { teamStandings } from "@/lib/services/teams";

/**
 * A FOUR-BALL SIDE CARRIES EACH PLAYER'S OWN PLAYING HANDICAP, AND A FOURSOMES
 * SIDE CARRIES NONE (backlog J23).
 *
 * The board used to print the side's `playingHandicap` — 90% of the pair's
 * combined handicaps on a four-ball — which no player takes a stroke from.
 * `TeamStanding.memberPlaying` is what each partner plays off: the round's
 * allowance of the EXACT course handicap, rounded once (Rules of Handicapping
 * 6.2a, Appendix C).
 *
 * Worked from the Rules by a route the code does not take, in whole tenths
 * so no floating point is shared: no rated tees, so a course handicap is the
 * index. Four-ball stroke play is 85%.
 *
 *     8.6  x 85% = 7.31   -> 7      (rounding 8.6 to 9 first gives 7.65 -> 8)
 *     10.3 x 85% = 8.755  -> 9
 *
 * so the pair prints 7 and 9 where the rounded-first route prints 8 and 9.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TWOBALLHCP";
const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
let eventId = "";
let fourBallStage = "";
let foursomesStage = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** The Rules' answer, in tenths of a stroke, half up. */
const rulesPlaying = (indexTenths: number, pct: number) => Math.floor((indexTenths * pct * 2 + 1000) / 2000);

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} pairs`,
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
  fourBallStage = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Four-Ball", holes: 18, scoringBasis: "net" } })).id;
  foursomesStage = (await prisma.stage.create({ data: { eventId, position: 1, type: "Stroke Play Round", format: "Foursomes", holes: 18, scoringBasis: "net" } })).id;
  const ann = await prisma.player.create({ data: { eventId, name: `${TAG} Ann`, handicap: 8.6, seed: 1, email: "ann@example.invalid" } });
  const bob = await prisma.player.create({ data: { eventId, name: `${TAG} Bob`, handicap: 10.3, seed: 2, email: "bob@example.invalid" } });
  for (const stageId of [fourBallStage, foursomesStage]) {
    const team = await prisma.team.create({ data: { eventId, stageId, name: `${TAG} pair ${stageId.slice(-4)}`, seed: 1 } });
    await prisma.teamMember.create({ data: { teamId: team.id, playerId: ann.id, position: 0 } });
    await prisma.teamMember.create({ data: { teamId: team.id, playerId: bob.id, position: 1 } });
  }
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a pair's standing carries what each partner plays off", () => {
  it("CONTROL: the Rules' answer for the fixture is 7 and 9, not the rounded-first 8 and 9", () => {
    expect([rulesPlaying(86, 85), rulesPlaying(103, 85)]).toEqual([7, 9]);
    expect(Math.round(Math.round(8.6) * 0.85)).toBe(8);
  });

  it("a four-ball lists 7 and 9", async () => {
    const [row] = await teamStandings(eventId, fourBallStage, "Four-Ball", PARS, SI, "net");
    expect(row.members.map((n) => n.replace(`${TAG} `, ""))).toEqual(["Ann", "Bob"]);
    expect(row.memberPlaying).toEqual([rulesPlaying(86, 85), rulesPlaying(103, 85)]);
  });

  it("a foursomes lists nobody's own figure: the side shares one ball", async () => {
    const [row] = await teamStandings(eventId, foursomesStage, "Foursomes", PARS, SI, "net");
    expect(row.memberPlaying).toEqual([null, null]);
    // 50% of the combined 18.9 = 9.45 -> 9
    expect(row.playingHandicap).toBe(9);
  });
});
