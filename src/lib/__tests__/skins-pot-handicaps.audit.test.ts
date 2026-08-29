import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { skinsPotFor } from "../services/skins-pot";

/**
 * A settled skins pot prices cards the way the round says to.
 *
 * From the 2026-08-27 exploratory audit. `skinsPotFor` converted an Index to a
 * Course Handicap and then stopped, so two things the rest of the app honours
 * never reached the money:
 *
 *   - a committee's ROUND OVERRIDE. `round-handicap.ts` names the requirement
 *     directly — "otherwise an organizer sets an override and one round type
 *     quietly ignores it, which is worse than not offering the control at all"
 *     — and lists the three paths that comply. Skins was the fourth and did
 *     not, so the leaderboard priced a visitor's card off 20 and the pot
 *     priced the identical card off 16.
 *   - the FROZEN handicap. Editing a roster index a week later re-computed a
 *     pot already settled in the bar: different winners, different transfers,
 *     for money that had changed hands. That is verbatim what the freeze
 *     exists to prevent.
 *
 * And it resolved the card from the EVENT rather than the round, so a league
 * that rotates venues settled week three against week one's stroke index.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SKINSHCP";

let eventId = "";
let stageId = "";
let awayStageId = "";
const player: Record<string, string> = {};

// Stroke index 1..18, so a hole's number IS its difficulty and a handicap of
// 12 gets a shot on holes 1 to 12 and nowhere else.
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
// The AWAY course reverses it: hole 1 is the easiest there, hole 18 the hardest.
const AWAY_SI = Array.from({ length: 18 }, (_, i) => 18 - i);
const PARS = new Array(18).fill(4);
const LEVEL = new Array(18).fill(4);

/** Slope 113 and rating equal to par, so a Course Handicap IS the Index. */
const NEUTRAL_TEE = { courseRating: 72, slopeRating: 113, par: 72 };

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** Who won a given hole in this pot, or null if it carried. */
async function winnerOfHole(sid: string, hole: number) {
  const view = await skinsPotFor(eventId, sid, true, "full", "");
  const row = view?.holes.find((h) => h.hole === hole);
  expect(view, "the pot view should exist").toBeTruthy();
  return row?.playerId ?? null;
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });

  const [home, away] = await Promise.all([
    prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${TAG} home`,
        city: "",
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(SI),
      },
    }),
    prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${TAG} away`,
        city: "",
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(new Array(18).fill(400)),
        // The same eighteen holes ranked the other way round.
        strokeIndex: JSON.stringify(AWAY_SI),
      },
    }),
  ]);

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      dates: "",
      course: `${TAG} home`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      teePolicy: "single",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.createMany({
    data: [
      { eventId, courseId: home.id },
      { eventId, courseId: away.id },
    ],
  });

  const tee = await prisma.tee.create({
    data: { courseId: home.id, name: `${TAG} whites`, ...NEUTRAL_TEE, position: 0 },
  });
  await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: tee.id } });

  const [week1, week3] = await Promise.all([
    prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Skins", holes: 18 },
    }),
    // Week three, at the other course. The case the venue library exists for.
    prisma.stage.create({
      data: {
        eventId,
        position: 1,
        type: "Stroke Play Round",
        format: "Skins",
        holes: 18,
        courseId: away.id,
      },
    }),
  ]);
  stageId = week1.id;
  awayStageId = week3.id;

  for (const [i, [who, hcp]] of ([["hooper", 12], ["scratch", 0]] as const).entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: hcp,
        teeId: tee.id,
      },
    });
    player[who] = p.id;
  }

  // Both players level par everywhere, in both rounds — so the ONLY thing that
  // can win a hole is a handicap stroke.
  for (const sid of [stageId, awayStageId]) {
    await prisma.scorecard.createMany({
      data: [
        { eventId, stageId: sid, playerId: player.hooper, strokes: JSON.stringify(LEVEL) },
        { eventId, stageId: sid, playerId: player.scratch, strokes: JSON.stringify(LEVEL) },
      ],
    });
  }

  const mkPot = async (sid: string): Promise<void> => {
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId: sid, buyInCents: 1000, net: true, scope: "full" },
    });
    await prisma.skinsEntry.createMany({
      data: [
        { potId: pot.id, playerId: player.hooper, confirmed: true },
        { potId: pot.id, playerId: player.scratch, confirmed: true },
      ],
    });
  };
  await mkPot(stageId);
  await mkPot(awayStageId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

beforeEach(async () => {
  await prisma.roundHandicap.deleteMany({ where: { eventId } });
  await prisma.player.update({ where: { id: player.hooper }, data: { handicap: 12 } });
});

describe("the baseline everything else is measured against", () => {
  it("gives a 12-handicap the holes he is owed and no more", async () => {
    // Strokes on stroke index 1..12, so those holes are won outright and 13
    // upwards are halved and carry.
    expect(await winnerOfHole(stageId, 12)).toBe(player.hooper);
    expect(await winnerOfHole(stageId, 13)).toBeNull();
  });
});

describe("a committee's round override", () => {
  it("reaches the money, where it used to stop at the leaderboard", async () => {
    // A visitor given 14 for the day. The board priced his card off it; the
    // pot priced the same card off the roster, so he lost skins on holes he
    // had a stroke on and real money moved on the difference.
    await prisma.roundHandicap.create({
      data: { eventId, stageId, playerId: player.hooper, override: 14 },
    });

    expect(await winnerOfHole(stageId, 13)).toBe(player.hooper);
    expect(await winnerOfHole(stageId, 14)).toBe(player.hooper);
    expect(await winnerOfHole(stageId, 15)).toBeNull();
  });

  it("can take strokes away as well as give them", async () => {
    await prisma.roundHandicap.create({
      data: { eventId, stageId, playerId: player.hooper, override: 5 },
    });

    expect(await winnerOfHole(stageId, 5)).toBe(player.hooper);
    expect(await winnerOfHole(stageId, 6)).toBeNull();
  });
});

describe("a pot already settled in the bar", () => {
  it("does not re-compute when the roster index is edited a week later", async () => {
    /**
     * The freeze is the whole point of `RoundHandicap.frozen`, and this path
     * never read it. Updating an index is an ordinary thing for a club to do
     * between weeks; it must not reach back into a round whose money is gone.
     */
    await prisma.roundHandicap.create({
      data: { eventId, stageId, playerId: player.hooper, frozen: 12 },
    });
    const before = await winnerOfHole(stageId, 12);

    await prisma.player.update({ where: { id: player.hooper }, data: { handicap: 0 } });

    expect(await winnerOfHole(stageId, 12)).toBe(before);
    expect(await winnerOfHole(stageId, 12)).toBe(player.hooper);
  });

  it("would have changed hands without the freeze", async () => {
    // The same edit with nothing frozen: proof the test above is testing the
    // freeze and not something that could never move anyway.
    await prisma.player.update({ where: { id: player.hooper }, data: { handicap: 0 } });
    expect(await winnerOfHole(stageId, 12)).toBeNull();
  });
});

describe("a league that rotates venues", () => {
  it("settles week three against week three's card", async () => {
    /**
     * The away course ranks the same eighteen holes the other way round, so a
     * 12-handicap gets his shots on holes 7..18 there and 1..12 at home. Read
     * off the event's card, the money landed on the wrong holes entirely while
     * the leaderboard beside it — which does read `Stage.courseId` — was right.
     */
    expect(await winnerOfHole(awayStageId, 18)).toBe(player.hooper);
    expect(await winnerOfHole(awayStageId, 1)).toBeNull();
  });

  it("still settles week one against the home card", async () => {
    // The round with no venue of its own falls back to the event's, exactly
    // as before.
    expect(await winnerOfHole(stageId, 1)).toBe(player.hooper);
    expect(await winnerOfHole(stageId, 18)).toBeNull();
  });
});
