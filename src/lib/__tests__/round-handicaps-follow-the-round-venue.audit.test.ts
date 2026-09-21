import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { roundHandicapsFor, freezeRoundHandicaps } from "../services/round-handicap";
import { playingHandicapFrom } from "../domain/handicap";

/**
 * THE ROUND SAYS WHICH TEES. THE ROUND'S OWN HANDICAP SCREEN READ THE
 * TOURNAMENT'S.
 *
 * `two-venue-tees.audit.test.ts` proves the BOARD walks match -> round ->
 * event and falls back to the first set on the course actually being played:
 * `loadEventState` builds `courseHcpByStage` once per round through
 * `teeForPlay`, and carries each tee's `courseId` so a stored `Player.teeId`
 * from another venue is stepped past rather than honoured.
 *
 * `round-handicap.ts` did neither. Both of its functions resolved the tee
 * EVENT-WIDE, through `teeSetupFor`, and built their ratings map without
 * `courseId` — which `courseHandicapMap` reads as "this caller cannot be
 * judged, keep behaving as it did", so every rung was allowed through. So on
 * this fixture, for a round played at the away club:
 *
 *     the board          7   the away club's 105 slope, 68.2 rating
 *     this screen       18   the host club's 144 slope, 74.9 rating
 *
 * AND IT IS NOT A DISPLAY DEFECT, which is the part that makes it worth a
 * fixture. `freezeRoundHandicaps` is the same resolution, and it WRITES — one
 * number per player into `RoundHandicap.frozen`, permanently, at the round's
 * first card. `resolveRoundHandicap` prefers `frozen` over everything, so from
 * that moment the board's careful per-round answer is overruled by the freeze's
 * event-wide one: 17 playing strokes where 7 is right, on a card played at a
 * course eleven shots gentler.
 *
 * This asserts the two readers AGREE rather than merging them into one, for the
 * reason `pin-two-readers-dont-merge-them` records: two broken readers agree
 * perfectly, so the value is also pinned to the RULES — the WHS arithmetic off
 * the ratings the fixture stores — and the two venues are asserted to be more
 * than a rounding apart before anything else is asserted at all.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROUNDHCP-VENUE";

let eventId = "";
let homeRoundId = "";
let namedAwayId = "";
let impliedAwayId = "";
let playerId = "";
let hostTeeId = "";
let awayTeeId = "";

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/** The host club, and the tournament's configured set. */
const HOST = { courseRating: 74.9, slopeRating: 144, par: 72 };
/** The away club, a far gentler course. */
const AWAY = { courseRating: 68.2, slopeRating: 105, par: 72 };

const INDEX = 12;

/** WHS: Course Handicap = Index x Slope/113 + (CR - par), rounded. */
const playsOff = (t: { courseRating: number; slopeRating: number; par: number }) =>
  Math.round(INDEX * (t.slopeRating / 113) + (t.courseRating - t.par));

/** Stroke Play's 95%, which the board applies and a Course Handicap does not. */
const playing = (t: { courseRating: number; slopeRating: number; par: number }) =>
  playingHandicapFrom(playsOff(t), 95);

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

  /**
   * Position 0 and 1, so which set sorts first is a FACT rather than an
   * insertion-order accident. `round-handicap.ts` reads the tees ordered by
   * position across every venue, so the host's set is deterministically the one
   * an event-wide fallback lands on — which is what makes the wrong answer
   * below reproducible rather than flaky.
   */
  const [hostTee, awayTee] = await Promise.all([
    prisma.tee.create({ data: { courseId: host.id, name: `${TAG} host white`, ...HOST, position: 0 } }),
    prisma.tee.create({ data: { courseId: away.id, name: `${TAG} away white`, ...AWAY, position: 1 } }),
  ]);
  hostTeeId = hostTee.id;
  awayTeeId = awayTee.id;

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
      /**
       * CONFIGURED, deliberately — the ordinary state of a club that opened the
       * tee setting once and picked its own whites. That is what makes the
       * event-wide answer a real rating from a real course rather than an
       * unrated fall-through, and therefore invisible on the screen.
       */
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

  const [r1, r2, r3] = await Promise.all([
    prisma.stage.create({
      data: {
        eventId,
        position: 0,
        type: "Stroke Play Round",
        format: "Stroke Play",
        holes: 18,
        courseId: host.id,
      },
    }),
    prisma.stage.create({
      // Away, and it NAMES its set. The strongest form of the round saying so.
      data: {
        eventId,
        position: 1,
        type: "Stroke Play Round",
        format: "Stroke Play",
        holes: 18,
        courseId: away.id,
        teeId: awayTee.id,
      },
    }),
    prisma.stage.create({
      // Away, naming nothing — the course decides, which is the commoner state
      // and the one a club reaches without opening a single tee setting.
      data: {
        eventId,
        position: 2,
        type: "Stroke Play Round",
        format: "Stroke Play",
        holes: 18,
        courseId: away.id,
      },
    }),
  ]);
  homeRoundId = r1.id;
  namedAwayId = r2.id;
  impliedAwayId = r3.id;

  const p = await prisma.player.create({
    data: {
      eventId,
      name: `${TAG} golfer`,
      email: `${TAG}.golfer@example.invalid`.toLowerCase(),
      seed: 1,
      status: "confirmed",
      handicap: INDEX,
    },
  });
  playerId = p.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

beforeEach(async () => {
  // Every test starts on an unfrozen tournament with no stored player tee: the
  // freeze is permanent by design, so a test that froze one round must not
  // decide what the next one reads.
  await prisma.roundHandicap.deleteMany({ where: { eventId } });
  await prisma.player.update({ where: { id: playerId }, data: { teeId: null } });
});

