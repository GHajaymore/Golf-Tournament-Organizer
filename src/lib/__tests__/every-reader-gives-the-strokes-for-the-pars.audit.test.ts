import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { freezeRoundHandicaps, roundHandicapsFor } from "../services/round-handicap";
import { teamsForStage } from "../services/teams";
import { skinsPotFor } from "../services/skins-pot";
import { skinsBoard } from "../services/points-standings";

/**
 * EVERY READER OF A ROUND GIVES THE SAME STROKES FOR TEES OF A HIGHER PAR.
 *
 * Rules of Handicapping 6.2b: in stroke play and match play counted in strokes,
 * a player on tees of a higher par than the lowest the field is playing is
 * given the difference, after the allowance. See
 * `tees-of-a-higher-par-get-their-strokes.test.ts` for the Rule and the
 * arithmetic; this is the same question asked of real rows, of each reader in
 * turn, because the readers do not share a field:
 *
 *     the board             `loadEventState` — everybody
 *     the round's own list  `roundHandicapsFor` — everybody confirmed
 *     a side's players      `teamsForStage` — the members of the round's sides
 *     net skins             `skinsPotFor` — the players IN THE POT
 *     the public skins      `skinsBoard`
 *
 * and "the lowest par" worked out by each from the players it happens to hold
 * is a different figure for each. The pot here is two ladies, both off par 72:
 * left to itself it finds no difference and gives neither the stroke the board
 * gives both. A skin is won hole by hole, so that is a different hole won and
 * money in a different pocket — not a total out by one.
 *
 * The fixture is a mixed medal off two sets of one course: par 71 and par 72,
 * with a par-70 set on the course that nobody plays.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PARSTROKES";

let eventId = "";
const round: Record<string, string> = {};
const player: Record<string, string> = {};
const tee: Record<string, string> = {};

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

type Rating = { courseRating: number; slopeRating: number; par: number };
const WHITE: Rating = { courseRating: 70.8, slopeRating: 129, par: 71 };
const RED: Rating = { courseRating: 72.9, slopeRating: 127, par: 72 };
/** On the course, of a lower par than either, and played by nobody. */
const GOLD: Rating = { courseRating: 66.0, slopeRating: 105, par: 70 };

const FIELD: Record<string, { index: number; tee: "red" | "white" | null }> = {
  ann: { index: 18.2, tee: "red" },
  bea: { index: 9.4, tee: "red" },
  // No set of his own: the tournament's, which is the whites.
  col: { index: 12.0, tee: null },
  dev: { index: 3.1, tee: "white" },
};
const ratingOf = (who: string): Rating => (FIELD[who].tee === "red" ? RED : WHITE);

/**
 * THE RULES, IN WHOLE NUMBERS: the allowance of the unrounded course handicap,
 * rounded once (6.2a), then the difference in pars (6.2b). In 113,000ths of a
 * stroke, so that it shares neither formula nor floating point with the app.
 */
