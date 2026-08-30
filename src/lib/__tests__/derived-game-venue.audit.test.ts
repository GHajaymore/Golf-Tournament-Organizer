import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { moneyFor } from "../services/expenses";

/**
 * A derived pot is settled on the card the round was played on.
 *
 * The other half of the 2026-08-27 finding whose skins half is already fixed.
 * `Stage.courseId` is what the venue library exists for, and this path resolved
 * the EVENT's card — so a summer league playing week one at home and week three
 * away settled week three's birdie pot against the HOME card, counting birdies
 * against the wrong pars, while the leaderboard beside it read `Stage.courseId`
 * and was right.
 *
 * Pars are what make it visible: a 4 on a par-5 is a birdie and a 4 on a par-4
 * is not, so the same card either wins the pot or does not depending only on
 * which course the settlement thinks it was played on.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DERIVEDVENUE";

let eventId = "";
let awayStageId = "";
const player: Record<string, string> = {};

const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

const SI = Array.from({ length: 18 }, (_, i) => i + 1);
/** Home: every hole a par 4. */
const HOME_PARS = new Array(18).fill(4);
/** Away: the 1st is a par 5, and nothing else differs. */
const AWAY_PARS = [5, ...new Array(17).fill(4)];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
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
        pars: JSON.stringify(HOME_PARS),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(SI),
      },
    }),
    prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${TAG} away`,
        city: "",
        pars: JSON.stringify(AWAY_PARS),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(SI),
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
      customPars: JSON.stringify(HOME_PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      moneyMode: "split",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.createMany({
    data: [
      { eventId, courseId: home.id },
      { eventId, courseId: away.id },
    ],
  });

  // Week three, at the other course.
  const week3 = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      courseId: away.id,
    },
  });
  awayStageId = week3.id;

  for (const [i, who] of ["birdie", "steady"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: at(who),
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
    });
    player[who] = p.id;
  }

  /**
   * Both cards are identical except the 1st.
   *
   * A 4 there is a BIRDIE on the away card (par 5) and only a par on the home
   * card (par 4). Nothing else on either card can produce one, so the pot is
   * decided entirely by which course the settlement reads.
   */
  await prisma.scorecard.createMany({
    data: [
      {
        eventId,
        stageId: awayStageId,
        playerId: player.birdie,
        strokes: JSON.stringify([4, ...new Array(17).fill(4)]),
      },
      {
        eventId,
        stageId: awayStageId,
        playerId: player.steady,
        strokes: JSON.stringify([5, ...new Array(17).fill(4)]),
      },
    ],
  });

  const pot = await prisma.sideGame.create({
    data: {
      eventId,
      stageId: awayStageId,
      kind: "birdies",
      buyInCents: 1000,
      entryMode: "opt-in",
    },
  });
  await prisma.sideGameEntry.createMany({
    data: [
      { sideGameId: pot.id, playerId: player.birdie, confirmed: true },
      { sideGameId: pot.id, playerId: player.steady, confirmed: true },
    ],
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the two cards really do disagree about that hole", () => {
  it("makes a 4 a birdie away and a par at home", () => {
    // If they ever agreed, the assertions below would pass for any code.
    expect(AWAY_PARS[0]).toBe(5);
    expect(HOME_PARS[0]).toBe(4);
  });
});

describe("a birdie pot on a round played away", () => {
  it("pays the player who birdied the away card's 1st", async () => {
    const view = await moneyFor(eventId, at("birdie"));
    expect(
      view.gamesCents,
      "read off the home card there are no birdies at all, and the pot pays nobody",
    ).toBeGreaterThan(0);
  });

  it("charges the player who did not", async () => {
    const view = await moneyFor(eventId, at("steady"));
    expect(view.gamesCents).toBeLessThan(0);
  });

  it("moves the whole pot, to the cent", async () => {
    /**
     * Two players at £10 makes a £20 pot. One birdie between them takes all of
     * it, so the winner is +£10 on their own stake and the other is −£10.
     *
     * Read off the HOME card there is no birdie at all, and `derivedNets`
     * refunds everybody rather than picking a winner — so the same round pays
     * £10 or nothing depending only on which course the settlement thinks it
     * was played on.
     */
    const [a, b] = await Promise.all([
      moneyFor(eventId, at("birdie")),
      moneyFor(eventId, at("steady")),
    ]);
    expect(a.gamesCents).toBe(1000);
    expect(b.gamesCents).toBe(-1000);
  });

  it("keeps the pot zero-sum, whichever card it read", async () => {
    // The one invariant that must hold regardless: money between players is
    // moved, never created.
    const [a, b] = await Promise.all([
      moneyFor(eventId, at("birdie")),
      moneyFor(eventId, at("steady")),
    ]);
    expect(a.gamesCents + b.gamesCents).toBe(0);
  });
});
