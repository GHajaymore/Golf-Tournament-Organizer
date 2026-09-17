import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/** One browser's cookie jar, so a console session round-trips for real. */
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => { const value = jar.get(name); return value === undefined ? undefined : { name, value }; },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { setStageHoles, setStageScoringBasis } from "@/app/actions/tournament";
import { setStageAllowance, setStageAllowanceWeights, setStageCountBest } from "@/app/actions/teams";
import { enteredCardCount } from "../services/round-cards";

/**
 * SETTINGS THAT RE-SCORE A ROUND MUST ASK BEFORE THEY DO IT.
 *
 * `enteredCardCount`'s own header states the rule — "asked before anything
 * that RE-SCORES a round rather than edits it" — and names why the class is
 * quiet: nothing is deleted, so there is no gap to notice afterwards. Every
 * stroke stays where it is and the results computed from them change
 * underneath.
 *
 * `setStageFormat` and `setStageCourse` asked. The two controls sitting beside
 * them on the same screen wrote straight through:
 *
 *   setStageHoles          eighteen to nine re-ranks the stroke index onto the
 *                          nine actually played, so handicap shots land on
 *                          different holes, and every to-par, net and
 *                          countback is measured against a new denominator
 *   setStageScoringBasis   gross, net and Stableford rank the same numbers
 *                          into three different orders — and since the
 *                          countback was corrected to run on the basis and
 *                          nothing else, this decides every tie as well
 *
 * Asserted BOTH halves: the count the guard reads, and the actions themselves
 * called through a real console session — because a correct count proves
 * nothing about whether the action asks it, which is the gap that has been
 * wrong repeatedly this week. The action cells check the DATABASE afterwards
 * rather than only the return value: a refusal that still wrote would satisfy
 * every assertion about what came back.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-RESCORE";
let orgId = "";

async function seed() {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${Date.now()}`,
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      status: "draft", shape: "series", format: "stroke", formationRule: "balanced",
      shareToken: `audit-rescore-${Date.now()}-${Math.random()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  const eventId = event.id;
  const stage = await prisma.stage.create({
    data: {
      eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play",
      holes: 18, scoringBasis: "gross", handicapAllowance: 100,
    },
  });
  const flight = (await prisma.group.create({ data: { eventId, name: "A", position: 0 } })).id;
  const player = await prisma.player.create({
    data: {
      eventId, name: `${TAG} ANN`,
      email: `${TAG.toLowerCase()}-${Date.now()}-${Math.random()}@example.invalid`,
      handicap: 12, seed: 1, status: "confirmed", groupId: flight,
    },
  });
  return { eventId, stage, player, flight };
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  orgId = (await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } })).id;
});

afterAll(async () => {
  try {
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
    // The organizer logins `asOrganizer` makes belong to no organization, so
    // the cascade above never reached them.
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("what the guard counts", () => {
  it("is zero on a round nobody has played — the control", async () => {
    /**
     * THE CONTROL, and it is the important one. A guard that always fires
     * would refuse to let an organizer set up a round at all, which is worse
     * than the defect: the one moment changing a round's holes is completely
     * safe is before anybody has teed off.
     */
    const { eventId, stage } = await seed();
    expect(await enteredCardCount(eventId, stage.id)).toBe(0);
  });

  it("is zero for a placeholder card with no strokes on it", async () => {
    // A row exists the moment a card is opened. It is not a score.
    const { eventId, stage, player } = await seed();
    await prisma.scorecard.create({
      data: { eventId, stageId: stage.id, playerId: player.id, strokes: JSON.stringify(new Array(18).fill(null)) },
    });
    expect(await enteredCardCount(eventId, stage.id), "an opened card is not a returned one").toBe(0);
  });

  it("counts a card with one hole on it", async () => {
    // One hole is enough: that hole's score is about to be re-read against a
    // different par, a different index, or a different basis.
    const { eventId, stage, player } = await seed();
    await prisma.scorecard.create({
      data: {
        eventId, stageId: stage.id, playerId: player.id,
        strokes: JSON.stringify([4, ...new Array(17).fill(null)]),
      },
    });
    expect(await enteredCardCount(eventId, stage.id)).toBe(1);
  });

  it("counts a match-play result, which stores no strokes at all", async () => {
    /**
     * The case that made the guard wrong once before, per its own comment: a
     * match round keeps its result on `Match.holes`, so counting stroke blobs
     * reported ZERO for a round with forty-eight results in it.
     */
    const { eventId, stage, player, flight } = await seed();
    const other = await prisma.player.create({
      data: {
        eventId, name: `${TAG} BOB`,
        email: `${TAG.toLowerCase()}-b-${Date.now()}-${Math.random()}@example.invalid`,
        handicap: 8, seed: 2, status: "confirmed", groupId: flight,
      },
    });
    await prisma.match.create({
      data: {
        eventId, stageId: stage.id, groupId: flight, round: 1,
        playerAId: player.id, playerBId: other.id,
        holes: JSON.stringify(["A", ...new Array(17).fill(null)]),
      },
    });
    expect(await enteredCardCount(eventId, stage.id)).toBe(1);
  });

  it("does not count another round's cards", async () => {
    /**
     * Which is what makes the guard usable at all: an organizer setting up
     * round two must not be refused because round one has been played.
     */
    const { eventId, stage, player } = await seed();
    const second = await prisma.stage.create({
      data: {
        eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play",
        holes: 18, scoringBasis: "gross", handicapAllowance: 100,
      },
    });
    await prisma.scorecard.create({
      data: { eventId, stageId: stage.id, playerId: player.id, strokes: JSON.stringify(new Array(18).fill(4)) },
    });
    expect(await enteredCardCount(eventId, stage.id)).toBe(1);
    expect(await enteredCardCount(eventId, second.id), "round two is untouched").toBe(0);
  });
});

