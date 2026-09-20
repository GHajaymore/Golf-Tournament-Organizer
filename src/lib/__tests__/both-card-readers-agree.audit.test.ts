import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { loadEventState, type EventState } from "@/lib/services/tournament";
import { roundCardFor } from "@/lib/services/round-card";
import { holesPlayed } from "@/lib/domain/handicap";

/**
 * THE CONSOLE AND THE PLAYER RESOLVE A ROUND'S CARD SEPARATELY. THEY MUST
 * STILL GET THE SAME CARD.
 *
 * Two readers of one question, which is the shape this repository keeps
 * paying for. `state.strokeCourseFor` is built inside `loadEventState` and
 * feeds the leaderboard, Reports, the week sheet and the public board;
 * `roundCardFor` queries the venue itself and feeds `/me/card` and Today.
 * Neither is wrong today — this file exists so that stays true, because
 * nothing else compares them and the last two times they drifted it was a
 * club noticing, not a test:
 *
 *   - the entry screen sliced the event's card while `recomputeTeamMatch`
 *     narrowed it, so the running net and the stored result were one to three
 *     strokes apart on the screen the scorer signed;
 *   - five boards scored an away round against the tournament's course while
 *     the player's screens used the round's own, and the two differed by
 *     exactly four on every row (#521).
 *
 * KEPT SEPARATE ON PURPOSE. Consolidating them is the fix this codebase
 * normally recommends and it is the wrong one here: one is sync over an
 * already-loaded state and the other is an async query, and CLAUDE.md records
 * that consolidation also takes the comparison away. Pinning the agreement
 * keeps both readers and makes the diff automatic.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-both-readers";

/** Eighteen par 4s, SI 1..18 — the tournament's own card. */
const HOME_PARS = new Array(18).fill(4);
const HOME_SI = Array.from({ length: 18 }, (_, i) => i + 1);
/** Nine par 3s. Deliberately unlike the home card in BOTH par and length. */
const AWAY_PARS = new Array(9).fill(3);

let eventId = "";
let state: EventState | null = null;
const stageIds: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function round(key: string, position: number, holes: number, nine: string, courseId?: string) {
  const s = await prisma.stage.create({
    data: {
      eventId,
      position,
      description: `${key}`,
      type: "Stroke Play Round",
      format: "Stroke Play",
      scoringBasis: "gross",
      holes,
      nine,
      ...(courseId ? { courseId } : {}),
    },
    select: { id: true },
  });
  stageIds[key] = s.id;
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const makeCourse = (name: string, pars: number[]) =>
    prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${TAG} ${name}`,
        city: `${TAG} town`,
        pars: JSON.stringify(pars),
        yards: JSON.stringify(pars.map(() => 300)),
        strokeIndex: JSON.stringify(pars.map((_, i) => i + 1)),
      },
      select: { id: true },
    });

  const away = await makeCourse("away wee nine", AWAY_PARS);
  // Belongs to the same CLUB and to no event. A stage may name its id; no
  // reader may resolve it. Both readers scope to this event's courses, and
  // this is the case that proves they scope the same way.
  const foreign = await makeCourse("another club entirely", new Array(18).fill(5));

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} tournament`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "2026-09-17",
      course: `${TAG} home`,
      city: `${TAG} town`,
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
      customPars: JSON.stringify(HOME_PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(HOME_SI),
    },
    select: { id: true },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: away.id } });

  await round("home eighteen", 0, 18, "full");
  await round("away nine", 1, 9, "full", away.id);
  await round("home back nine", 2, 9, "back");
  await round("home front nine", 3, 9, "front");
  await round("names a course it may not have", 4, 18, "full", foreign.id);

  state = await loadEventState(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** Both readers, for one round, as their own callers ask them. */
async function bothFor(key: string) {
  const stage = state!.stages.find((s) => s.id === stageIds[key])!;
  const console_ = state!.strokeCourseFor(stage.id);
  const player = await roundCardFor(state!, stage, holesPlayed(stage.holes));
  return {
    console: { pars: console_.pars, si: console_.holeDifficulty },
    player: { pars: player.card.pars, si: player.card.strokeIndex },
  };
}

const KEYS = [
  "home eighteen",
  "away nine",
  "home back nine",
  "home front nine",
  "names a course it may not have",
];

describe("the console's card and the player's card", () => {
  it("agree about par and stroke index on every round", async () => {
    for (const key of KEYS) {
      const { console: c, player: p } = await bothFor(key);
      expect(p.pars, `${key}: par`).toEqual(c.pars);
      expect(p.si, `${key}: stroke index`).toEqual(c.si);
    }
  });

  it("and the rounds differ from each other, so agreeing is not free", async () => {
    /**
     * The control. "Both readers returned the same thing" is satisfied
     * perfectly by two readers that always return the event's whole card, and
     * that is exactly the defect #521 fixed — so the fixture has to contain
     * rounds whose correct answers are different, and say which.
     */
    const home = await bothFor("home eighteen");
    const away = await bothFor("away nine");
    const back = await bothFor("home back nine");
    const front = await bothFor("home front nine");

    expect(home.console.pars).toHaveLength(18);
    expect(away.console.pars, "the away nine is nine par 3s").toEqual(AWAY_PARS);
    expect(
      away.console.pars.reduce((a, b) => a + b, 0),
      "par 27 away against par 36 at home — a reader using the event's card reads 36",
    ).toBe(27);

    // A back nine and a front nine of the same card are the same PARS here by
    // construction; what separates them is the stroke index, which is the
    // half that allocates shots.
    expect(back.console.si, "a back nine re-ranked to 1..9").toEqual(
      [10, 11, 12, 13, 14, 15, 16, 17, 18].map((_, i) => i + 1),
    );
    expect(front.console.si).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("both refuse a course id that belongs to no event of this tournament", async () => {
    /**
     * A `courseId` is an id, and an id from somewhere else must not resolve.
     * Both readers fall back to the tournament's own card — and the foreign
     * course is eighteen par 5s, so resolving it would be loud rather than
     * subtle.
     */
    const { console: c, player: p } = await bothFor("names a course it may not have");
    expect(c.pars).toEqual(HOME_PARS);
    expect(p.pars).toEqual(HOME_PARS);
    expect(c.pars, "the foreign card leaked in").not.toContain(5);
  });
});