describe("the two venues really are different", () => {
  it("separates them by more than a rounding accident", () => {
    // Without this, every assertion below could pass on a fixture whose two
    // courses happen to price one index identically.
    expect(playsOff(HOST)).toBeGreaterThan(playsOff(AWAY) + 5);
  });
});

describe("the round configuration screen prices a round off the round's tees", () => {
  const memberOn = async (stageId: string) => {
    const rows = await roundHandicapsFor(eventId, stageId);
    const row = rows.find((r) => r.playerId === playerId);
    expect(row, "the field is missing from the round's own handicap screen").toBeTruthy();
    return row!;
  };

  it("prices the home round off the host club", async () => {
    const row = await memberOn(homeRoundId);
    expect(row.member).toBe(playsOff(HOST));
    expect(row.handicap).toBe(playsOff(HOST));
  });

  it("prices a round that NAMES the away set off that set", async () => {
    /**
     * THE DEFECT, STATED AS A NUMBER. `Stage.teeId` is the away white and this
     * screen read `teeSetupFor` — the tournament's own choice, event-wide — so
     * it answered 18 where 7 is right. The organizer reading it is reading the
     * number they believe their cards are priced off.
     */
    const row = await memberOn(namedAwayId);
    expect(row.member, "the round named its tees and this screen read the event's").toBe(
      playsOff(AWAY),
    );
  });

  it("prices a round that names only its COURSE off that course's set", async () => {
    // No `Stage.teeId` at all. `teeForPlay` falls back to the first set on the
    // course being played, which is the rule the board already applies.
    const row = await memberOn(impliedAwayId);
    expect(row.member, "the round's course did not decide its tees").toBe(playsOff(AWAY));
  });

  it("steps past a stored player tee that belongs to another course", async () => {
    /**
     * THE SECOND HALF, AND IT NEEDS ITS OWN FIX. `courseHandicapMap` can only
     * refuse a set from the wrong venue if the ratings it is handed carry
     * `courseId` — its own comment says a caller supplying none "cannot be
     * judged, and must keep behaving exactly as it did". This screen supplied
     * none, so a stored preference for the host's whites priced a card played
     * at the away club, while every player without a stored tee beside them was
     * priced correctly.
     */
    await prisma.player.update({ where: { id: playerId }, data: { teeId: hostTeeId } });
    // At home the stored set IS on the course being played, so it wins — the
    // control that stops the fix becoming "ignore the player's tees".
    expect((await memberOn(homeRoundId)).member).toBe(playsOff(HOST));
    expect(
      (await memberOn(namedAwayId)).member,
      "a stored tee from another course priced this round",
    ).toBe(playsOff(AWAY));
  });

  it("honours a stored tee that IS on the round's course", async () => {
    // The other direction of the same control: the away set, at the away club,
    // must still be the player's own answer rather than a refusal.
    await prisma.player.update({ where: { id: playerId }, data: { teeId: awayTeeId } });
    expect((await memberOn(impliedAwayId)).member).toBe(playsOff(AWAY));
  });

  it("agrees with the board, round for round", async () => {
    /**
     * THE TWO READERS, PINNED TO EACH OTHER. The values above are pinned to the
     * WHS arithmetic so this cannot be satisfied by breaking both; this is
     * pinned to the board so a later change to either one is caught the day it
     * is made rather than when a member asks why their net moved.
     */
    const state = await loadEventState(eventId);
    expect(state).not.toBeNull();
    for (const [name, stageId] of [
      ["home", homeRoundId],
      ["away, named", namedAwayId],
      ["away, implied", impliedAwayId],
    ] as const) {
      const row = await memberOn(stageId);
      expect(
        playingHandicapFrom(row.handicap, 95),
        `the ${name} round's screen and its board disagree`,
      ).toBe(state!.strokeHandicapFor(playerId, stageId));
    }
  });
});

describe("the freeze writes the round's own number, not the tournament's", () => {
  it("freezes the away round off the away club", async () => {
    const froze = await freezeRoundHandicaps(eventId, namedAwayId);
    expect(froze, "nothing was frozen, so this test asserts nothing").toBe(1);
    const row = await prisma.roundHandicap.findFirst({
      where: { eventId, stageId: namedAwayId, playerId },
      select: { frozen: true },
    });
    expect(row?.frozen, "the host club's rating was written into this round's history").toBe(
      playsOff(AWAY),
    );
  });

  it("does not let the freeze overrule the board", async () => {
    /**
     * WHY THIS IS MORE THAN A SCREEN. `resolveRoundHandicap` prefers `frozen`
     * over the live conversion — rightly, because that is the whole point of
     * freezing — so a freeze computed off the wrong venue does not merely
     * display wrongly, it REPLACES the board's per-round answer for the life of
     * the tournament. Measured before the fix: 17 playing strokes where 7 is
     * right, on every card in the round.
     */
    const before = (await loadEventState(eventId))!.strokeHandicapFor(playerId, namedAwayId);
    expect(before, "the board was already wrong, so the freeze proves nothing").toBe(playing(AWAY));

    await freezeRoundHandicaps(eventId, namedAwayId);

    const after = (await loadEventState(eventId))!.strokeHandicapFor(playerId, namedAwayId);
    expect(after, "freezing the round changed what the board scores it off").toBe(before);
  });

  it("still freezes the home round off the host club", async () => {
    // The control. A fix that pointed every round at the away club would pass
    // both tests above and be exactly as wrong.
    await freezeRoundHandicaps(eventId, homeRoundId);
    const row = await prisma.roundHandicap.findFirst({
      where: { eventId, stageId: homeRoundId, playerId },
      select: { frozen: true },
    });
    expect(row?.frozen).toBe(playsOff(HOST));
  });
});
