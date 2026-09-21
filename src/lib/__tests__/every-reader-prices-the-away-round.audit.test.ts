import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { roundHandicapsFor } from "../services/round-handicap";
import { teamsForStage } from "../services/teams";
import { skinsPotFor } from "../services/skins-pot";
import { playingHandicapFrom } from "../domain/handicap";

/**
 * EVERY READER PRICES THE AWAY ROUND OFF THE AWAY CLUB.
 *
 * `a-card-is-priced-by-its-own-round.test.ts` sweeps the SOURCE and proves
 * nobody calls the event-wide resolver any more. That is a fact about which
 * function is called and says nothing about the number it returns, so this
 * asserts the VALUE, on real rows, against the WHS arithmetic off the ratings
 * the fixture stores.
 *
 * Six readers resolved the tee event-wide — three through `teeSetupFor`, three
 * through `roundTeeId` — and every one of them had the round in hand. Three of
 * them WRITE what they compute. The two most expensive to be wrong about are
 * here because they decide money and what a pair is told on the tee:
 *
 *     the board            `loadEventState`, which was already right
 *     the round's screen   `roundHandicapsFor`
 *     a side's handicap    `teamsForStage` — the number read out on the tee
 *     net skins            `skinsPotFor` — money, won outright, so one
 *                          differing stroke flips a hole and carries onward
 *
 * The fixture is a member-guest over two clubs whose ratings are eleven strokes
 * apart at a 12 index, with `Event.defaultTeeId` CONFIGURED to the host's whites
 * — which is the ordinary state of a club that opened the setting once, and the
 * state `two-venue-tees.audit.test.ts` deliberately does not have.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-EVERYREADER";

let eventId = "";
let homeRoundId = "";
let awayRoundId = "";
let awayTeamRoundId = "";
const player: Record<string, string> = {};

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/** The host club, and the tournament's configured set. */
const HOST = { courseRating: 74.9, slopeRating: 144, par: 72 };
/** The away club, a far gentler course. */
const AWAY = { courseRating: 68.2, slopeRating: 105, par: 72 };

const INDEX = 12;

