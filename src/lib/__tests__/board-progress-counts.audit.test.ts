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

/**
 * AND THE SAME COUNTER OVER A ROUND THAT FILES ITS CARDS SOMEWHERE ELSE.
 *
 * A side playing one ball writes a `TeamScorecard`; the `Scorecard` table this
 * counter read stays EMPTY for the whole round. Foursomes is a "Stroke Play
 * Round" and is not head to head, so it took the stroke branch and answered
 * `started: 0, certified: 0` over a finished round, with `total` counting the
 * PLAYERS in the field rather than the sides in the draw.
 *
 * Measured on the seeded club on 2026-09-20 before the fix: three completed
 * team rounds holding 16, 8 and 8 team cards, and 0 individual scorecards
 * between them. `/reports` printed "Nothing returned for this round yet" over
 * eight complete sides.
 *
 * THE FIXTURE MAKES EVERY WRONG ANSWER LOOK DIFFERENT, which is the whole
 * point of it: three sides, six players, and one side apiece finished,
 * part-way and not started. So "counts rows" (4), "counts players" (6),
 * "counts anything written down" (2 certified) and "counts nothing" (0) are
 * four distinguishable numbers rather than coincidences.
 */
const TEAM_TAG = "zz-board-progress-team";
let teamEventId = "";

async function cleanupTeams() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TEAM_TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TEAM_TAG } } });
}

describe("the round's progress, on a foursomes day of three sides", () => {
  beforeAll(async () => {
    await cleanupTeams();
    const org = await prisma.organization.create({
      data: { name: `${TEAM_TAG} club`, kind: "club" },
      select: { id: true },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TEAM_TAG} foursomes`,
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
    teamEventId = event.id;

    const stage = await prisma.stage.create({
      data: {
        eventId: teamEventId,
        position: 0,
        type: "Stroke Play Round",
        format: "Foursomes",
        holes: 18,
        scoringBasis: "net",
        handicapAllowance: 50,
      },
      select: { id: true },
    });

    // finished / part-way / not started. The middle one is nine holes, so a
    // counter that says "any hole written down means the card is in" reports
    // two returned where one is right.
    const holesFor = [18, 9, 0];
    for (const [i, holes] of holesFor.entries()) {
      const side = await prisma.team.create({
        data: { eventId: teamEventId, stageId: stage.id, name: `${TEAM_TAG} side ${i + 1}`, seed: i + 1 },
        select: { id: true },
      });
      for (const half of [0, 1]) {
        const p = await prisma.player.create({
          data: {
            eventId: teamEventId,
            name: `${TEAM_TAG} p${i + 1}${half}`,
            email: `${TEAM_TAG}-${i + 1}${half}@example.invalid`,
            handicap: 10 + i,
            seed: i * 2 + half + 1,
            status: "confirmed",
          },
          select: { id: true },
        });
        await prisma.teamMember.create({ data: { teamId: side.id, playerId: p.id, position: half } });
      }
      if (holes === 0) continue;
      // One card for the side, with a blank playerId — the shared ball.
      await prisma.teamScorecard.create({
        data: {
          eventId: teamEventId,
          stageId: stage.id,
          teamId: side.id,
          strokes: JSON.stringify(
            Array.from({ length: 18 }, (_, h) => (h < holes ? 4 : null)),
          ),
        },
      });
    }
  });

  afterAll(cleanupTeams);

  const teamProgress = async () => {
    const state = await loadEventState(teamEventId);
    expect(state, "the team event did not load").not.toBeNull();
    return state!.boardProgress;
  };

  it("counts SIDES, not players and not team cards", async () => {
    /**
     * THE DEFECT. `total` was `confirmed.length` — six, the field — for a
     * round that only three things can return.
     */
    const p = await teamProgress();
    expect(p.total, "three sides are out, whatever the field size").toBe(3);
  });

  it("sees the two sides that are out on the course", async () => {
    // Zero before this, because the round files no `Scorecard` rows at all.
    const p = await teamProgress();
    expect(p.started).toBe(2);
  });

  it("counts a side's card as returned only once every hole is on it", async () => {
    const p = await teamProgress();
    expect(p.certified, "nine holes is not a returned card").toBe(1);
  });

  it("names what it is counting, so a screen does not re-derive it", async () => {
    /**
     * "cards" was the answer before, and it is the wrong noun twice over: a
     * four-ball of eight sides holds sixteen team cards, so the word would be
     * true about rows and false about the round.
     */
    const p = await teamProgress();
    expect(p.unit).toBe("sides");
  });

  it("stops offering a round the field has played as the next one to draw", async () => {
    /**
     * The second reader, and the one nobody would have connected to this.
     * `nextUnplayedRound` is "the first round with nothing on it, in play
     * order" — what `/foursomes` draws a tee sheet FOR. It asks
     * `roundProgress(s).started === 0`, so every team round in the app
     * qualified for ever, however many sides were round.
     */
    const state = await loadEventState(teamEventId);
    expect(state!.nextUnplayedRound, "two sides are out on this one").toBeNull();
  });

  it("does not claim a round is all in while a side is still out", async () => {
    // `snapshotStanding` prints "Nothing returned for this round yet" on
    // done <= 0 — which is the sentence that was over eight finished sides.
    const p = await teamProgress();
    expect(p.certified > 0, "something HAS been returned").toBe(true);
    expect(p.certified >= p.total, "two sides have not finished").toBe(false);
    expect(p.pct).toBe(33);
  });
});
