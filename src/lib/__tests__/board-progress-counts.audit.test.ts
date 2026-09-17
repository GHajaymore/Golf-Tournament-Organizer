import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { loadEventState } from "@/lib/services/tournament";

/**
 * WHAT "SCORECARDS IN" COUNTS, AND WHAT IT USED TO.
 *
 * `roundProgress` measured `hasAnyHole(c.strokes)` — literally "somebody typed
 * a digit" — and three readers then described that number as finished: the
 * dashboard's "scorecards in" and "matches complete", `snapshotStanding`'s
 * "This round is all in", and the bracket feeder.
 *
 * The schema had said otherwise all along. `Scorecard.status` models Rule 3.3b
 * and its own comments are explicit:
 *
 *     entered    written down. Not yet claimed to be right by anyone.
 *     certified  the marker and player say the scores are correct.
 *                "This is the card being returned."
 *     approved   the committee has accepted it. "Only now is it a result."
 *     disputed   someone has said it is wrong.
 *
 * None of it was read here, so a DISPUTED card counted toward "cards in"
 * exactly as an approved one did — while `card-approval.ts`, two files away,
 * was refusing to rubber-stamp those very rows.
 *
 * NOTHING IN THE SUITE NOTICED THE CHANGE. tsc and 7,377 tests passed with the
 * counter rewritten, which says the semantics were asserted nowhere at all.
 * That is what this file is for.
 *
 * FOUR CARDS, ONE PER STATE, so each assertion can only be satisfied by
 * reading the column rather than by counting rows: the field is four and every
 * one of them has holes written down, so a counter that still asks `hasAnyHole`
 * answers 4 to all three questions.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-board-progress";

const FULL = JSON.stringify(new Array(18).fill(4));

let eventId = "";
let stageId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      scoringBasis: "gross",
      handicapAllowance: 100,
    },
    select: { id: true },
  });
  stageId = stage.id;

  // One player per card state. Every card is FULL, so the old counter — which
  // asked only whether a hole had been written down — would have said 4/4.
  for (const [i, status] of ["entered", "certified", "approved", "disputed"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${status}`,
        email: `${TAG}-${status}@example.invalid`,
        handicap: 8 + i,
        seed: i + 1,
        status: "confirmed",
      },
      select: { id: true },
    });
    await prisma.scorecard.create({
      data: { eventId, stageId, playerId: p.id, strokes: FULL, status },
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const progress = async () => {
  const state = await loadEventState(eventId);
  expect(state, "the event did not load").not.toBeNull();
  return state!.boardProgress;
};

describe("the round's progress, on a field of four whose cards are all full", () => {
  it("counts every card as STARTED, because every one has holes on it", async () => {
    const p = await progress();
    expect(p.started, "all four players have written scores down").toBe(4);
    expect(p.total).toBe(4);
  });

  it("counts only the RETURNED cards as certified", async () => {
    /**
     * THE DEFECT. Certified and approved are returned; entered and disputed
     * are not. The old counter said four.
     */
    const p = await progress();
    expect(
      p.certified,
      "entered and disputed cards are not returned cards",
    ).toBe(2);
  });

  it("counts only the committee's own acceptance as approved", async () => {
    const p = await progress();
    expect(p.approved, "one card has been accepted").toBe(1);
  });

  it("drives the bar off certified, not off who has started", async () => {
    // 2 of 4 returned. The bar read 100% when it measured "started".
    const p = await progress();
    expect(p.pct).toBe(50);
  });

  it("does not report the round all in while two cards are outstanding", async () => {
    /**
     * The reader this was costing. `snapshotStanding` says "This round is all
     * in, but the tournament has not been closed yet" on `done >= total`, and
     * `done` is the alias of `certified` — so the sentence is now true when it
     * appears.
     */
    const p = await progress();
    expect(p.certified, "the alias is gone; readers name the question").toBe(2);
    expect(p.certified >= p.total, "two cards are still out").toBe(false);
  });
});
