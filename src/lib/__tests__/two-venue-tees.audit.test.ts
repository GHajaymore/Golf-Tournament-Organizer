import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { playingHandicapFrom } from "../domain/handicap";

/**
 * A TOURNAMENT PLAYED OVER TWO CLUBS IS SCORED OFF EACH CLUB'S OWN TEES.
 *
 * The COURSE has walked match -> round -> event since the venue library was
 * built; the tees had no such chain. They were a single `Event.defaultTeeId`
 * with a flight and a player layered over it, and `roundTeeId` filled the gap
 * with the first tee by POSITION — across every venue, because `teesForEvent`
 * gathers them course by course.
 *
 * So a two-day member-guest at two clubs scored day two off day ONE's slope
 * and course rating. A real number, from the wrong course, and until #348 the
 * card did not even name the set it claimed to use.
 *
 * Asserted against real rows because that is the only place it is provable:
 * `teesForEvent`'s ordering, `Stage.courseId`, and the resolution in
 * `loadEventState` are three separate pieces and the bug lived between them.
 *
 * The two venues are rated far enough apart that one stroke cannot be a
 * rounding accident — and the test asserts they differ before asserting
 * anything else, so a fixture that accidentally converged could not pass
 * vacuously.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TWOVENUE";

let eventId = "";
let dayOneId = "";
let dayTwoId = "";
let playerId = "";

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/** The host club, whose tees sort FIRST and used to price both rounds. */
const HOST = { courseRating: 74.9, slopeRating: 144, par: 72 };
/** The away club, a far gentler course. */
const AWAY = { courseRating: 68.2, slopeRating: 105, par: 72 };
/**
 * A SECOND SET AT THE AWAY CLUB, so that naming a TEE is distinguishable from
 * naming only a COURSE.
 *
 * Without it the away club has one set, `defaultTeeFor` falls back to it, and
 * the match test below would pass off `Match.courseId` alone — proving nothing
 * about `Match.teeId`, the column it exists to show has a reader. Rated between
 * the other two, so a wrong answer is a different number from either of them.
 */
const AWAY_MEDAL = { courseRating: 71.5, slopeRating: 126, par: 72 };

const INDEX = 12;

/** WHS: Course Handicap = Index x Slope/113 + (CR - par), rounded. */
const playsOff = (t: { courseRating: number; slopeRating: number; par: number }) =>
  Math.round(INDEX * (t.slopeRating / 113) + (t.courseRating - t.par));

/** Stroke Play's 95% is already applied by `strokeHandicapFor`. */
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
       * NOTHING CONFIGURED, deliberately — `defaultTeeId` stays null. This is
       * the case the bug lived in and the commonest state there is: a club
       * that never opened the tee setting. The fallback is then the only rule
       * deciding how the whole field is priced.
       */
    },
  });
  eventId = event.id;
  await prisma.eventCourse.createMany({
    data: [
      { eventId, courseId: host.id },
      { eventId, courseId: away.id },
    ],
  });

  /**
   * Position 0 on BOTH courses. That is the point: `teesForEvent` orders by
   * course and then position, so the host's set sorts first overall and used
   * to win for every round regardless of where it was played.
   */
  await Promise.all([
    prisma.tee.create({ data: { courseId: host.id, name: `${TAG} host white`, ...HOST, position: 0 } }),
    prisma.tee.create({ data: { courseId: away.id, name: `${TAG} away white`, ...AWAY, position: 0 } }),
    // Position 1 and a later name, so `defaultTeeFor` still picks the white set
    // for a round that names only the course. Only a match naming THIS id
    // reaches it.
    prisma.tee.create({ data: { courseId: away.id, name: `${TAG} away medal`, ...AWAY_MEDAL, position: 1 } }),
  ]);

  const [d1, d2] = await Promise.all([
    prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, courseId: host.id },
    }),
    prisma.stage.create({
      // Day two is AT THE AWAY CLUB, which the round has always been able to say.
      data: { eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18, courseId: away.id },
    }),
  ]);
  dayOneId = d1.id;
  dayTwoId = d2.id;

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

describe("the two venues really are different", () => {
  it("separates them by more than a rounding accident", () => {
    // Without this every assertion below could pass on a fixture whose two
    // courses happen to price the same index identically.
    expect(playsOff(HOST)).toBeGreaterThan(playsOff(AWAY) + 5);
  });
});

