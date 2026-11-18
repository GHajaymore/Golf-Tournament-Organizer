import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * "GENERATE MATCHES" ON A TEAM ROUND IS ALL OR NOTHING.
 *
 * `generateTeamMatches` removes the round's old matches, finds or makes the
 * round's carrier group and writes one match per pairing. Those were separate
 * writes, so a failure part-way left a part-drawn round robin (or no matches at
 * all where there had been some). They are one transaction now.
 *
 * The failure is forced the way a real one arrives, from the database: a
 * trigger refuses the FOURTH pairing of a four-side round robin (six matches).
 * Pressed as an Admin, the press must throw and leave the round exactly as it
 * was: the first draw's six matches still there, no carrier made by the attempt.
 * The control: with the trigger gone the same press draws all six.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { generateTeamMatches } from "@/app/actions/teams";
import { roundRobinSchedule } from "@/lib/domain";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ATOMIC-MATCHES";
const EMAIL = `${TAG.toLowerCase()}-admin@example.invalid`;
const TRIGGER = "zz_atomic_matches_refuse";

let eventId = "";
let stageA = "";
let stageB = "";
const sideIds: string[] = [];

async function dropTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRIGGER} ON "Match"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TRIGGER}()`);
}

/** Refuse the fourth pairing of the schedule, for any round of this event. */
async function refuseFourthPairing() {
  const fourth = roundRobinSchedule(sideIds)[3];
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${TRIGGER}() RETURNS trigger AS $$ BEGIN
       IF NEW."teamAId" = '${fourth.aId}' AND NEW."teamBId" = '${fourth.bId}' THEN
         RAISE EXCEPTION 'zz refused the fourth pairing';
       END IF;
       RETURN NEW;
     END $$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${TRIGGER} BEFORE INSERT ON "Match" FOR EACH ROW EXECUTE FUNCTION ${TRIGGER}()`,
  );
}

beforeAll(async () => {
  await dropTrigger();
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  eventId = (
    await prisma.event.create({
      data: {
        name: `${TAG} invitational`,
        organizationId: org.id,
        status: "draft",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-share`,
      },
      select: { id: true },
    })
  ).id;
  const stage = async (position: number) =>
    (
      await prisma.stage.create({
        data: { eventId, position, type: "Round Robin", format: "Four-Ball", holes: 18 },
        select: { id: true },
      })
    ).id;
  stageA = await stage(0);
  stageB = await stage(1);
  // Event-wide sides (no stageId): both rounds draw from the same four.
  for (let i = 1; i <= 4; i++) {
    sideIds.push(
      (await prisma.team.create({ data: { eventId, name: `${TAG} side ${i}`, seed: i }, select: { id: true } })).id,
    );
  }

  const user = await prisma.user.create({
    data: { email: EMAIL, name: `${TAG} Admin`, password: "x:unusable", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await prisma.account.create({ data: { eventId, name: `${TAG} Admin`, email: EMAIL, role: "admin" } });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await dropTrigger();
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  } finally {
    await prisma.$disconnect();
  }
});

const matchIds = async (stageId: string) =>
  (await prisma.match.findMany({ where: { eventId, stageId }, select: { id: true }, orderBy: { id: "asc" } })).map((m) => m.id);
const carriers = (stageId: string) => prisma.group.count({ where: { eventId, stageId } });

describe("generateTeamMatches is all or nothing", () => {
  it("THE CONTROL: with nothing in the way, four sides draw six matches", async () => {
    expect(await generateTeamMatches(stageA)).toEqual({ ok: true });
    expect(await matchIds(stageA)).toHaveLength(6);
    expect(await carriers(stageA)).toBe(1);
  });

  it("a REPLACE that fails on the fourth pairing leaves the first draw exactly as it was", async () => {
    const before = await matchIds(stageA);
    await refuseFourthPairing();
    try {
      await expect(generateTeamMatches(stageA, true)).rejects.toThrow();
    } finally {
      await dropTrigger();
    }
    expect(await matchIds(stageA), "the old matches were deleted or the new ones part-written").toEqual(before);
    expect(await carriers(stageA)).toBe(1);
  });

  it("a FIRST draw that fails on the fourth pairing leaves no matches and no carrier behind", async () => {
    await refuseFourthPairing();
    try {
      await expect(generateTeamMatches(stageB)).rejects.toThrow();
    } finally {
      await dropTrigger();
    }
    expect(await matchIds(stageB), "a part-drawn round robin was left").toEqual([]);
    expect(await carriers(stageB), "a carrier group was left by the failed attempt").toBe(0);
  });

  it("THE CONTROL AGAIN: the trigger gone, the same press draws all six", async () => {
    expect(await generateTeamMatches(stageB)).toEqual({ ok: true });
    expect(await matchIds(stageB)).toHaveLength(6);
  });
});
