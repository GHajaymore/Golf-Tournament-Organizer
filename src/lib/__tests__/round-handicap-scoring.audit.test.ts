import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/** One browser's cookie jar, so a console session round-trips for real. */
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
import { saveMatchScorecard } from "@/app/actions/tournament";
import { teamsForStage } from "@/lib/services/teams";

/**
 * The scoring paths that build their own handicaps, and therefore have to be
 * told about the round's.
 *
 * `loadEventState` routes the stroke board through one resolver. Net match
 * play, the team engines and the net importer each convert their own — so each
 * is a place where an organizer sets an override, is shown that it saved, and
 * the round is scored off the roster anyway. That failure is silent: the
 * numbers all look reasonable.
 *
 * Rated tees on purpose. An unrated course leaves a Course Handicap equal to
 * the index, which is what let a whole class of unit-mismatch bug through the
 * suite for a year.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/round-handicap-scoring.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROUND-HCP-SCORING";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let orgId = "";
let eventId = "";
let stageId = "";
let matchId = "";
let aId = "";
let bId = "";
let organizerId = "";
let teeId = "";

/** Eighteen fives, so both cards are identical and only the shots can decide. */
const CARD = JSON.stringify(new Array(18).fill(5));

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} club championship`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  eventId = event.id;

  // A rated course, attached to this tournament, so an index is not a Course
  // Handicap. Slope 144 off a par-72 card: a scratch player still plays off
  // scratch, which keeps the arithmetic below about the OVERRIDE.
  const course = await prisma.course.create({
    data: {
      organizationId: orgId,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(new Array(18).fill(4)),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });
  const tee = await prisma.tee.create({
    data: { courseId: course.id, name: "Blue", position: 0, courseRating: 72, slopeRating: 144, par: 72 },
  });
  teeId = tee.id;

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Match Play",
      // Net, or no handicap is consulted at all.
      scoringBasis: "net",
      holes: 18,
      handicapAllowance: 100,
    },
  });
  stageId = stage.id;
  const group = await prisma.group.create({ data: { eventId, name: `${TAG} flight`, position: 0 } });

  const [a, b] = await Promise.all([
    prisma.player.create({
      data: { eventId, name: `${TAG} Ainsley`, seed: 1, status: "confirmed", handicap: 0, teeId },
    }),
    prisma.player.create({
      data: { eventId, name: `${TAG} Brody`, seed: 2, status: "confirmed", handicap: 0, teeId },
    }),
  ]);
  aId = a.id;
  bId = b.id;

  const match = await prisma.match.create({
    data: {
      eventId,
      stageId,
      groupId: group.id,
      round: 1,
      playerAId: aId,
      playerBId: bId,
      holes: JSON.stringify(new Array(18).fill(null)),
    },
  });
  matchId = match.id;

  const user = await prisma.user.create({
    data: { email: at("organizer"), name: "Organizer", password: "x" },
  });
  organizerId = user.id;
  await prisma.account.create({
    data: { eventId, email: at("organizer"), name: "Organizer", role: "admin" },
  });

  jar.clear();
  await createSession(organizerId);
  // createSession clears the active-event cookie, so this comes second.
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** Wipe the round back to "not played", so each case starts before the freeze. */
async function resetRound() {
  await prisma.matchScorecard.deleteMany({ where: { matchId } });
  await prisma.roundHandicap.deleteMany({ where: { eventId, stageId } });
  await prisma.match.update({
    where: { id: matchId },
    data: { holes: JSON.stringify(new Array(18).fill(null)) },
  });
}

async function playBothCards() {
  await saveMatchScorecard(matchId, "A", JSON.parse(CARD));
  await saveMatchScorecard(matchId, "B", JSON.parse(CARD));
  const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  return JSON.parse(m.holes) as (string | null)[];
}

describe("a net match is priced off the round", () => {
  it("halves every hole when two equal players return equal cards", async () => {
    await resetRound();
    const holes = await playBothCards();
    expect(holes.filter((h) => h === "H")).toHaveLength(18);
  });

  it("gives the shots the round's override says, not the roster's", async () => {
    // The case the requirement is about. Nothing on the roster changes: the
    // committee has said what Brody plays off in THIS round, and a shot a hole
    // wins him every hole against an identical card.
    await resetRound();
    await prisma.roundHandicap.create({
      data: { eventId, stageId, playerId: bId, override: 18 },
    });

    const holes = await playBothCards();
    expect(holes.filter((h) => h === "B")).toHaveLength(18);
  });

  it("freezes the round at the override, so a later roster change cannot move it", async () => {
    await resetRound();
    await prisma.roundHandicap.create({
      data: { eventId, stageId, playerId: bId, override: 18 },
    });
    await playBothCards();

    const frozen = await prisma.roundHandicap.findFirstOrThrow({
      where: { eventId, stageId, playerId: bId },
    });
    expect(frozen.frozen).toBe(18);
    expect(frozen.frozenAt).not.toBeNull();

    // Both players cut to plus figures afterwards. The round has been played.
    await prisma.player.updateMany({ where: { eventId }, data: { handicap: -2 } });
    const holes = await playBothCards();
    expect(holes.filter((h) => h === "B")).toHaveLength(18);

    await prisma.player.updateMany({ where: { eventId }, data: { handicap: 0 } });
  });
});

describe("a team side is priced off the round too", () => {
  it("shows the side the handicap the round says, converted for its tees", async () => {
    await resetRound();
    const team = await prisma.team.create({
      data: { eventId, stageId, name: `${TAG} pair`, seed: 1 },
    });
    await prisma.teamMember.createMany({
      data: [
        { teamId: team.id, playerId: aId, position: 0 },
        { teamId: team.id, playerId: bId, position: 1 },
      ],
    });
    await prisma.roundHandicap.create({
      data: { eventId, stageId, playerId: aId, override: 12 },
    });

    const [view] = await teamsForStage(eventId, stageId, "Four-Ball", 100, 18);
    const ainsley = view.members.find((m) => m.playerId === aId);
    const brody = view.members.find((m) => m.playerId === bId);

    // The override, as a Course Handicap — the same unit the tee conversion
    // produces for his partner, who has no override.
    expect(ainsley?.handicap).toBe(12);
    expect(brody?.handicap).toBe(0);

    await prisma.team.deleteMany({ where: { eventId } });
  });
});