/** A staff session on this event, so the real action runs its real guards. */
async function asOrganizer(eventId: string) {
  const email = `${TAG.toLowerCase()}-org-${Date.now()}-${Math.random()}@example.invalid`;
  const user = await prisma.user.create({ data: { email, name: `${TAG} Org`, password: "x" } });
  await prisma.account.create({ data: { eventId, email, name: `${TAG} Org`, role: "admin" } });
  jar.clear();
  await createSession(user.id);
  // createSession clears the active-event cookie, so this comes second.
  await setActiveEvent(eventId);
}

describe("and the actions actually ask it", () => {

  const holesOf = async (id: string) =>
    (await prisma.stage.findUnique({ where: { id }, select: { holes: true } }))!.holes;
  const basisOf = async (id: string) =>
    (await prisma.stage.findUnique({ where: { id }, select: { scoringBasis: true } }))!.scoringBasis;

  async function playedRound() {
    const s = await seed();
    await prisma.scorecard.create({
      data: {
        eventId: s.eventId, stageId: s.stage.id, playerId: s.player.id,
        strokes: JSON.stringify(new Array(18).fill(4)),
      },
    });
    await asOrganizer(s.eventId);
    return s;
  }

  it("changes the holes freely on a round nobody has played", async () => {
    // THE CONTROL. Run first: if the guard fired on everything, every refusal
    // below would pass for the wrong reason and the screen would be unusable.
    const { eventId, stage } = await seed();
    await asOrganizer(eventId);
    const res = await setStageHoles(stage.id, 9);
    expect(res.ok).toBe(true);
    expect(await holesOf(stage.id)).toBe(9);
  });

  it("refuses to change the holes under a card, and does not write", async () => {
    const { stage } = await playedRound();
    const res = await setStageHoles(stage.id, 9);
    expect(res.needsConfirm).toBe(true);
    expect(res.cards).toBe(1);
    expect(await holesOf(stage.id), "it refused and wrote anyway").toBe(18);
  });

  it("goes ahead once the organizer says so", async () => {
    // The point is a question, not a veto. An organizer who set a round up
    // wrongly has to be able to fix it.
    const { stage } = await playedRound();
    expect(await setStageHoles(stage.id, 9, true)).toEqual({ ok: true });
    expect(await holesOf(stage.id)).toBe(9);
  });

  it("does not ask when the holes are re-saved unchanged", async () => {
    // A confirmation on a no-op teaches an organizer to click through the one
    // that matters.
    const { stage } = await playedRound();
    const res = await setStageHoles(stage.id, 18);
    expect(res.ok).toBe(true);
    expect(res.needsConfirm).toBeUndefined();
  });

  it("refuses to change what the round is scored on under a card", async () => {
    const { stage } = await playedRound();
    const res = await setStageScoringBasis(stage.id, "net");
    expect(res.needsConfirm).toBe(true);
    expect(res.cards).toBe(1);
    expect(await basisOf(stage.id), "a scratch competition quietly became a net one").toBe("gross");
  });

  it("changes the basis on an unplayed round, and when forced on a played one", async () => {
    const fresh = await seed();
    await asOrganizer(fresh.eventId);
    expect((await setStageScoringBasis(fresh.stage.id, "net")).ok).toBe(true);
    expect(await basisOf(fresh.stage.id)).toBe("net");

    const { stage } = await playedRound();
    expect(await setStageScoringBasis(stage.id, "stableford", true)).toEqual({ ok: true });
    expect(await basisOf(stage.id)).toBe("stableford");
  });

  it("does not ask when the basis is re-saved unchanged", async () => {
    const { stage } = await playedRound();
    const res = await setStageScoringBasis(stage.id, "gross");
    expect(res.ok).toBe(true);
    expect(res.needsConfirm).toBeUndefined();
  });
});

