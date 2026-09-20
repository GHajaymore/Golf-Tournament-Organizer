import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A FILE OF NET SCORES IS CONVERTED OFF THE ROUND'S OWN CARD, AND STORED.
 *
 * `importScores` converts net back to gross by adding the shots received on
 * each hole, and WRITES the result. Its own comment says what that means —
 * "stored strokes are the one thing that cannot be recomputed" — and it is
 * careful about the nine played and about the round's handicap overrides.
 *
 * It read the stroke index off `resolveCourse(event)`: the TOURNAMENT's
 * course. A round played anywhere else was converted against the wrong card,
 * so the shots landed on the wrong holes and the wrong gross went into the
 * database for ever. Nothing downstream can detect it, because a stored gross
 * is indistinguishable from a gross somebody actually shot.
 *
 * The read paths had the same split and were consolidated separately. This is
 * the write, and it is the half where being wrong is permanent.
 *
 * THE FIXTURE INVERTS THE TWO CARDS, which is the only shape that can tell
 * them apart: the away course's stroke index is the home one reversed, so
 * hole 1 is the hardest hole at home and the easiest away. A player receiving
 * one shot gets it on hole 1 off the home card and on hole 18 off the away
 * card. Convert 3 net on hole 1 and the stored gross is 4 or 3 depending
 * entirely on which card was read — one number, two answers, no ambiguity.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NETIMPORT";

/** Par 4 everywhere, so par plays no part in what this measures. */
const PARS = new Array(18).fill(4);
/** Hole 1 hardest at home … */
const HOME_SI = Array.from({ length: 18 }, (_, i) => i + 1);
/** … and hole 1 easiest away. */
const AWAY_SI = [...HOME_SI].reverse();

let session: {
  eventId: string;
  email: string;
  viewRole: string;
  name: string;
  role: string;
  userId: string;
  accountId: string;
} | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { importScores } = await import("@/app/actions/tournament");

const ids = { event: "", awayStage: "", player: "" };

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });

  const home = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} home`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(HOME_SI),
    },
  });
  const away = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} away`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(AWAY_SI),
    },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} tour`,
      shape: "series",
      format: "stroke",
      status: "live",
      dates: "",
      course: `${TAG} home`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      // The TOURNAMENT's card is the home one — the card the importer read.
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(HOME_SI),
    },
  });
  ids.event = event.id;
  await prisma.eventCourse.create({ data: { eventId: event.id, courseId: home.id } });
  await prisma.eventCourse.create({ data: { eventId: event.id, courseId: away.id } });

  // Round two is AWAY. Everything else about it is ordinary.
  const awayStage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 1,
      description: "Round 2 away",
      type: "Stroke Play Round",
      format: "Stroke Play",
      scoringBasis: "net",
      holes: 18,
      courseId: away.id,
    },
  });
  ids.awayStage = awayStage.id;

  const group = await prisma.group.create({
    data: { eventId: event.id, name: `${TAG} flight`, position: 0 },
  });
  const player = await prisma.player.create({
    data: {
      eventId: event.id,
      groupId: group.id,
      name: `${TAG} One Shot`,
      email: `${TAG}-one@example.invalid`.toLowerCase(),
      seed: 1,
      status: "confirmed",
      // Exactly one shot, so it lands on exactly one hole and the two cards
      // disagree about which.
      handicap: 1,
    },
  });
  ids.player = player.id;

  session = {
    eventId: event.id,
    email: `${TAG}-staff@example.invalid`.toLowerCase(),
    viewRole: "admin",
    name: `${TAG} staff`,
    role: "admin",
    userId: "",
    accountId: "",
  };
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("importing net scores for a round played away", () => {
  it("stores gross converted off the ROUND's stroke index", async () => {
    /**
     * Net 4 on every hole, from a player receiving one shot.
     *
     * Gross is net plus the shots received on that hole, so seventeen holes
     * store 4 and exactly one stores 5 — the stroke hole. Off the AWAY card
     * that is hole 18; off the tournament's home card it is hole 1.
     */
    const net = new Array(18).fill(4);
    const out = await importScores(ids.awayStage, "net-strokes", [
      { playerId: ids.player, strokes: net },
    ]);
    expect(out.ok, `import refused: ${out.ok === false ? out.error : ""}`).toBe(true);
    expect(out.written).toBe(1);

    const card = await prisma.scorecard.findFirst({
      where: { eventId: ids.event, stageId: ids.awayStage, playerId: ids.player },
      select: { strokes: true },
    });
    const stored = JSON.parse(card!.strokes) as (number | null)[];

    // The control: exactly one shot was added, so the fixture really does
    // distinguish the two cards rather than storing the file unchanged.
    const raised = stored.filter((s) => s === 5);
    expect(raised.length, `one shot should raise exactly one hole, stored ${stored.join(",")}`).toBe(1);

    // And it is the away card's stroke hole, not the tournament's.
    expect(stored[17], "hole 18 is the away card's stroke hole and did not get the shot").toBe(5);
    expect(stored[0], "hole 1 got the shot, which is the TOURNAMENT's card, not this round's").toBe(4);
  });
});
