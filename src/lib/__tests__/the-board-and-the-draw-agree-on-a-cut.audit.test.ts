import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE BOARD LIGHTS WHO THE DRAW WOULD TAKE, IN EVERY SHAPE A ROUND ROBIN'S CUT
 * COMES IN (J31 review, 2026-11-07), on real rows. Each case compares the
 * board (`loadEventState`: `advancingIds`, `cutTiesUndecided`) with the draw
 * (`generateCutRound`, and `roundRobinCutOf` — the same table and rule).
 *
 *   A KNOCKOUT AFTER THE CUT   round robin → round robin with a cut → main and
 *                              plate (the guide's "club match-play championship
 *                              in groups"). The board lit the knockout's line
 *                              off Round 1's table and marked no tie, while
 *                              drawing Round 2 refused for a tie at its line.
 *   NOTHING TO CUT ON (1)      round robin → round robin with carry-forward,
 *                              drawn and unplayed → a cut. The board lit off the
 *                              carried points; the draw refused "no results".
 *   NOTHING TO CUT ON (2)      a match with only halves entered. The draw cut
 *                              on it (a whole-field tie, by play-off); the board
 *                              stayed dark and marked no tie.
 *   A SECOND CUT               round robin → round robin with a cut → a second
 *                              cut, on countback, with a cycle at the line: the
 *                              board and the draw rank the same contenders.
 *
 * Round 1's table in the first three, worked by hand (win 2; every match 1 up):
 *   Ann b Bea, Cat, Dot, Eve                       Ann 8
 *   Bea b Cat, Bea b Dot; Eve b Bea                Bea 4   ┐ level on points for
 *   Cat b Dot, Cat b Eve                           Cat 4   ┘ the second place
 *   Dot b Eve                                      Dot 2, Eve 2
 *
 *   npx vitest run --config vitest.audit.config.ts the-board-and-the-draw-agree-on-a-cut
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { loadEventState } from "@/lib/services/tournament";
import { generateCutRound, roundRobinCutOf } from "@/lib/services/regroup";

const prisma = new PrismaClient();
const TAG = "zz-board-draw-cut";
let orgId = "";

const oneUp = (w: "A" | "B") => JSON.stringify([w, ...new Array(17).fill("H")]);
const blank = JSON.stringify(new Array(18).fill(null));
const ROUND_ONE: [string, string, "A" | "B"][] = [
  ["ann", "bea", "A"], ["ann", "cat", "A"], ["ann", "dot", "A"], ["ann", "eve", "A"],
  ["bea", "cat", "A"], ["bea", "dot", "A"], ["bea", "eve", "B"],
  ["cat", "dot", "A"], ["cat", "eve", "A"],
  ["dot", "eve", "A"],
];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A tournament, its one flight and its field. */
async function tournament(name: string, who: string[], event: Record<string, unknown> = {}) {
  const eventId = (
    await prisma.event.create({
      data: {
        name: `${TAG} ${name}`,
        organizationId: orgId,
        status: "live",
        format: "match",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${name}-${Date.now()}`,
        ...event,
      },
    })
  ).id;
  const flight = (await prisma.group.create({ data: { eventId, name: "Flight A", position: 0 } })).id;
  const id: Record<string, string> = {};
  for (const [i, w] of who.entries()) {
    id[w] = (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${w}`, email: `${TAG}-${name.replace(/\W/g, "")}-${w}@example.invalid`, seed: i + 1, status: "confirmed", handicap: 2 + i, groupId: flight },
      })
    ).id;
  }
  return { eventId, flight, id };
}

const rr = (eventId: string, position: number, extra: Record<string, unknown> = {}) =>
  prisma.stage.create({ data: { eventId, type: "Round Robin", format: "Match Play", holes: 18, position, description: `Round ${position + 1}`, ...extra } });
const cutTo = (n: number, cutTies: string) => ({ cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: n, cutTies });

async function play(t: { eventId: string; flight: string; id: Record<string, string> }, stageId: string, results: [string, string, string][]) {
  for (const [a, b, holes] of results) {
    await prisma.match.create({ data: { eventId: t.eventId, stageId, groupId: t.flight, round: 1, playerAId: t.id[a], playerBId: t.id[b], holes } });
  }
}