describe("and a team round's pricing asks too", () => {
  /**
   * THE THREE SETTINGS A TEAM ROUND ADDS. The allowance, the split and how
   * many scores count all change what every side's card is worth without a
   * stroke moving — the same class as the three above, set from the same
   * screen, and until now written straight through.
   *
   * A four-ball for the allowance and the count, a greensomes for the split,
   * each with ONE side card on it, which is all `enteredCardCount` needs.
   */
  async function teamRound(format: "Four-Ball" | "Greensomes", played: boolean) {
    const { eventId, player } = await seed();
    const stage = await prisma.stage.create({
      data: { eventId, position: 1, type: "Round Robin", format, holes: 18, scoringBasis: "net" },
    });
    if (played) {
      const side = await prisma.team.create({
        data: { eventId, stageId: stage.id, name: `${TAG} side`, seed: 1 },
      });
      await prisma.teamScorecard.create({
        data: {
          eventId,
          stageId: stage.id,
          teamId: side.id,
          playerId: player.id,
          strokes: JSON.stringify([4, ...new Array(17).fill(null)]),
        },
      });
    }
    await asOrganizer(eventId);
    return stage.id;
  }

  const stageOf = async (id: string) =>
    (await prisma.stage.findUnique({
      where: { id },
      select: { handicapAllowance: true, countBest: true, allowanceWeights: true },
    }))!;

  it("changes all three freely on a team round nobody has played", async () => {
    // THE CONTROL: nothing below means anything if these refuse too.
    const fourBall = await teamRound("Four-Ball", false);
    expect(await setStageAllowance(fourBall, 75)).toEqual({ ok: true });
    expect(await setStageCountBest(fourBall, 2)).toEqual({ ok: true });
    expect(await stageOf(fourBall)).toMatchObject({ handicapAllowance: 75, countBest: 2 });

    const greensomes = await teamRound("Greensomes", false);
    expect(await setStageAllowanceWeights(greensomes, [50, 50])).toEqual({ ok: true });
    expect((await stageOf(greensomes)).allowanceWeights).toEqual([50, 50]);
  });

  it("refuses the allowance under a card, without writing, and goes ahead when told", async () => {
    const id = await teamRound("Four-Ball", true);
    expect(await setStageAllowance(id, 75)).toEqual({ ok: false, needsConfirm: true, cards: 1 });
    expect((await stageOf(id)).handicapAllowance, "refused and wrote anyway").toBe(0);
    expect(await setStageAllowance(id, 75, true)).toEqual({ ok: true });
    expect((await stageOf(id)).handicapAllowance).toBe(75);
  });

  it("does not ask when the allowance in force does not change", async () => {
    // Four-ball recommends 90%: typing 90 over the default is not a change,
    // and neither is "back to the recommendation" from an explicit 90.
    const id = await teamRound("Four-Ball", true);
    expect(await setStageAllowance(id, 90)).toEqual({ ok: true });
    expect(await setStageAllowance(id, 0)).toEqual({ ok: true });
  });

  it("refuses how many scores count under a card, and not a re-save", async () => {
    const id = await teamRound("Four-Ball", true);
    expect(await setStageCountBest(id, 2)).toEqual({ ok: false, needsConfirm: true, cards: 1 });
    expect((await stageOf(id)).countBest).toBe(0);
    // Best one is what a stored zero already means.
    expect(await setStageCountBest(id, 1)).toEqual({ ok: true });
    expect(await setStageCountBest(id, 2, true)).toEqual({ ok: true });
    expect((await stageOf(id)).countBest).toBe(2);
  });

  it("refuses the split under a card, and not a clear that changes nothing", async () => {
    const id = await teamRound("Greensomes", true);
    expect(await setStageAllowanceWeights(id, [50, 50])).toEqual({
      ok: false,
      needsConfirm: true,
      cards: 1,
    });
    expect((await stageOf(id)).allowanceWeights).toEqual([]);
    // Nothing stored, so clearing it is not a change.
    expect(await setStageAllowanceWeights(id, [])).toEqual({ ok: true });

    expect(await setStageAllowanceWeights(id, [50, 50], true)).toEqual({ ok: true });
    // …but clearing a stored split IS one.
    expect(await setStageAllowanceWeights(id, [])).toEqual({ ok: false, needsConfirm: true, cards: 1 });
    expect((await stageOf(id)).allowanceWeights).toEqual([50, 50]);
  });
});
