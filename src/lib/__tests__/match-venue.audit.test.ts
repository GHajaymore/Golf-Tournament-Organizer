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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { setMatchCourse } from "@/app/actions/courses";

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
    const u = await prisma.user.create({ data: { email: at(who), name: who, password: "x" } });
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
      data: { email: at("organizer"), name: "Organizer", password: "x" },
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
