import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { loadEventState } from "@/lib/services/tournament";

/**
 * What the stroke-play board is actually adding up.
 *
 * The 2026-08-12 audit's stroke-play block: `loadEventState` queried
 * `scorecard.findMany({ where: { eventId } })` with no round filter and took
 * the unit from `activeStage`. One block, four wrong answers — every round
 * summed into one column labelled with the last round's unit, a hand-scored
 * round ranked the moment it shared an event with a scored one, a gross round
 * ranked by net, and `Stage.courseId` ignored entirely.
 *
 * Driven through the real loader against real rows, because the defect is in
 * which rows it asks for.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-STROKE-BOARD";

let orgId = "";
const player: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const newEvent = (name: string, over: Record<string, unknown> = {}) => ({
  organizationId: orgId,
  name: `${TAG} ${name}`,
  dates: "",
  course: "Home",
  city: "",
  address: "",
  regDeadline: "",
  shareToken: `${TAG}-${name}-${Date.now()}`,
  format: "stroke",
  // Par 72, stroke index 1..18 — the event-level card, and the only one the
  // board used to know about.
  customPars: JSON.stringify(new Array(18).fill(4)),
  customYards: JSON.stringify(new Array(18).fill(400)),
  customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
  ...over,
});

/** A round. `format`/`scoringBasis` are what the board reads to decide units. */
const newStage = (
  eventId: string,
  position: number,
  over: Record<string, unknown> = {},
) => ({
  eventId,
  position,
  type: "Stroke Play Round",
  format: "Stroke Play",
  scoringBasis: "net",
  holes: 18,
  ...over,
});

async function addCards(eventId: string, stageId: string, strokes: Record<string, number>) {
  for (const [key, s] of Object.entries(strokes)) {
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId,
        playerId: player[key],
        strokes: JSON.stringify(new Array(18).fill(s)),
      },
    });
  }
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** A fresh event with two players, so each case starts clean. */
async function twoPlayerEvent(name: string, over: Record<string, unknown> = {}) {
  const event = await prisma.event.create({ data: newEvent(name, over) });
  const [a, b] = await Promise.all([
    prisma.player.create({
      data: { eventId: event.id, name: `${TAG} Ainsley`, seed: 1, status: "confirmed", handicap: 0 },
    }),
    prisma.player.create({
      data: { eventId: event.id, name: `${TAG} Brody`, seed: 2, status: "confirmed", handicap: 18 },
    }),
  ]);
  player.ainsley = a.id;
  player.brody = b.id;
  return event;
}

describe("a hand-scored round is never ranked", () => {
  it("leaves its cards out of the board entirely", async () => {
    // isManualFormat is the only thing between a hand-scored format and a
    // scoring engine, and this path forgot to ask. A club that runs its
    // Sunday round as "Other (scored by hand)" and enters cards for reference
    // had those cards silently ranked into the medal alongside a real round.
    const event = await twoPlayerEvent("manual mix");
    const [scored, manual] = await Promise.all([
      prisma.stage.create({ data: newStage(event.id, 0) }),
      prisma.stage.create({ data: newStage(event.id, 1, { format: "Other (scored by hand)" }) }),
    ]);

    await addCards(event.id, scored.id, { ainsley: 4, brody: 5 });
    await addCards(event.id, manual.id, { ainsley: 10, brody: 3 });

    const state = await loadEventState(event.id);
    expect(state).not.toBeNull();
    if (!state) return;

    const ainsley = state.strokeStandings.find((s) => s.player.id === player.ainsley)!;
    // 18 x 4 from the scored round only. The hand-scored 180 is not in it.
    expect(ainsley.gross).toBe(72);
    expect(ainsley.thru).toBe(18);
    expect(state.strokeRounds.map((s) => s.id)).toEqual([scored.id]);
  });
});

describe("rounds that measure different things are not added together", () => {
  it("keeps a Stableford round out of a strokes board", async () => {
    // Stableford measures points and a medal measures strokes. Summed, the
    // column is neither, and it used to be labelled with whichever round was
    // active when you looked.
    const event = await twoPlayerEvent("mixed units");
    const [medal, stableford] = await Promise.all([
      prisma.stage.create({ data: newStage(event.id, 0) }),
      prisma.stage.create({ data: newStage(event.id, 1, { scoringBasis: "stableford" }) }),
    ]);

    await addCards(event.id, medal.id, { ainsley: 4 });
    await addCards(event.id, stableford.id, { ainsley: 5 });

    const state = await loadEventState(event.id);
    if (!state) throw new Error("no state");

    // The active round is the last one — Stableford — so that is the unit, and
    // the medal round does not join it.
    expect(state.strokeUnit).toBe("Stableford points");
    expect(state.strokeRounds.map((s) => s.id)).toEqual([stableford.id]);
    expect(state.strokeStandings.find((s) => s.player.id === player.ainsley)!.gross).toBe(90);
  });

  it("adds two rounds that DO measure the same thing", async () => {
    // The case the summing was right for, which is why it was written: a medal
    // over two days is one total.
    const event = await twoPlayerEvent("two round medal");
    const [r1, r2] = await Promise.all([
      prisma.stage.create({ data: newStage(event.id, 0) }),
      prisma.stage.create({ data: newStage(event.id, 1) }),
    ]);

    await addCards(event.id, r1.id, { ainsley: 4 });
    await addCards(event.id, r2.id, { ainsley: 5 });

    const state = await loadEventState(event.id);
    if (!state) throw new Error("no state");
    expect(state.strokeRounds).toHaveLength(2);
    expect(state.strokeStandings.find((s) => s.player.id === player.ainsley)!.gross).toBe(72 + 90);
  });
});