const sorted = (ids: Iterable<string>) => [...ids].sort();
const ties = (list: { playerIds: string[]; places: number; by: string }[]) => list.map((x) => [sorted(x.playerIds), x.places, x.by]);

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the board and the draw agree on a round robin's cut", () => {
  it("a knockout after the cut: the board marks the tie at the cut, and the knockout's panels keep the knockout's line", async () => {
    const five = ["ann", "bea", "cat", "dot", "eve"];
    const t = await tournament("Groups then Knockout", five, { shape: "knockout", qualifyMode: "overall", qualifyOverall: 2, bracketMode: "plate" });
    const r1 = (await rr(t.eventId, 0)).id;
    const r2 = (await rr(t.eventId, 1, cutTo(2, "playoff"))).id;
    await prisma.stage.create({ data: { eventId: t.eventId, type: "Bracket Stage", format: "Match Play", holes: 18, position: 2, description: "Knockout" } });
    await play(t, r1, ROUND_ONE.map(([a, b, w]) => [a, b, oneUp(w)]));

    const drawn = await generateCutRound(t.eventId, r2);
    expect(drawn.ok, "the draw refuses for the tie at Round 2's line").toBe(false);
    const undecided = !drawn.ok && drawn.reason === "cut-tie" ? drawn.undecided : [];
    expect(ties(undecided)).toEqual([[sorted([t.id.bea, t.id.cat]), 1, "playoff"]]);

    const state = (await loadEventState(t.eventId))!;
    expect(state.activeStage?.id, "Round 1 is being played").toBe(r1);
    expect(sorted(state.advancingIds), "the board lights who the cut takes: Ann alone").toEqual([t.id.ann]);
    expect(ties(state.cutTiesUndecided), "and marks the tie the draw refused for").toEqual(ties(undecided));
    // The knockout's line is unchanged for the panels labelled by it.
    expect(state.qualifierIds.size, "the knockout's top 2, as before").toBe(2);
  });

  it("nothing to cut on (1): a round drawn and unplayed under carry-forward — the board lights nobody, the draw refuses", async () => {
    const five = ["ann", "bea", "cat", "dot", "eve"];
    const t = await tournament("Carried Points", five);
    const r1 = (await rr(t.eventId, 0)).id;
    const r2 = (await rr(t.eventId, 1, { carryForwardEnabled: true, carryForwardPct: 100 })).id;
    const r3 = (await rr(t.eventId, 2, cutTo(2, "playoff"))).id;
    await play(t, r1, ROUND_ONE.map(([a, b, w]) => [a, b, oneUp(w)]));
    await play(t, r2, ROUND_ONE.map(([a, b]) => [a, b, blank]));

    const drawn = await generateCutRound(t.eventId, r3);
    expect(drawn.ok === false && drawn.reason, "the draw: nothing entered in Round 2").toBe("no-results");
    expect(await roundRobinCutOf(t.eventId, r3), "nor does the tie card see a cut to make").toBeNull();

    const state = (await loadEventState(t.eventId))!;
    expect(state.activeStage?.id, "Round 2 is being played").toBe(r2);
    // CONTROL that the carried points are there to be misread.
    expect(new Set(state.overall.map((r) => r.stats.totalPoints)).size, "the carried table is not level").toBeGreaterThan(1);
    expect(sorted(state.advancingIds), "nobody lit off points carried in").toEqual([]);
    expect(state.cutTiesUndecided).toEqual([]);
  });

  it("nothing to cut on (2): a match with only halves entered IS something — the board marks the tie the draw refuses for", async () => {
    const four = ["ann", "bea", "cat", "dot"];
    const t = await tournament("Halves Only", four);
    const r1 = (await rr(t.eventId, 0)).id;
    const r2 = (await rr(t.eventId, 1, cutTo(2, "playoff"))).id;
    const halves = JSON.stringify(["H", "H", ...new Array(16).fill(null)]);
    await play(t, r1, [["ann", "bea", halves], ["cat", "dot", blank], ["ann", "cat", blank], ["bea", "dot", blank], ["ann", "dot", blank], ["bea", "cat", blank]]);

    const made = await roundRobinCutOf(t.eventId, r2);
    expect(made, "the draw has something to cut on").not.toBeNull();
    const drawn = await generateCutRound(t.eventId, r2);
    expect(drawn.ok === false && drawn.reason, "the draw refuses for a tie").toBe("cut-tie");

    const state = (await loadEventState(t.eventId))!;
    expect(sorted(state.advancingIds)).toEqual(sorted(made!.outcome.through));
    expect(ties(state.cutTiesUndecided), "the board marks the same tie").toEqual(ties(made!.outcome.undecided));
    expect(state.cutTiesUndecided.length, "and there is one to mark").toBeGreaterThan(0);
  });

  /**
   * Round 1: six, a clean top 4 (everybody beats everybody entered below them,
   * so the first four entered are 10, 8, 6, 4 points). Round 2 is the top 4,
   * drawn as the cut draws it; then Ann beats all three, and Bea, Cat and Dot
   * go round in a circle (Bea b Cat, Cat b Dot, Dot b Bea), each 1 up: three
   * level on 2 points for the second place, head-to-head deciding nothing
   * among them. `six` is the entry order.
   */
  async function twoCutsWithACycle(name: string, six: string[]) {
    const t = await tournament(name, six);
    const r1 = (await rr(t.eventId, 0)).id;
    const r2 = (await rr(t.eventId, 1, cutTo(4, "ties"))).id;
    const r3 = (await rr(t.eventId, 2, cutTo(2, "countback"))).id;
    const firstRound: [string, string, string][] = [];
    for (let a = 0; a < six.length; a += 1) for (let b = a + 1; b < six.length; b += 1) firstRound.push([six[a], six[b], oneUp("A")]);
    await play(t, r1, firstRound);
    expect(await generateCutRound(t.eventId, r2), "Round 2 is drawn by the cut").toEqual({ ok: true });
    const r2Matches = await prisma.match.findMany({ where: { stageId: r2 } });
    expect(sorted(new Set(r2Matches.flatMap((m) => [m.playerAId, m.playerBId]))), "the top 4").toEqual(sorted([t.id.ann, t.id.bea, t.id.cat, t.id.dot]));
    const winner: Record<string, string> = { "ann|bea": "ann", "ann|cat": "ann", "ann|dot": "ann", "bea|cat": "bea", "cat|dot": "cat", "bea|dot": "dot" };
    const nameOf = new Map(Object.entries(t.id).map(([w, pid]) => [pid, w]));
    for (const m of r2Matches) {
      const [a, b] = [nameOf.get(m.playerAId)!, nameOf.get(m.playerBId)!];
      const key = [a, b].sort().join("|");
      await prisma.match.update({ where: { id: m.id }, data: { holes: oneUp(winner[key] === a ? "A" : "B") } });
    }
    return { t, r2, r3 };
  }

  it("a second cut, on countback, with a cycle at the line: the board and the draw rank the same contenders", async () => {
    const { t, r2, r3 } = await twoCutsWithACycle("Two Cuts", ["ann", "bea", "cat", "dot", "eve", "fay"]);
    const made = (await roundRobinCutOf(t.eventId, r3))!;
    expect(made.feeder.id, "the second cut is taken out of Round 2").toBe(r2);
    const state = (await loadEventState(t.eventId))!;
    expect(state.activeStage?.id, "Round 2 is being played").toBe(r2);
    expect(sorted(state.advancingIds), "who is through").toEqual(sorted(made.outcome.through));
    expect(ties(state.cutTiesUndecided), "and who is tied, and how").toEqual(ties(made.outcome.undecided));
    expect(made.outcome.through.has(t.id.ann), "Ann is through").toBe(true);
  });

  /**
   * WHAT THE SECOND CUT SAYS (registered by the J31 review as deferred; FIXED
   * 2026-11-07, docs/deferred-register.md, "a head-to-head cycle is ranked by
   * entry order"). Worked by hand: Bea, Cat and Dot each won 1 hole and lost 2
   * in Round 2, and their meetings go round in a circle, so nothing they did
   * separates them — Committee Procedures 5A(6): the committee's countback
   * runs out, and the one place is decided by lot, which the committee
   * records. `rankPlayers` used to ask each NEIGHBOURING PAIR's own meeting
   * (Bea b Cat, Cat b Dot), number them 2, 3, 4, and send the earliest entry
   * through. Run in two entry orders: the tie is the same three whoever
   * entered first.
   */
  it("a head-to-head cycle at the line is a draw for the place, on the board and in the draw, whoever entered first", async () => {
    for (const [name, six] of [
      ["Cycle Bea First", ["ann", "bea", "cat", "dot", "eve", "fay"]],
      ["Cycle Dot First", ["ann", "dot", "cat", "bea", "eve", "fay"]],
    ] as const) {
      const { t, r3 } = await twoCutsWithACycle(name, [...six]);
      const three = sorted([t.id.bea, t.id.cat, t.id.dot]);

      const state = (await loadEventState(t.eventId))!;
      const r2Places = new Map(state.overall.map((r) => [r.player.id, r.rank]));
      expect([t.id.bea, t.id.cat, t.id.dot].map((id) => r2Places.get(id)), `${name}: the table shares 2nd`).toEqual([2, 2, 2]);
      expect(sorted(state.advancingIds), `${name}: the board lights Ann alone`).toEqual([t.id.ann]);
      expect(ties(state.cutTiesUndecided), `${name}: and marks a draw for the one place`).toEqual([[three, 1, "draw"]]);

      const drawn = await generateCutRound(t.eventId, r3);
      expect(drawn.ok, `${name}: the draw refuses until the committee records it`).toBe(false);
      const undecided = !drawn.ok && drawn.reason === "cut-tie" ? drawn.undecided : [];
      expect(ties(undecided), `${name}: for the same tie`).toEqual([[three, 1, "draw"]]);
    }
  });
});