describe("a round is priced off the tees of the course it is played on", () => {
  it("prices day one off the host club", async () => {
    const state = await loadEventState(eventId);
    expect(state).not.toBeNull();
    expect(state!.strokeHandicapFor(playerId, dayOneId)).toBe(playing(HOST));
  });

  it("prices day two off the AWAY club, not the host's", async () => {
    /**
     * THE DEFECT, STATED AS A NUMBER. Before `teeForPlay` this returned
     * `playing(HOST)` — the host's 144 slope and 74.9 rating applied to a
     * round played at a course rated 105 and 68.2. Measured by reverting the
     * fix against this fixture: **17 strokes where 7 is right**, on a card
     * that named no tee at all.
     */
    const state = await loadEventState(eventId);
    expect(state!.strokeHandicapFor(playerId, dayTwoId)).toBe(playing(AWAY));
  });

  it("gives the two rounds different numbers, which is the whole point", async () => {
    // Asserted separately from the values: if a later change made both rounds
    // resolve the same way again, the two tests above could both be updated to
    // match and this one would still say the tournament had stopped
    // distinguishing its venues.
    const state = await loadEventState(eventId);
    expect(state!.strokeHandicapFor(playerId, dayOneId)).not.toBe(
      state!.strokeHandicapFor(playerId, dayTwoId),
    );
  });

  it("ignores a player's own set when it belongs to another course", async () => {
    /**
     * `Player.teeId` POINTS AT ONE COURSE'S TEE, and a tournament can be
     * played on several.
     *
     * A stored preference is how a club records "he plays off the whites", and
     * `teeIdFor` honours it above the round's — correctly, because mixed tees
     * are the case that makes the whole conversion necessary. But the id names
     * a row on ONE course, so the moment the tournament moves to another venue
     * that preference is not merely stale, it is a rating from somewhere else:
     * the player is priced off the host club's slope on a card played at the
     * away club, while everybody without a stored tee is priced correctly.
     *
     * The fix is the rule `teeForPlay` already applies to the round's own
     * chain — a rung that is not on the course being played is stepped past,
     * not honoured — so this falls through to the round's set, which is what
     * the rest of the field is on.
     */
    const hostTee = await prisma.tee.findFirst({
      where: { course: { name: `${TAG} host` } },
      select: { id: true },
    });
    await prisma.player.update({ where: { id: playerId }, data: { teeId: hostTee!.id } });
    try {
      const state = await loadEventState(eventId);
      // Day one IS at the host club, so the stored set is right there and wins.
      expect(state!.strokeHandicapFor(playerId, dayOneId)).toBe(playing(HOST));
      // Day two is at the away club. The host's set is not on it.
      expect(
        state!.strokeHandicapFor(playerId, dayTwoId),
        "a stored tee from another course priced this round",
      ).toBe(playing(AWAY));
    } finally {
      await prisma.player.update({ where: { id: playerId }, data: { teeId: null } });
    }
  });

  it("lets a MATCH name its own set, which is what an open course needs", async () => {
    /**
     * `Match.teeId` with a live reader, which is the whole point of adding it.
     *
     * In a league with no fixed venue a pair says where they played at scoring
     * time, and `nameMatchVenue` has always asked which tees — validated them,
     * created the row, and then pointed nothing at it. A column with no reader
     * is the same defect in a different place, so this asserts the number
     * actually moves.
     *
     * The match is on DAY ONE, at the host club, and names the away club's
     * gentler set. Nothing else on that round changes, so a wrong answer here
     * cannot be a round-level effect leaking in.
     */
    const away = await prisma.course.findFirst({ where: { name: `${TAG} away` }, select: { id: true } });
    /**
     * THE MEDAL SET, NOT THE WHITE ONE — and the choice is the whole proof.
     *
     * The away club has two sets and `defaultTeeFor` picks the white. So an
     * assertion against the white set's number would be satisfied by
     * `Match.courseId` alone, and would go on passing with `Match.teeId` unread
     * by anything. Naming the set the fallback does NOT pick is the only version
     * of this test that can fail if the column loses its reader again.
     */
    const awayTee = await prisma.tee.findFirst({
      where: { courseId: away!.id, name: `${TAG} away medal` },
      select: { id: true },
    });
    const group = await prisma.group.create({
      data: { eventId, name: `${TAG} flight`, position: 0 },
    });
    const match = await prisma.match.create({
      data: {
        eventId,
        stageId: dayOneId,
        groupId: group.id,
        round: 1,
        playerAId: playerId,
        playerBId: playerId,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    });
    try {
      const before = await loadEventState(eventId);
      // Untouched, it is its round's answer — the host club.
      expect(before!.matchHandicapFor(playerId, match.id)).toBe(playing(HOST));

      /**
       * COURSE AND TEE TOGETHER, because that is the only row the app can
       * write. This set `teeId` alone, which encoded a match claiming the host
       * club's course and the away club's tees — and `nameMatchVenue`, the one
       * writer of `Match.teeId` in the app, cannot produce it: it scopes the tee
       * to the course it is recording (`{ id: input.teeId, courseId }`, refused
       * with "Those tees aren't on that course") and writes `courseId` on the
       * same update every time.
       *
       * It mattered once `teeForPlay` started stepping past a rung that is not
       * at the course being played — the rule its own paragraph always promised.
       * With no `Match.courseId` the course resolves to the ROUND's, the host
       * club, and the away tees are then correctly refused. The fixture was
       * asserting behaviour on a match that cannot happen, which is the trap
       * CLAUDE.md names in those words.
       */
      await prisma.match.update({
        where: { id: match.id },
        data: { courseId: away!.id, teeId: awayTee!.id },
      });
      const after = await loadEventState(eventId);
      expect(
        after!.matchHandicapFor(playerId, match.id),
        "the match's own set was not read — this is the away club's DEFAULT set's number",
      ).toBe(playing(AWAY_MEDAL));
      // And it is a different number from the one the course alone would give,
      // which is what makes the assertion above about `teeId` rather than
      // `courseId`.
      expect(playing(AWAY_MEDAL)).not.toBe(playing(AWAY));

      // And the ROUND is unmoved by one pairing saying where it went.
      expect(after!.strokeHandicapFor(playerId, dayOneId)).toBe(playing(HOST));
    } finally {
      await prisma.match.delete({ where: { id: match.id } });
      await prisma.group.delete({ where: { id: group.id } });
    }
  });

  /**
   * THERE IS NO TEST HERE FOR `setStageCourse` REFUSING A TEE FROM ANOTHER
   * COURSE, and that is a stated gap rather than an oversight.
   *
   * One was written and removed. This fixture has no Account and no User, so
   * `requireOrganizerOrg` refuses before the scope check is ever reached — the
   * assertion went green on `ok: false` for authorization, which is the exact
   * shape of a test that passes for the wrong reason. Giving the fixture a
   * signed-in organizer is the honest fix and belongs with the other
   * session-mocked audits rather than bolted onto a handicap fixture.
   *
   * What IS covered: `teeForPlay` steps past a tee that is not in the
   * tournament's list, over a fixture where every rung is a different set
   * (`tee-follows-the-course.test.ts`). So a bad id cannot price a card even
   * if one were stored; the untested part is whether the write is refused at
   * the door.
   */
  it("lets a round name its own set, overriding the course's first", async () => {
    /**
     * `Stage.teeId` — the round's own answer, which is what a medal off the
     * whites needs when the club's first set is the blues. Set here rather
     * than in the fixture so the tests above prove the FALLBACK on its own.
     */
    const back = await prisma.tee.create({
      data: {
        courseId: (await prisma.stage.findUnique({ where: { id: dayTwoId }, select: { courseId: true } }))!
          .courseId!,
        name: `${TAG} away back`,
        ...HOST,
        position: 9,
      },
    });
    await prisma.stage.update({ where: { id: dayTwoId }, data: { teeId: back.id } });
    try {
      const state = await loadEventState(eventId);
      expect(state!.strokeHandicapFor(playerId, dayTwoId)).toBe(playing(HOST));
    } finally {
      await prisma.stage.update({ where: { id: dayTwoId }, data: { teeId: null } });
      await prisma.tee.delete({ where: { id: back.id } });
    }
  });
});