describe("a gross round is ranked by gross", () => {
  it("does not hand the scratch competition to the highest handicap", async () => {
    // The one that changes who wins. Ainsley plays off scratch and shoots 72;
    // Brody is an 18-handicap and shoots 90. Gross, Ainsley wins by eighteen.
    // Ranked by net they are level and Brody takes it on the gross tiebreak
    // — which is the opposite result, in a round the club ran as scratch.
    const event = await twoPlayerEvent("scratch medal");
    const stage = await prisma.stage.create({
      data: newStage(event.id, 0, { scoringBasis: "gross" }),
    });
    await addCards(event.id, stage.id, { ainsley: 4, brody: 5 });

    const state = await loadEventState(event.id);
    if (!state) throw new Error("no state");

    expect(state.strokeStandings[0].player.id, "the lowest gross wins a gross round").toBe(
      player.ainsley,
    );
    expect(state.strokeStandings[0].gross).toBe(72);
    expect(state.strokeStandings[1].gross).toBe(90);
  });

  it("still ranks a net round by net", async () => {
    // The same two cards, the same two players, one setting different — so a
    // wrong answer above cannot be a broken board.
    const event = await twoPlayerEvent("net medal");
    const stage = await prisma.stage.create({
      data: newStage(event.id, 0, { scoringBasis: "net" }),
    });
    await addCards(event.id, stage.id, { ainsley: 4, brody: 5 });

    const state = await loadEventState(event.id);
    if (!state) throw new Error("no state");

    const ainsley = state.strokeStandings.find((s) => s.player.id === player.ainsley)!;
    const brody = state.strokeStandings.find((s) => s.player.id === player.brody)!;
    expect(ainsley.net).toBe(72);
    // 90 less an 18 handicap at the round's 95% allowance.
    expect(brody.net).toBeLessThan(brody.gross);
    expect(brody.net).toBeLessThanOrEqual(73);
  });
});

describe("a round is scored against the course it was played on", () => {
  it("uses Stage.courseId rather than the event's card", async () => {
    // courseForRound had ZERO production callers, so a tournament that moves
    // to a second venue scored that round against the first course's par and
    // stroke index.
    const event = await twoPlayerEvent("two venues");
    const away = await prisma.course.create({
      data: {
        organizationId: orgId,
        name: `${TAG} away links`,
        city: "",
        // Par 70 — two shots easier to be level on than the event's par 72.
        pars: JSON.stringify([...new Array(16).fill(4), 3, 3]),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: away.id } });

    const stage = await prisma.stage.create({
      data: newStage(event.id, 0, { courseId: away.id }),
    });
    await addCards(event.id, stage.id, { ainsley: 4 });

    const state = await loadEventState(event.id);
    if (!state) throw new Error("no state");

    const ainsley = state.strokeStandings.find((s) => s.player.id === player.ainsley)!;
    expect(ainsley.gross).toBe(72);
    // Against the away card (par 70) this is two over. Against the event's
    // par 72 it would read level — the number the board used to print.
    expect(ainsley.toPar).toBe(2);
  });
});

describe("the smallest field the app can represent", () => {
  it("ranks a one-player round without falling over", async () => {
    // Field sizes start at ONE: a single-entry medal is where the off-by-ones
    // live, and the suite went no lower than eight for a year.
    const event = await prisma.event.create({ data: newEvent("solo") });
    const solo = await prisma.player.create({
      data: { eventId: event.id, name: `${TAG} Solo`, seed: 1, status: "confirmed", handicap: 12 },
    });
    const stage = await prisma.stage.create({ data: newStage(event.id, 0) });
    await prisma.scorecard.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        playerId: solo.id,
        strokes: JSON.stringify(new Array(18).fill(5)),
      },
    });

    const state = await loadEventState(event.id);
    if (!state) throw new Error("no state");
    expect(state.strokeStandings).toHaveLength(1);
    expect(state.strokeStandings[0].rank).toBe(1);
    expect(state.strokeStandings[0].gross).toBe(90);
    expect(Number.isNaN(state.strokeStandings[0].net)).toBe(false);
  });

  it("survives an event with no rounds and no cards at all", async () => {
    const event = await prisma.event.create({ data: newEvent("empty") });
    const state = await loadEventState(event.id);
    if (!state) throw new Error("no state");
    expect(state.strokeStandings).toEqual([]);
    expect(state.strokeRounds).toEqual([]);
    expect(state.strokeUnit).toBe("strokes");
  });
});
