import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { loadEventState } from "../services/tournament";
import { freezeRoundHandicaps, roundHandicapsFor } from "../services/round-handicap";
import { teamsForStage, teamStandings } from "../services/teams";
import { skinsPotFor } from "../services/skins-pot";
import { skinsBoard } from "../services/points-standings";

/**
 * EVERY READER TAKES THE ALLOWANCE OF THE SAME FIGURE — the one before rounding.
 *
 * `allowance-is-taken-of-the-exact-figure.test.ts` holds the arithmetic to the
 * Rules of Handicapping (6.2a) and reads every caller's source. That says which
 * function each reader calls and nothing about the number that comes out of it:
 * a reader that calls the right function and hands it the rounded figure is a
 * stroke out for one player in five, and agrees with every source assertion.
 *
 * So one fixture, built so that rounding first and rounding last give different
 * answers, and each reader held to the Rule's:
 *
 *     the board             `loadEventState().strokeHandicapFor`
 *     the round's screen    `roundHandicapsFor().playing`
 *     the skins board       `skinsBoard`, through `points-standings.ts`
 *     the skins money       `skinsPotFor`
 *     a four-ball side      `teamsForStage().members[].playing`, and its net on
 *                           `teamStandings`
 *     a foursomes side      `teamsForStage().playingHandicap`
 *
 * The field is unrated on purpose: with no tees the index IS the course
 * handicap before rounding, so the figures below can be checked by hand.
 *
 *     medal, 95%       9.5  -> 9.025 -> 9          rounded first: 10 -> 9.5  -> 10
 *     four-ball, 85%   8.6  -> 7.31  -> 7          rounded first: 9  -> 7.65 -> 8
 *     foursomes, 50%   10.6 + 9.6 = 20.2 -> 10.1 -> 10
 *                                                  rounded first: 11 + 10 = 21 -> 10.5 -> 11
 *
 * NOT COVERED HERE: league match points, the team MATCH recompute and the net
 * import. Each is pinned by source to the exact reader and none has a value
 * behind it in this file; the browser round reaches the first two.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/every-reader-takes-the-allowance-of-one-figure.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ONEFIGURE";

let eventId = "";
let medalId = "";
let fourBallId = "";
let foursomesId = "";
const player: Record<string, string> = {};

const PARS = new Array(18).fill(4);
// Stroke index 1..18 in hole order, so a hole's number is its stroke index.
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/** Invented, and each chosen for the line of the table above it stands on. */
const INDEXES: Record<string, number> = {
  half: 9.5, // the medal
  scratch: 0,
  tenAndAHalf: 8.6, // the four-ball, which at stroke play is 85% (Appendix C)
  partner: 0,
  higher: 10.6, // the foursomes
  lower: 9.6,
};

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
      name: `${TAG} open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}-${Date.now()}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
    },
  });
  eventId = event.id;

  const stage = (position: number, format: string) =>
    prisma.stage.create({
      data: { eventId, position, type: "Stroke Play Round", format, scoringBasis: "net", holes: 18 },
    });
  medalId = (await stage(0, "Stroke Play")).id;
  fourBallId = (await stage(1, "Four-Ball")).id;
  foursomesId = (await stage(2, "Foursomes")).id;

  for (const [i, who] of Object.keys(INDEXES).entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: INDEXES[who],
      },
    });
    player[who] = p.id;
  }

  const side = async (stageId: string, name: string, members: string[]) => {
    const t = await prisma.team.create({ data: { eventId, stageId, name: `${TAG} ${name}`, seed: 1 } });
    await prisma.teamMember.createMany({
      data: members.map((who, position) => ({ teamId: t.id, playerId: player[who], position })),
    });
    return t.id;
  };
  const fourBallSide = await side(fourBallId, "four-ball pair", ["tenAndAHalf", "partner"]);
  await side(foursomesId, "foursomes pair", ["higher", "lower"]);

  // The medal: two identical gross cards, a four on every hole. Whoever has a
  // stroke on a hole is alone on three there.
  const fours = JSON.stringify(new Array(18).fill(4));
  await prisma.scorecard.createMany({
    data: ["half", "scratch"].map((who) => ({ eventId, stageId: medalId, playerId: player[who], strokes: fours })),
  });
  const pot = await prisma.skinsPot.create({
    data: { eventId, stageId: medalId, net: true, scope: "full", groupKey: "", buyInCents: 1000 },
  });
  await prisma.skinsEntry.createMany({
    data: ["half", "scratch"].map((who) => ({ potId: pot.id, playerId: player[who], confirmed: true })),
  });

  // The four-ball: a five on every hole for both balls, so the side's net is
  // 90 less the strokes the handicapped ball receives.
  const fives = JSON.stringify(new Array(18).fill(5));
  await prisma.teamScorecard.createMany({
    data: ["tenAndAHalf", "partner"].map((who) => ({
      eventId,
      stageId: fourBallId,
      teamId: fourBallSide,
      playerId: player[who],
      strokes: fives,
    })),
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the fixture can tell the two methods apart", () => {
  it("CONTROL: rounded first, each of the three is one stroke different", () => {
    const once = (exact: number, pct: number) => Math.floor((exact * pct) / 100 + 0.5);
    expect([once(9.5, 95), once(Math.round(9.5), 95)]).toEqual([9, 10]);
    expect([once(8.6, 85), once(Math.round(8.6), 85)]).toEqual([7, 8]);
    expect([once(10.6 + 9.6, 50), once(Math.round(10.6) + Math.round(9.6), 50)]).toEqual([10, 11]);
  });
});

describe("the medal, at 95%", () => {
  it("the board plays the 9.5 off 9", async () => {
    const state = await loadEventState(eventId);
    expect(state!.strokeHandicapFor(player.half, medalId)).toBe(9);
    expect(state!.strokeHandicapFor(player.scratch, medalId)).toBe(0);
  });

  it("the round's screen says 10, 9.5 before rounding, plays off 9", async () => {
    const rows = await roundHandicapsFor(eventId, medalId);
    const row = rows.find((r) => r.playerId === player.half)!;
    expect([row.handicap, row.exact, row.allowance, row.playing]).toEqual([10, 9.5, 95, 9]);
  });

  /** The holes the handicapped player is alone on: 1..9 by the Rule, 1..10 rounded first. */
  const holesOf = (holes: { playerId: string | null; hole: number }[]) =>
    holes
      .filter((h) => h.playerId === player.half)
      .map((h) => h.hole)
      .sort((a, b) => a - b);

  it("the skins board gives them holes 1 to 9 and not the 10th", async () => {
    const board = await skinsBoard(eventId, medalId, 18, true, SI);
    const holes = holesOf(board.outcome.holes);
    expect(holes).toContain(9);
    expect(holes, "a stroke on the 10th is the rounded-first handicap of 10").not.toContain(10);
  });

  it("and so does the money", async () => {
    const view = await skinsPotFor(eventId, medalId, true, "full", "");
    expect(view, "no pot view came back").not.toBeNull();
    const holes = holesOf(view!.holes);
    expect(holes).toContain(9);
    expect(holes, "a stroke on the 10th is the rounded-first handicap of 10").not.toContain(10);
  });
});

describe("the four-ball, at stroke play's 85%", () => {
  it("each ball plays off 85% of its own unrounded handicap", async () => {
    const [side] = await teamsForStage(eventId, fourBallId, "Four-Ball", 0, 18);
    const m = side.members.find((x) => x.playerId === player.tenAndAHalf)!;
    expect([m.handicap, m.handicapExact, m.playing]).toEqual([9, 8.6, 7]);
    expect(side.members.find((x) => x.playerId === player.partner)!.playing).toBe(0);
  });

  it("and the side's net on the board is 90 less those seven strokes", async () => {
    const rows = await teamStandings(eventId, fourBallId, "Four-Ball", PARS, SI, "net");
    expect(rows).toHaveLength(1);
    expect(rows[0].gross).toBe(90);
    expect(rows[0].net).toBe(83);
  });
});

describe("the foursomes, at 50% of the pair", () => {
  it("adds the two unrounded handicaps and rounds once", async () => {
    const [side] = await teamsForStage(eventId, foursomesId, "Foursomes", 0, 18);
    // What each is told on the tee is still a whole number.
    expect(side.members.map((m) => m.handicap).sort()).toEqual([10, 11]);
    // Nobody in a foursome has a playing handicap of their own.
    expect(side.members.map((m) => m.playing)).toEqual([null, null]);
    expect(side.playingHandicap).toBe(10);
  });
});

/**
 * AND AFTER THE ROUND IS FROZEN, WITH THE ROSTER MOVED INSIDE THE SAME WHOLE
 * NUMBER — the case a frozen whole number alone gets wrong.
 *
 * 9.5 becomes 10.4: still a course handicap of 10, and at 95% now 9.88, which
 * is 10. 8.6 becomes 9.4: still 9, and at 85% now 7.99, which is 8. 10.6
 * becomes 11.3 and 9.6 becomes 10.3: still 11 and 10, and half of 21.6 is 10.8,
 * which is 11. Every reader must go on saying what the round was played off,
 * and each of them reads the frozen row by its own route: the board from
 * `loadEventState`, the other five through `roundHandicapRows` or the screen's
 * own query. Last in the file because it changes the fixture.
 */
describe("after the freeze, every reader still says what the round was played off", () => {
  beforeAll(async () => {
    for (const stageId of [medalId, fourBallId, foursomesId]) await freezeRoundHandicaps(eventId, stageId);
    const moved: Record<string, number> = { half: 10.4, tenAndAHalf: 9.4, higher: 11.3, lower: 10.3 };
    for (const [who, handicap] of Object.entries(moved)) {
      await prisma.player.update({ where: { id: player[who] }, data: { handicap } });
    }
  });

  it("CONTROL: the roster really moved, and a round not yet played follows it", async () => {
    const later = await prisma.stage.create({
      data: { eventId, position: 3, type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "net", holes: 18 },
    });
    const state = await loadEventState(eventId);
    expect(state!.strokeHandicapFor(player.half, later.id)).toBe(10);
  });

  it("the board, the screen, the skins board and the money, on the medal", async () => {
    const state = await loadEventState(eventId);
    expect(state!.strokeHandicapFor(player.half, medalId)).toBe(9);

    const row = (await roundHandicapsFor(eventId, medalId)).find((r) => r.playerId === player.half)!;
    expect([row.handicap, row.exact, row.playing, row.source]).toEqual([10, 9.5, 9, "frozen"]);

    const mine = (holes: { playerId: string | null; hole: number }[]) =>
      holes.filter((h) => h.playerId === player.half).map((h) => h.hole);
    const board = mine((await skinsBoard(eventId, medalId, 18, true, SI)).outcome.holes);
    expect(board).toContain(9);
    expect(board).not.toContain(10);
    const money = mine((await skinsPotFor(eventId, medalId, true, "full", ""))!.holes);
    expect(money).toContain(9);
    expect(money).not.toContain(10);
  });

  it("the four-ball side and its net", async () => {
    const [side] = await teamsForStage(eventId, fourBallId, "Four-Ball", 0, 18);
    const m = side.members.find((x) => x.playerId === player.tenAndAHalf)!;
    expect([m.handicap, m.handicapExact, m.playing]).toEqual([9, 8.6, 7]);
    const rows = await teamStandings(eventId, fourBallId, "Four-Ball", PARS, SI, "net");
    expect(rows[0].net).toBe(83);
  });

  it("the foursomes pair", async () => {
    const [side] = await teamsForStage(eventId, foursomesId, "Foursomes", 0, 18);
    expect(side.playingHandicap).toBe(10);
  });
});
