import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { roundHandicapsFor, freezeRoundHandicaps } from "../services/round-handicap";
import { playingHandicapFrom } from "../domain/handicap";

/**
 * A club championship scores each division off its own tees.
 *
 * From the 2026-08-27 exploratory audit. `courseHandicapMap` resolves the tee
 * with `teeIdFor(policy, p.teeId, p.flightTeeId, defaultTeeId)`, but
 * `flightTeeId` was OPTIONAL and the flight's tee lives on `Group.teeId` — so
 * not one of the eight call sites ever supplied it. Every one of them passed
 * `undefined`, and `teeIdFor("flight", …, undefined, defaultTeeId)` returns the
 * DEFAULT set.
 *
 * The printed card and the tee sheet were right, because `handicapsForRound`
 * reads the group directly. Everything that SCORES was wrong: the leaderboard,
 * the round-handicap screen, team side handicaps, net skins, net match play —
 * and the value frozen into `RoundHandicap.frozen`, which is written into
 * history permanently.
 *
 * The field is required now, so forgetting it is a compile error. This proves
 * the value actually arrives.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-FLIGHTTEE";

let eventId = "";
let stageId = "";
const player: Record<string, string> = {};

const PARS = new Array(18).fill(4);

/**
 * Two real sets, far enough apart that one stroke cannot be a rounding
 * accident: the blues play four shots harder than the reds off the same index.
 */
const BLUES = { courseRating: 74.9, slopeRating: 144, par: 72 };
const REDS = { courseRating: 69.5, slopeRating: 113, par: 72 };
/** The round's default set, which is what everybody used to be scored off. */
const WHITES = { courseRating: 72, slopeRating: 113, par: 72 };

const INDEX = 12;

/** WHS: Course Handicap = Index x Slope/113 + (CR - par), rounded. */
const playsOff = (t: { courseRating: number; slopeRating: number; par: number }) =>
  Math.round(INDEX * (t.slopeRating / 113) + (t.courseRating - t.par));

/**
 * And what the ROUND allocates off it. `strokeHandicapFor` returns a Playing
 * Handicap, so Stroke Play’s 95% is already applied — asserting the Course
 * Handicap against it would be comparing two different quantities.
 */
const playing = (t: { courseRating: number; slopeRating: number; par: number }) =>
  playingHandicapFrom(playsOff(t), 95);

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
      strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} championship`,
      dates: "",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      // The policy this whole test is about: the FLIGHT decides the tees.
      teePolicy: "flight",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });

  const [blues, reds, whites] = await Promise.all([
    prisma.tee.create({ data: { courseId: course.id, name: `${TAG} blues`, ...BLUES, position: 0 } }),
    prisma.tee.create({ data: { courseId: course.id, name: `${TAG} reds`, ...REDS, position: 1 } }),
    prisma.tee.create({ data: { courseId: course.id, name: `${TAG} whites`, ...WHITES, position: 2 } }),
  ]);
  await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: whites.id } });

  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  stageId = stage.id;

  // Two divisions, each claiming its own set — three decisions, not 120.
  const [champs, ladies] = await Promise.all([
    prisma.group.create({ data: { eventId, name: `${TAG} Championship`, position: 0, teeId: blues.id } }),
    prisma.group.create({ data: { eventId, name: `${TAG} Ladies`, position: 1, teeId: reds.id } }),
  ]);

  for (const [i, [who, groupId]] of ([["champ", champs.id], ["lady", ladies.id]] as const).entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        // The SAME index in both divisions, so the only thing that can separate
        // them is the tees their flight plays from.
        handicap: INDEX,
        groupId,
      },
    });
    player[who] = p.id;
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the two sets really are different", () => {
  it("separates them by more than a rounding accident", () => {
    // If these ever converged, every assertion below would pass trivially.
    expect(playsOff(BLUES)).toBeGreaterThan(playsOff(WHITES));
    expect(playsOff(REDS)).toBeLessThan(playsOff(WHITES));
    expect(playsOff(BLUES) - playsOff(REDS)).toBeGreaterThanOrEqual(4);
  });
});

describe("what each division is scored off", () => {
  it("gives the Championship flight the blues", async () => {
    const state = await loadEventState(eventId);
    expect(state).toBeTruthy();
    expect(state!.strokeHandicapFor(player.champ, stageId)).toBe(playing(BLUES));
  });

  it("gives the Ladies flight the reds", async () => {
    const state = await loadEventState(eventId);
    expect(state!.strokeHandicapFor(player.lady, stageId)).toBe(playing(REDS));
  });

  it("scores neither of them off the round's default set", async () => {
    // The old behaviour: BOTH players got the whites, so the same index came
    // out as the same number and the divisions were indistinguishable.
    const state = await loadEventState(eventId);
    const champ = state!.strokeHandicapFor(player.champ, stageId);
    const lady = state!.strokeHandicapFor(player.lady, stageId);
    expect(champ).not.toBe(playing(WHITES));
    expect(lady).not.toBe(playing(WHITES));
    expect(champ).not.toBe(lady);
  });
});

describe("the round-handicap screen", () => {
  it("shows the same numbers the round is scored on", async () => {
    // It read the default set too, so an organizer checking the sheet saw a
    // different handicap from the one on the player's card.
    const rows = await roundHandicapsFor(eventId, stageId);
    const champ = rows.find((r) => r.playerId === player.champ);
    const lady = rows.find((r) => r.playerId === player.lady);
    expect(champ?.member).toBe(playsOff(BLUES));
    expect(lady?.member).toBe(playsOff(REDS));
  });
});

describe("the value written permanently into history", () => {
  it("freezes each player off their own flight's tees", async () => {
    // The freeze is the one that cannot be corrected by fixing code later:
    // whatever it stored is what the round is scored on forever.
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId,
        playerId: player.lady,
        strokes: JSON.stringify(new Array(18).fill(4)),
      },
    });
    await freezeRoundHandicaps(eventId, stageId);

    const frozen = await prisma.roundHandicap.findFirst({
      where: { eventId, stageId, playerId: player.lady },
      select: { frozen: true },
    });
    expect(frozen?.frozen).toBe(playsOff(REDS));
    expect(frozen?.frozen).not.toBe(playsOff(WHITES));
  });
});