/** WHS: Course Handicap = Index x Slope/113 + (CR - par), rounded. */
const playsOff = (t: { courseRating: number; slopeRating: number; par: number }, index = INDEX) =>
  Math.round(index * (t.slopeRating / 113) + (t.courseRating - t.par));

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "club" } });
  const card = {
    pars: JSON.stringify(PARS),
    yards: JSON.stringify(new Array(18).fill(400)),
    strokeIndex: JSON.stringify(SI),
  };
  const [host, away] = await Promise.all([
    prisma.course.create({ data: { organizationId: org.id, name: `${TAG} host`, city: "", ...card } }),
    prisma.course.create({ data: { organizationId: org.id, name: `${TAG} away`, city: "", ...card } }),
  ]);
  const [hostTee, awayTee] = await Promise.all([
    prisma.tee.create({ data: { courseId: host.id, name: `${TAG} host white`, ...HOST, position: 0 } }),
    prisma.tee.create({ data: { courseId: away.id, name: `${TAG} away white`, ...AWAY, position: 1 } }),
  ]);

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} member-guest`,
      dates: "",
      course: `${TAG} host`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      courseId: host.id,
      // The rung that made every reader wrong: a real set, at the wrong club.
      defaultTeeId: hostTee.id,
      teePolicy: "own",
    },
  });
  eventId = event.id;
  await prisma.eventCourse.createMany({
    data: [
      { eventId, courseId: host.id },
      { eventId, courseId: away.id },
    ],
  });

  const round = (position: number, courseId: string, teeId: string | null, format: string) =>
    prisma.stage.create({
      data: { eventId, position, type: "Stroke Play Round", format, holes: 18, courseId, teeId },
    });
  const [r1, r2, r3] = await Promise.all([
    round(0, host.id, null, "Stroke Play"),
    round(1, away.id, awayTee.id, "Stroke Play"),
    // A team round away, for `teamsForStage` — the seeded club's own away round
    // is a team round, which is why this cell is worth having.
    round(2, away.id, awayTee.id, "Four-Ball"),
  ]);
  homeRoundId = r1.id;
  awayRoundId = r2.id;
  awayTeamRoundId = r3.id;

  /**
   * TWO DIFFERENT INDEXES, WHICH IS WHAT LETS THE SKINS POT EXPRESS A WRONG
   * ANSWER.
   *
   * A first draft put both players on 12. Net skins then made a level game off
   * EITHER club's tees — the pair are equal whichever slope is applied — so the
   * assertion could not fail and was coverage in appearance only, which is the
   * thing CLAUDE.md says to mutate for before trusting a cell.
   *
   * On 12 and 20 the GAP between them moves with the slope, and that is what
   * decides a net skin:
   *
   *     away, slope 105    Ann 7, Bob 15   — Bob is given 8 more strokes
   *     host, slope 144    Ann 18, Bob 28  — Bob is given 10 more
   *
   * With identical gross cards that is not a shading of a total, it is a
   * different player holding the pot: off the away club Bob receives a stroke on
   * stroke-index 8 through 15 and Ann does not, so those holes are his; off the
   * host's, Ann is the one receiving the extra on 1 through 10. The winner
   * changes hands, which is exactly why skins is the sharpest money to be wrong
   * about.
   */
  const INDEXES: Record<string, number> = { ann: INDEX, bob: 20 };
  for (const [i, who] of ["ann", "bob"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: INDEXES[who],
      },
    });
    player[who] = p.id;
  }

  // One side, for the team reader.
  const side = await prisma.team.create({
    data: { eventId, stageId: awayTeamRoundId, name: `${TAG} pair`, seed: 1 },
  });
  await prisma.teamMember.createMany({
    data: [
      { teamId: side.id, playerId: player.ann, position: 0 },
      { teamId: side.id, playerId: player.bob, position: 1 },
    ],
  });

  // A net skins pot on the away round, with both players' money in it.
  const pot = await prisma.skinsPot.create({
    data: { eventId, stageId: awayRoundId, net: true, scope: "full", groupKey: "", buyInCents: 1000 },
  });
  await prisma.skinsEntry.createMany({
    data: [
      { potId: pot.id, playerId: player.ann, confirmed: true },
      { potId: pot.id, playerId: player.bob, confirmed: true },
    ],
  });

  /**
   * IDENTICAL GROSS CARDS, so every net difference is the handicap and nothing
   * else. A four on every hole of a par-4 course: whoever receives a stroke on a
   * hole is alone on three there, and the hole is theirs.
   */
  await prisma.scorecard.createMany({
    data: [player.ann, player.bob].map((playerId) => ({
      eventId,
      stageId: awayRoundId,
      playerId,
      strokes: JSON.stringify(new Array(18).fill(4)),
    })),
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the two venues really are different", () => {
  it("separates them by more than a rounding accident", () => {
    // Without this every assertion below could pass on a fixture whose two
    // courses price one index identically.
    expect(playsOff(HOST)).toBeGreaterThan(playsOff(AWAY) + 5);
  });
});

describe("every reader prices the away round off the away club", () => {
  it("the board does, which it always did", async () => {
    const state = await loadEventState(eventId);
    expect(state).not.toBeNull();
    // Stroke Play's 95%, applied by the board and not by a Course Handicap.
    expect(state!.strokeHandicapFor(player.ann, awayRoundId)).toBe(
      playingHandicapFrom(playsOff(AWAY), 95),
    );
    // The control in the same call: the home round is still the host's.
    expect(state!.strokeHandicapFor(player.ann, homeRoundId)).toBe(
      playingHandicapFrom(playsOff(HOST), 95),
    );
  });

  it("the round's own handicap screen does", async () => {
    const away = await roundHandicapsFor(eventId, awayRoundId);
    const home = await roundHandicapsFor(eventId, homeRoundId);
    expect(away.find((r) => r.playerId === player.ann)?.member).toBe(playsOff(AWAY));
    expect(home.find((r) => r.playerId === player.ann)?.member).toBe(playsOff(HOST));
  });

  it("a side's handicap does, which is the number read out on the tee", async () => {
    /**
     * `teamsForStage` resolved the set through `teeSetupFor`, so the seeded
     * club's evening nine at Ardmore had its pairings priced off Braid Hollow's
     * championship whites — 129/70.8 against 96/58.6. A shared ball makes it
     * worse rather than better: one side handicap is the only number the pair
     * receives all round.
     */
    const sides = await teamsForStage(eventId, awayTeamRoundId, "Four-Ball", 0, 18);
    expect(sides, "the side is missing, so this asserts nothing").toHaveLength(1);
    const byId = new Map(sides[0].members.map((m) => [m.playerId, m.handicap]));
    /**
     * EACH MEMBER ON THEIR OWN INDEX, which is stronger than asserting one
     * number twice: the pair are on 12 and 20, so a fixture where both came back
     * equal would be visibly wrong rather than quietly passing.
     */
    expect(byId.get(player.ann), "Ann was priced off the host club").toBe(playsOff(AWAY, 12));
    expect(byId.get(player.bob), "Bob was priced off the host club").toBe(playsOff(AWAY, 20));
    // And the two differ, so neither value is an accident of them matching.
    expect(playsOff(AWAY, 12)).not.toBe(playsOff(AWAY, 20));
  });

  it("net skins do, which is money", async () => {
    /**
     * Skins are won OUTRIGHT and carry onward, so a differing stroke does not
     * shade a total — it moves a hole, and every hole after it that was carried.
     * This pot's strokes came off the host club's 144 slope while the board that
     * names the winners used the away club's 105.
     *
     * Asserted through the view's own `result`, which is what the settle-up and
     * the Prizes screen read, rather than through a helper only this test calls.
     */
    const view = await skinsPotFor(eventId, awayRoundId, true, "full", "");
    expect(view, "no pot view came back").not.toBeNull();
    expect(view!.entrantIds.sort()).toEqual([player.ann, player.bob].sort());

    const bobsHoles = view!.holes.filter((h) => h.playerId === player.bob).map((h) => h.hole);
    /**
     * WHICH HOLES, NOT WHO — and getting that wrong is worth recording, because
     * the first version of this assertion could not fail.
     *
     * It asserted that Bob holds the pot and Ann does not. Bob has the higher
     * index, so with identical gross cards he receives more strokes and wins net
     * skins off EITHER club: the mutation that priced this pot off the host was
     * run and the test stayed green. A money assertion that survives the defect
     * it names is the "plausible measurement" CLAUDE.md warns about, and only
     * mutating found it.
     *
     * What the venue actually changes is WHERE his extra strokes fall, because
     * the GAP between the two of them moves with the slope:
     *
     *     away, slope 105   Ann 7, Bob 15   gap 8   → Bob alone on SI 8..15
     *     host, slope 144   Ann 18, Bob 28  gap 10  → Bob alone on SI 1..10
     *
     * The stroke index here is 1..18 in hole order, so those are holes 8-15
     * against holes 1-10. Two holes settle it in both directions — hole 15 is
     * his off the away club and not off the host's, hole 1 the reverse — which
     * keeps the assertion clear of carry arithmetic without weakening it.
     */
    expect(bobsHoles.length, "nobody won a net skin, so this asserts nothing").toBeGreaterThan(0);
    expect(bobsHoles, "hole 15 is only Bob's when the pot is priced off the AWAY club").toContain(15);
    expect(bobsHoles, "hole 1 is Bob's only when the pot is priced off the HOST club").not.toContain(
      1,
    );
    // Ann receives fewer strokes than Bob at either venue, so she wins nothing
    // with identical cards. Stated so the two assertions above are not read as
    // being about her.
    expect(view!.holes.filter((h) => h.playerId === player.ann)).toEqual([]);
  });

  it("and the board and the round's screen agree on every round", async () => {
    /**
     * THE TWO READERS, PINNED. The values above are pinned to the WHS
     * arithmetic so this cannot be satisfied by breaking both; this catches a
     * later change to either the day it is made.
     */
    const state = await loadEventState(eventId);
    for (const stageId of [homeRoundId, awayRoundId, awayTeamRoundId]) {
      const rows = await roundHandicapsFor(eventId, stageId);
      const row = rows.find((r) => r.playerId === player.ann)!;
      const allowance = stageId === awayTeamRoundId ? 90 : 95;
      expect(
        playingHandicapFrom(row.handicap, allowance),
        `round ${stageId} disagrees between its screen and its board`,
      ).toBe(state!.strokeHandicapFor(player.ann, stageId));
    }
  });
});