function allowanceOf(who: string, pct: number, t: Rating = ratingOf(who)): number {
  const tenths = Math.round(FIELD[who].index * 10);
  const n = (tenths * t.slopeRating + (Math.round(t.courseRating * 10) - t.par * 10) * 113) * pct;
  return Math.floor((2 * n + 113_000) / (2 * 113_000));
}
const LOWEST_PAR = 71;
const byTheRules = (who: string, pct: number) => allowanceOf(who, pct) + (ratingOf(who).par - LOWEST_PAR);

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
  });
  const [white, red] = await Promise.all([
    prisma.tee.create({ data: { courseId: course.id, name: `${TAG} white`, ...WHITE, position: 0 } }),
    prisma.tee.create({ data: { courseId: course.id, name: `${TAG} red`, gender: "female", ...RED, position: 1 } }),
    prisma.tee.create({ data: { courseId: course.id, name: `${TAG} gold`, ...GOLD, position: 2 } }),
  ]);
  tee.white = white.id;
  tee.red = red.id;
  tee.gold = (await prisma.tee.findFirstOrThrow({ where: { courseId: course.id, name: `${TAG} gold` } })).id;

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} mixed medal`,
      dates: "",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      courseId: course.id,
      defaultTeeId: white.id,
      teePolicy: "own",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });

  const make = (position: number, format: string, extra: Record<string, unknown> = {}) =>
    prisma.stage.create({
      data: { eventId, position, type: "Stroke Play Round", format, holes: 18, scoringBasis: "net", ...extra },
    });
  round.medal = (await make(0, "Stroke Play")).id;
  round.stableford = (await make(1, "Stableford")).id;
  round.fourball = (await make(2, "Four-Ball")).id;
  round.nine = (await make(3, "Stroke Play", { holes: 9 })).id;
  // A stroke round SET to points, the older way of storing a Stableford.
  round.points = (await make(4, "Stroke Play", { scoringBasis: "stableford" })).id;
  round.second = (await make(5, "Stroke Play")).id;
  // A four-ball whose only side is the two ladies: its sides are PART of the field.
  round.ladies = (await make(6, "Four-Ball")).id;

  for (const [i, who] of Object.keys(FIELD).entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: FIELD[who].index,
        teeId: FIELD[who].tee ? tee[FIELD[who].tee!] : null,
      },
    });
    player[who] = p.id;
  }

  // Two mixed sides for the four-ball.
  for (const [i, pair] of [
    ["ann", "col"],
    ["bea", "dev"],
  ].entries()) {
    const side = await prisma.team.create({ data: { eventId, stageId: round.fourball, name: `${TAG} side ${i + 1}`, seed: i + 1 } });
    await prisma.teamMember.createMany({
      data: pair.map((who, position) => ({ teamId: side.id, playerId: player[who], position })),
    });
  }

  const ladies = await prisma.team.create({ data: { eventId, stageId: round.ladies, name: `${TAG} ladies`, seed: 1 } });
  await prisma.teamMember.createMany({
    data: ["ann", "bea"].map((who, position) => ({ teamId: ladies.id, playerId: player[who], position })),
  });

  /**
   * SOMEBODY WHO PLAYED AND THEN WITHDREW, off the gold tees — a LOWER par than
   * anybody still in the field. The board prices her card (it reads WD over the
   * figures she returned), so she is in the board's map and in nobody else's.
   * She is not in the field: her tees must not make the lowest par 70 on the
   * board and 71 everywhere else.
   */
  const eve = await prisma.player.create({
    data: {
      eventId,
      name: `${TAG} eve`,
      email: `${TAG}.eve@example.invalid`.toLowerCase(),
      seed: 9,
      status: "withdrawn",
      handicap: 20,
      teeId: tee.gold,
    },
  });
  player.eve = eve.id;
  await prisma.scorecard.create({
    data: { eventId, stageId: round.medal, playerId: eve.id, strokes: JSON.stringify(new Array(18).fill(5)) },
  });

  // A net skins pot on the medal with ONLY the two ladies in it.
  const pot = await prisma.skinsPot.create({
    data: { eventId, stageId: round.medal, net: true, scope: "full", groupKey: "", buyInCents: 1000 },
  });
  await prisma.skinsEntry.createMany({
    data: [player.ann, player.bea].map((playerId) => ({ potId: pot.id, playerId, confirmed: true })),
  });
  // Identical gross cards, so every net difference is a handicap stroke.
  await prisma.scorecard.createMany({
    data: [player.ann, player.bea].map((playerId) => ({
      eventId,
      stageId: round.medal,
      playerId,
      strokes: JSON.stringify(new Array(18).fill(4)),
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

describe("the fixture can tell the Rule from its absence", () => {
  it("the ladies are owed one stroke each and the men none", () => {
    for (const who of ["ann", "bea"]) expect(byTheRules(who, 95)).toBe(allowanceOf(who, 95) + 1);
    for (const who of ["col", "dev"]) expect(byTheRules(who, 95)).toBe(allowanceOf(who, 95));
    // And the figures are not all one number, so a reader returning a constant fails.
    expect(new Set(Object.keys(FIELD).map((who) => byTheRules(who, 95))).size).toBe(4);
  });
});

describe("a net medal off two pars", () => {
  it("the board gives the players on the higher par their stroke", async () => {
    const state = await loadEventState(eventId);
    expect(state).not.toBeNull();
    for (const who of Object.keys(FIELD)) {
      expect(state!.strokeHandicapFor(player[who], round.medal), who).toBe(byTheRules(who, 95));
    }
  });

  it("the round's own list says the same figure, and says how much of it is for the pars", async () => {
    const rows = await roundHandicapsFor(eventId, round.medal);
    for (const who of Object.keys(FIELD)) {
      const row = rows.find((r) => r.playerId === player[who])!;
      expect(row.playing, who).toBe(byTheRules(who, 95));
      expect(row.parStrokes, who).toBe(ratingOf(who).par - LOWEST_PAR);
    }
  });

  it("a pot of the two ladies alone is won on the board's strokes, not on its own", async () => {
    const view = await skinsPotFor(eventId, round.medal, true, "full", "");
    expect(view, "no pot view came back").not.toBeNull();
    expect(view!.entrantIds.sort()).toEqual([player.ann, player.bea].sort());
    /**
     * Identical gross cards, stroke index 1 to 18 in order, so a hole is won by
     * whoever receives more strokes on it. By the Rules Ann plays off
     * `byTheRules("ann", 95)` and Bea off `byTheRules("bea", 95)`.
     */
    const ann = byTheRules("ann", 95);
    const bea = byTheRules("bea", 95);
    expect([ann, bea]).toEqual([21, 12]);
    const shots = (playing: number, si: number) => Math.floor(playing / 18) + (si <= playing % 18 ? 1 : 0);
    const annsByRule = SI.filter((si) => shots(ann, si) > shots(bea, si));
    const annsHoles = view!.holes.filter((h) => h.playerId === player.ann).map((h) => h.hole).sort((a, b) => a - b);
    expect(annsHoles).toEqual(annsByRule);
    // THE TWO HOLES THAT MOVE. Without the strokes for the pars Ann is on 20
    // and Bea on 11: the 3rd is halved and the 12th is Ann's.
    expect(annsHoles, "the 3rd is Ann's only with her stroke for the pars").toContain(3);
    expect(annsHoles, "the 12th is halved once Bea has hers").not.toContain(12);
    expect(view!.holes.filter((h) => h.playerId === player.bea)).toEqual([]);
  });

  it("and the public skins board names the same holes as the money", async () => {
    const view = await skinsPotFor(eventId, round.medal, true, "full", "");
    const board = await skinsBoard(eventId, round.medal, 18, true, SI);
    const anns = (holes: Array<{ hole: number; playerId: string | null }>) =>
      holes.filter((h) => h.playerId === player.ann).map((h) => h.hole).sort((a, b) => a - b);
    expect(anns(board.outcome.holes).length, "the board names no winner, so this asserts nothing").toBeGreaterThan(0);
    expect(anns(board.outcome.holes)).toEqual(anns(view!.holes));
  });
});

describe("somebody who has left the field", () => {
  it("is priced for the card she returned, and her tees decide nobody else's strokes", async () => {
    const state = await loadEventState(eventId);
    // She is on the board's books: 20.0 off the gold tees at 95%.
    const gold = (20 * 10 * GOLD.slopeRating + (Math.round(GOLD.courseRating * 10) - GOLD.par * 10) * 113) * 95;
    expect(state!.strokeHandicapFor(player.eve, round.medal)).toBe(Math.floor((2 * gold + 113_000) / (2 * 113_000)));
    // And the lowest par the FIELD is playing is still 71: one stroke for the ladies, not two.
    expect(state!.strokeHandicapFor(player.ann, round.medal)).toBe(byTheRules("ann", 95));
    expect(state!.strokeHandicapFor(player.col, round.medal)).toBe(byTheRules("col", 95));
  });
});

describe("the rounds the Rule leaves out", () => {
  it("Stableford gives none: each player is already measured against the par of their own tees", async () => {
    const state = await loadEventState(eventId);
    const rows = await roundHandicapsFor(eventId, round.stableford);
    for (const who of Object.keys(FIELD)) {
      expect(state!.strokeHandicapFor(player[who], round.stableford), who).toBe(allowanceOf(who, 95));
      expect(rows.find((r) => r.playerId === player[who])!.parStrokes, who).toBe(0);
    }
  });

  it("and so does a stroke round SET to points", async () => {
    const state = await loadEventState(eventId);
    const rows = await roundHandicapsFor(eventId, round.points);
    for (const who of ["ann", "bea"]) {
      expect(state!.strokeHandicapFor(player[who], round.points), who).toBe(allowanceOf(who, 95));
      expect(rows.find((r) => r.playerId === player[who])!.parStrokes, who).toBe(0);
    }
  });

  it("nine holes gives none, and says nothing it cannot know", async () => {
    const rows = await roundHandicapsFor(eventId, round.nine);
    for (const who of Object.keys(FIELD)) expect(rows.find((r) => r.playerId === player[who])!.parStrokes, who).toBe(0);
  });
});

describe("a four-ball, where each player plays their own ball", () => {
  it("each player's own ball plays off the allowance and then their stroke for the pars", async () => {
    const sides = await teamsForStage(eventId, round.fourball, "Four-Ball", 0, 18);
    expect(sides, "the sides are missing, so this asserts nothing").toHaveLength(2);
    const members = sides.flatMap((s) => s.members);
    for (const who of Object.keys(FIELD)) {
      const m = members.find((x) => x.playerId === player[who])!;
      // 85%: a four-ball at stroke play (Appendix C).
      expect(m.playing, who).toBe(byTheRules(who, 85));
      expect(m.parStrokes, who).toBe(ratingOf(who).par - LOWEST_PAR);
    }
  });

  it("a round whose only side is the two ladies still measures from the field's lowest par", async () => {
    const sides = await teamsForStage(eventId, round.ladies, "Four-Ball", 0, 18);
    expect(sides).toHaveLength(1);
    for (const who of ["ann", "bea"]) {
      const m = sides[0].members.find((x) => x.playerId === player[who])!;
      expect(m.parStrokes, who).toBe(1);
      expect(m.playing, who).toBe(byTheRules(who, 85));
    }
  });

  it("and the board prices the same ball the same way", async () => {
    const state = await loadEventState(eventId);
    for (const who of Object.keys(FIELD)) {
      expect(state!.strokeHandicapFor(player[who], round.fourball), who).toBe(byTheRules(who, 85));
    }
  });
});

describe("a round that has been played keeps what it was played off", () => {
  it("the freeze writes each player's strokes for the pars beside their handicap", async () => {
    expect(await freezeRoundHandicaps(eventId, round.medal)).toBe(4);
    const rows = await prisma.roundHandicap.findMany({ where: { stageId: round.medal } });
    const of = (who: string) => rows.find((r) => r.playerId === player[who])!;
    expect(["ann", "bea", "col", "dev"].map((who) => of(who).frozenParStrokes)).toEqual([1, 1, 0, 0]);
    // Freezing changes nothing about the round it freezes.
    const state = await loadEventState(eventId);
    for (const who of Object.keys(FIELD)) {
      expect(state!.strokeHandicapFor(player[who], round.medal), who).toBe(byTheRules(who, 95));
    }
  });

  it("moving a player to other tees afterwards re-scores the next round, not that one", async () => {
    await prisma.player.update({ where: { id: player.ann }, data: { teeId: tee.white } });
    const state = await loadEventState(eventId);
    // The played medal: still the red tees' handicap and the stroke that went with them.
    expect(state!.strokeHandicapFor(player.ann, round.medal)).toBe(byTheRules("ann", 95));
    // The round still to play: the whites, and no stroke.
    expect(state!.strokeHandicapFor(player.ann, round.second)).toBe(allowanceOf("ann", 95, WHITE));
    // Bea is still on the higher par, and still has hers in both.
    expect(state!.strokeHandicapFor(player.bea, round.second)).toBe(byTheRules("bea", 95));
    const rows = await roundHandicapsFor(eventId, round.medal);
    expect(rows.find((r) => r.playerId === player.ann)!.parStrokes).toBe(1);
  });

  it("a round frozen before the app gave these strokes keeps the nets it was given", async () => {
    await prisma.roundHandicap.updateMany({ where: { stageId: round.medal }, data: { frozenParStrokes: null } });
    const state = await loadEventState(eventId);
    expect(state!.strokeHandicapFor(player.bea, round.medal)).toBe(allowanceOf("bea", 95));
    const rows = await roundHandicapsFor(eventId, round.medal);
    expect(rows.find((r) => r.playerId === player.bea)!.parStrokes).toBe(0);
    // CONTROL: the round beside it, not frozen, still gives her the stroke.
    expect(state!.strokeHandicapFor(player.bea, round.second)).toBe(byTheRules("bea", 95));
  });
});
