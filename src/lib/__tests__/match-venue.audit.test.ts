import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A player cannot repoint somebody else's match at another course.
 *
 * S5 of the 2026-08-12 audit. `setMatchCourse` checked that the caller could
 * enter scores SOMEWHERE in the tournament and then wrote the venue of any
 * match id it was handed — while its sibling `nameMatchVenue`, which writes
 * the same fields, carried a comment describing this exact attack.
 *
 * It reads as a dropdown and behaves as a score edit: the venue decides the
 * par and the stroke index, and the stroke index decides which holes a player
 * receives shots on. Moving it silently rescores the match.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { setMatchCourse } from "@/app/actions/courses";
import { loadEventState } from "@/lib/services/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-VENUE";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let eventId = "";
let orgId = "";
let stageId = "";
let groupId = "";
let theirMatchId = "";
let myMatchId = "";
let awayCourseId = "";
const player: Record<string, string> = {};
const userIds: Record<string, string> = {};

async function signIn(who: string) {
  jar.clear();
  await createSession(userIds[who]);
  await setActiveEvent(eventId);
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} league`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      // Players report their own scores — the configuration this is reachable
      // in, and an ordinary one for a league.
      scoreEntryBy: "players",
      playerAccess: "email",
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;

  const away = await prisma.course.create({
    data: {
      organizationId: orgId,
      name: `${TAG} away links`,
      city: "",
      pars: JSON.stringify(new Array(18).fill(4)),
      yards: JSON.stringify(new Array(18).fill(400)),
      // The stroke index REVERSED — the same eighteen holes, every shot
      // allocated somewhere else.
      strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => 18 - i)),
    },
  });
  awayCourseId = away.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: awayCourseId } });

  const [stage, group] = await Promise.all([
    prisma.stage.create({ data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 } }),
    prisma.group.create({ data: { eventId, name: `${TAG} flight`, position: 0 } }),
  ]);
  stageId = stage.id;
  groupId = group.id;

  for (const [i, who] of ["meddler", "ann", "rob", "sam"].entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    const u = await prisma.user.create({ data: { email: at(who), name: who, password: "x", emailVerifiedAt: new Date() } });
    userIds[who] = u.id;
    await prisma.account.create({ data: { eventId, email: at(who), name: who, role: "player" } });
  }

  // A match between two OTHER players, and one the meddler is actually in.
  const [theirs, mine] = await Promise.all([
    prisma.match.create({
      data: { eventId, stageId, groupId, round: 1, playerAId: player.ann, playerBId: player.rob, holes: "[]" },
    }),
    prisma.match.create({
      data: { eventId, stageId, groupId, round: 1, playerAId: player.meddler, playerBId: player.sam, holes: "[]" },
    }),
  ]);
  theirMatchId = theirs.id;
  myMatchId = mine.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("somebody else's match", () => {
  it("refuses to move it to another course", async () => {
    await signIn("meddler");
    const res = await setMatchCourse(theirMatchId, awayCourseId);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/isn't your match/i);
  });

  it("leaves the venue exactly as it was", async () => {
    // The refusal has to be a refusal. A match left pointing at the away card
    // would be scored against a reversed stroke index, which moves every
    // handicap stroke in it to a different hole.
    const m = await prisma.match.findUniqueOrThrow({ where: { id: theirMatchId } });
    expect(m.courseId).toBeNull();
    expect(m.nine).toBe("full");
  });

  it("refuses to change which nine they played, too", async () => {
    // The same write by another name: front and back have different stroke
    // indexes, so this is the same rescoring through a smaller door.
    await signIn("meddler");
    const res = await setMatchCourse(theirMatchId, null, "back");
    expect(res.ok).toBe(false);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: theirMatchId } })).nine).toBe("full");
  });
});

describe("your own match", () => {
  it("can still be pointed at the venue you actually played", async () => {
    // The action's real job. Refusing this would be a different product — a
    // community league where opponents arrange their own venue is exactly why
    // it exists.
    await signIn("meddler");
    const res = await setMatchCourse(myMatchId, awayCourseId);
    expect(res.ok).toBe(true);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: myMatchId } })).courseId).toBe(awayCourseId);
  });

  it("accepts a club course that is not yet a venue, and adds it", () => {
    // The rule this replaced refused anything not already on the tournament,
    // which meant a one-course event could not record that a pairing moved.
    // Adding the venue is the point, not a side effect.
    return (async () => {
      const spare = await prisma.course.create({
        data: {
          organizationId: orgId,
          name: `${TAG} not yet a venue`,
          city: "",
          pars: JSON.stringify(new Array(18).fill(4)),
          yards: JSON.stringify(new Array(18).fill(400)),
          strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
        },
      });
      await signIn("meddler");
      const res = await setMatchCourse(myMatchId, spare.id);
      expect(res.ok).toBe(true);
      const link = await prisma.eventCourse.findFirst({
        where: { eventId, courseId: spare.id },
      });
      expect(link, "choosing it should add it to the tournament").not.toBeNull();
      await prisma.eventCourse.deleteMany({ where: { courseId: spare.id } });
      await prisma.match.update({ where: { id: myMatchId }, data: { courseId: awayCourseId } });
      await prisma.course.delete({ where: { id: spare.id } });
    })();
  });

  it("refuses ANOTHER CLUB'S course, which is the boundary that matters", async () => {
    /**
     * Never covered until now. The only refusal test here used a course in
     * the SAME club, so it was asserting a product rule — one this change
     * deliberately reverses — while the rule that actually protects anything
     * went untested. Pointing a match at another organization's course would
     * score it against a stranger's par and stroke index.
     */
    const otherOrg = await prisma.organization.create({
      data: { name: `${TAG} other club`, kind: "club" },
    });
    const theirs = await prisma.course.create({
      data: {
        organizationId: otherOrg.id,
        name: `${TAG} someone elses`,
        city: "",
        pars: JSON.stringify(new Array(18).fill(4)),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    await signIn("meddler");
    const res = await setMatchCourse(myMatchId, theirs.id);
    expect(res.ok).toBe(false);
    const link = await prisma.eventCourse.findFirst({ where: { eventId, courseId: theirs.id } });
    expect(link, "and it must not be linked either").toBeNull();
    await prisma.course.delete({ where: { id: theirs.id } });
    await prisma.organization.delete({ where: { id: otherOrg.id } });
  });
});

describe("a four-ball partner", () => {
  it("may name the venue of a team match they are in", async () => {
    // The player columns are EMPTY in a team round, so a check that reads only
    // those refuses every partner their own match — which is what the sibling
    // action did before both were put on one team-aware rule.
    const team = await prisma.team.create({
      data: { eventId, stageId, name: `${TAG} side A`, seed: 1 },
    });
    const other = await prisma.team.create({
      data: { eventId, stageId, name: `${TAG} side B`, seed: 2 },
    });
    await prisma.teamMember.create({ data: { teamId: team.id, playerId: player.meddler, position: 0 } });

    const teamMatch = await prisma.match.create({
      data: {
        eventId,
        stageId,
        groupId,
        round: 2,
        playerAId: "",
        playerBId: "",
        teamAId: team.id,
        teamBId: other.id,
        holes: "[]",
      },
    });

    await signIn("meddler");
    expect((await setMatchCourse(teamMatch.id, awayCourseId)).ok).toBe(true);

    // And somebody in neither side still cannot.
    await signIn("ann");
    expect((await setMatchCourse(teamMatch.id, null)).ok).toBe(false);
  });
});

describe("staff", () => {
  it("may point any match anywhere in their tournament", async () => {
    // An organizer sorting out a card is who this action is for, and the
    // player rule must not catch them.
    const user = await prisma.user.create({
      data: { email: at("organizer"), name: "Organizer", password: "x", emailVerifiedAt: new Date() },
    });
    userIds.organizer = user.id;
    await prisma.account.create({
      data: { eventId, email: at("organizer"), name: "Organizer", role: "admin" },
    });

    await signIn("organizer");
    expect((await setMatchCourse(theirMatchId, awayCourseId)).ok).toBe(true);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: theirMatchId } })).courseId).toBe(
      awayCourseId,
    );
  });
});

/**
 * A MATCH'S TEES GO WITH ITS COURSE (QA Director, item 2, 14 Nov).
 *
 * `setMatchCourse` wrote `{ courseId, nine }` and never touched `Match.teeId`.
 * A match named at one course off a set there, then moved, kept that set. At
 * the new course `teeForPlay` steps past it, so the figure there was right and
 * only the row was untrue — but with NO course (an open-course tournament, the
 * venue put back to "Not set") `teeForPlay` lets every rung through, and the old
 * course's set priced a match played nowhere in particular.
 *
 * Worked from Rule 6.1b in whole numbers (an index in tenths, everything over
 * 1130), index 18.4, singles match play at 100% (Appendix C):
 *
 *   Ridge Blue 74.0 / 140 / 72: 18.4 × 140/113 + 2.0 = 24.80 → 25
 *   away Gold  70.0 / 115 / 72: 18.4 × 115/113 − 2.0 = 16.73 → 17
 */
describe("a match's tees go with its course", () => {
  const ch1130 = (index10: number, rating10: number, slope: number, par: number) => index10 * slope + (rating10 - 10 * par) * 113;
  const halfUp = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));
  const OFF_RIDGE = halfUp(ch1130(184, 740, 140, 72), 1130);
  const OFF_AWAY = halfUp(ch1130(184, 700, 115, 72), 1130);
  let ridgeId = "";
  let ridgeBlue = "";
  let awayGold = "";

  const row = async () => prisma.match.findUniqueOrThrow({ where: { id: myMatchId }, select: { courseId: true, teeId: true } });
  const strokes = async () => (await loadEventState(eventId))!.matchHandicapFor(player.meddler, myMatchId);
  /** Where nameMatchVenue leaves a match: at the ridge, off its Blue. */
  const namedAtTheRidge = () => prisma.match.update({ where: { id: myMatchId }, data: { courseId: ridgeId, teeId: ridgeBlue } });

  beforeAll(async () => {
    const ridge = await prisma.course.create({
      data: {
        organizationId: orgId,
        name: `${TAG} ridge`,
        city: "",
        pars: JSON.stringify(new Array(18).fill(4)),
        yards: JSON.stringify(new Array(18).fill(400)),
        strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      },
    });
    ridgeId = ridge.id;
    await prisma.eventCourse.create({ data: { eventId, courseId: ridgeId } });
    ridgeBlue = (await prisma.tee.create({ data: { courseId: ridgeId, name: "Blue", courseRating: 74.0, slopeRating: 140, par: 72 } })).id;
    awayGold = (await prisma.tee.create({ data: { courseId: awayCourseId, name: "Gold", courseRating: 70.0, slopeRating: 115, par: 72 } })).id;
    await prisma.player.update({ where: { id: player.meddler }, data: { handicap: 18.4 } });
  });

  it("the worked figures, by hand: 25 off the ridge's Blue, 17 off the away Gold", () => {
    expect([OFF_RIDGE, OFF_AWAY]).toEqual([25, 17]);
  });

  it("restating the same course keeps the set the match was played from", async () => {
    await namedAtTheRidge();
    await signIn("meddler");
    expect(await setMatchCourse(myMatchId, ridgeId)).toEqual({ ok: true });
    expect(await row()).toEqual({ courseId: ridgeId, teeId: ridgeBlue });
    expect(await strokes()).toBe(OFF_RIDGE);
  });

  it("moved to another course, the old course's set is cleared, and it is priced off the new one's", async () => {
    await namedAtTheRidge();
    await signIn("meddler");
    expect(await setMatchCourse(myMatchId, awayCourseId)).toEqual({ ok: true });
    expect(await row(), "the match kept a set from the course it left").toEqual({ courseId: awayCourseId, teeId: null });
    expect(await strokes()).toBe(OFF_AWAY);
  });

  /**
   * AND WITH A TOURNAMENT AT A HOME COURSE OF ITS OWN (Fable's review of #1159): the round is
   * then at the ridge, off the tournament's White (71.2 / 126: 18.4 x 126/113 - 0.8 = 19.72 -> 20),
   * and a match moved away with no set named fell to the ROUND's map — 20, a set on a course the
   * match is not at, where the away Gold gives 17. The case above cannot see it: with no
   * tournament course the round lands on "any set", which happened to be the Gold.
   */
  it("moved away from a tournament at a home course, it is priced off the away course, not the home White", async () => {
    const OFF_HOME_WHITE = halfUp(ch1130(184, 712, 126, 72), 1130);
    expect(OFF_HOME_WHITE).toBe(20);
    const white = await prisma.tee.create({ data: { courseId: ridgeId, name: "White", courseRating: 71.2, slopeRating: 126, par: 72, position: 1 } });
    await prisma.event.update({ where: { id: eventId }, data: { courseId: ridgeId, defaultTeeId: white.id } });
    try {
      await namedAtTheRidge();
      await signIn("meddler");
      expect(await setMatchCourse(myMatchId, awayCourseId)).toEqual({ ok: true });
      expect(await row()).toEqual({ courseId: awayCourseId, teeId: null });
      const state = await loadEventState(eventId);
      // CONTROL: the round itself is at the ridge, off the tournament's White.
      expect(state!.strokeHandicapFor(player.meddler, stageId)).toBe(OFF_HOME_WHITE);
      expect(state!.matchHandicapFor(player.meddler, myMatchId), "a match at the away course priced off the home set").toBe(OFF_AWAY);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { courseId: null, defaultTeeId: null } });
      await prisma.tee.delete({ where: { id: white.id } });
    }
  });

  it("the open-course edge: venue put back to Not set, the old set no longer prices it", async () => {
    // No event course, no round course: the round prices off the tournament's
    // own set, here the away Gold. A match that still held the ridge's Blue
    // would be priced at 25 off a course it is no longer at.
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { courseId: true } })).courseId).toBeNull();
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { courseId: true } })).courseId).toBeNull();
    await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: awayGold } });
    try {
      await namedAtTheRidge();
      await signIn("meddler");
      expect(await setMatchCourse(myMatchId, null)).toEqual({ ok: true });
      expect(await row()).toEqual({ courseId: null, teeId: null });
      const state = await loadEventState(eventId);
      expect(state!.matchHandicapFor(player.meddler, myMatchId), "the match is priced as its round is").toBe(
        state!.strokeHandicapFor(player.meddler, stageId),
      );
      expect(await strokes()).toBe(OFF_AWAY);
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { defaultTeeId: null } });
      await prisma.match.update({ where: { id: myMatchId }, data: { courseId: awayCourseId, teeId: null } });
    }
  });
});
