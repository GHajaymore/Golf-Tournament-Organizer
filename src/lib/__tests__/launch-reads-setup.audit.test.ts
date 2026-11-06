import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

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

/**
 * LAUNCH READS SETUP (gap G3, 2026-10-31), against real rows.
 *
 *   scramble    played in sides, players entered, no sides: refused in the panel's
 *               words, still in draft — and the dashboard's verdict is the same words
 *   sided       the same scramble with its sides made: launches
 *   medal       an ordinary dated medal with a field: launches, with its warnings
 *               (no tee sheet, no money answer) never stopping it
 *   (the staff gate in front of all of it is pinned in launch-facts-built-once.test.ts)
 *
 * Real rows in the development database, under a ZZ mark, deleted afterwards.
 */
import { createSession, setActiveEvent } from "@/lib/auth";
import { launchTournament } from "@/app/actions/tournament";
import { launchCheckFor } from "@/lib/services/setup-flow";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LAUNCH-SETUP";
const PARS = JSON.stringify(new Array(18).fill(4));
const SI = JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1));
const NO_SIDES =
  "This tournament is played in sides and none are made yet, so its team rounds cannot be scored. Make the sides on Teams & pairs, then launch.";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

let orgId = "";
let userId = "";

async function tournament(name: string, format: "Scramble" | "Stroke Play", admin = true) {
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} ${name}`,
      organizationId: orgId,
      status: "draft",
      format: "stroke",
      dates: "14–15 Nov 2026",
      course: `${TAG} home`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-share`,
      customPars: PARS,
      customStrokeIndex: SI,
      customYards: JSON.stringify(new Array(18).fill(400)),
    },
    select: { id: true },
  });
  await prisma.stage.create({
    data: { eventId: ev.id, position: 0, description: "Round 1", type: "Stroke Play Round", format, holes: 18, scoringBasis: "gross" },
  });
  const players: string[] = [];
  for (const n of [1, 2, 3, 4]) {
    const p = await prisma.player.create({
      data: { eventId: ev.id, name: `${TAG} player ${n}`, email: `${TAG.toLowerCase()}-${name}-${n}@example.invalid`, status: "confirmed", handicap: 10, seed: n },
      select: { id: true },
    });
    players.push(p.id);
  }
  if (admin) {
    await prisma.account.create({ data: { eventId: ev.id, name: `${TAG} Admin`, email: `${TAG.toLowerCase()}-admin@example.invalid`, role: "admin" } });
  }
  return { eventId: ev.id, players };
}

const statusOf = async (eventId: string) => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status;

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } })).id;
  userId = (
    await prisma.user.create({
      data: { email: `${TAG.toLowerCase()}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable", emailVerifiedAt: new Date() },
      select: { id: true },
    })
  ).id;
  await createSession(userId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("launch reads setup", () => {
  it("refuses a scramble with players and no sides, in the button's words, and stays in draft", async () => {
    const { eventId } = await tournament("scramble", "Scramble");
    await setActiveEvent(eventId);
    expect(await launchTournament()).toEqual({ ok: false, error: NO_SIDES });
    expect(await statusOf(eventId)).toBe("draft");
    // The dashboard's button asks the same function, so it says the same thing.
    expect((await launchCheckFor(eventId)).refusal).toBe(NO_SIDES);
  });

  it("launches the same scramble once its sides are made", async () => {
    const { eventId, players } = await tournament("sided", "Scramble");
    for (const [i, pair] of [players.slice(0, 2), players.slice(2)].entries()) {
      await prisma.team.create({
        data: { eventId, name: `${TAG} side ${i + 1}`, members: { create: pair.map((playerId) => ({ playerId })) } },
      });
    }
    await setActiveEvent(eventId);
    expect(await launchTournament()).toEqual({ ok: true });
    expect(await statusOf(eventId)).toBe("live");
  });

  it("launches an ordinary medal, and what it only warns about never stops it", async () => {
    const { eventId } = await tournament("medal", "Stroke Play");
    await setActiveEvent(eventId);
    const check = await launchCheckFor(eventId);
    expect(check.refusal).toBeNull();
    // No tee sheet saved and no flights: said, not refused.
    expect(check.warnings.map((w) => w.href)).toEqual(expect.arrayContaining(["/grouping", "/foursomes"]));
    expect(await launchTournament()).toEqual({ ok: true });
    expect(await statusOf(eventId)).toBe("live");
  });

  it("warns, and still launches, a net medal on a tee with no rating (setup audit item 5)", async () => {
    const { eventId } = await tournament("unrated", "Stroke Play");
    await prisma.stage.updateMany({ where: { eventId }, data: { scoringBasis: "net" } });
    const course = await prisma.course.create({
      data: { organizationId: orgId, name: `${TAG} unrated course`, city: "", pars: PARS, yards: JSON.stringify(new Array(18).fill(400)), strokeIndex: SI },
    });
    await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });
    await prisma.tee.create({ data: { courseId: course.id, name: "Zz White", courseRating: 0, slopeRating: 0, par: 72, position: 0 } });
    await setActiveEvent(eventId);
    const check = await launchCheckFor(eventId);
    expect(check.refusal, "an unrated tee must never refuse a launch").toBeNull();
    const w = check.warnings.find((x) => /Slope/.test(x.says));
    expect(w?.says, "launch said nothing about the unrated tee").toContain("Zz White");
    expect(w?.says).toContain("Round 1");

    // CONTROL: rate the tee and the warning goes.
    await prisma.tee.updateMany({ where: { courseId: course.id }, data: { courseRating: 71.2, slopeRating: 128 } });
    const rated = await launchCheckFor(eventId);
    expect(rated.warnings.some((x) => /Slope/.test(x.says))).toBe(false);

    await prisma.tee.updateMany({ where: { courseId: course.id }, data: { courseRating: 0, slopeRating: 0 } });
    expect(await launchTournament()).toEqual({ ok: true });
    await prisma.eventCourse.deleteMany({ where: { eventId } });
    await prisma.course.delete({ where: { id: course.id } });
  });
});
