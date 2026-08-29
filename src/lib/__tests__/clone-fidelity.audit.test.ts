import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A copied tournament is the same tournament.
 *
 * From the 2026-08-27 exploratory audit. `CLONED_EVENT_FIELDS` declares 43
 * fields worth carrying and `cloneEvent` kept its own hand-written list that
 * wrote 30 of them. The thirteen it dropped all have NON-NEUTRAL schema
 * defaults, so the copy came back configured as something else rather than
 * obviously blank:
 *
 *   shape          "series"     — a copied knockout returned as a league
 *   bracketMode    "split"      — a club's plate reverted
 *   sideStyle      "individual" — a pairs member-guest lost its pairs
 *   attendanceMode "everyone"   — an opt-in league entered the whole roster
 *   maxPerMatch    0            — a per-match cap became uncapped
 *   playPts        0            — the league's appearance point vanished
 *
 * The Stage loop had the same gap with no policy at all behind it: it copied
 * four cut fields and not `cutScope`, so a per-flight cut became an overall one
 * and a different set of players advanced.
 *
 * The organizer's stated reason to clone is "the organizer's own proven setup".
 * They got a tournament that looked configured and scored differently.
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
import { cloneEvent } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CLONE";

let sourceId = "";
let copyId = "";
let teeId = "";
let courseId = "";

/**
 * Every setting the copy used to lose, each set to something that is NOT its
 * schema default — otherwise a dropped field and a copied one look identical.
 */
const CHOSEN = {
  shape: "knockout",
  bracketMode: "plate",
  sideStyle: "pairs",
  moneyMode: "split",
  attendanceMode: "optin",
  courseMode: "open",
  requirePhone: true,
  attestBy: "marker",
  playPts: 1,
  maxPerMatch: 3,
  matchTiebreakers: "sudden-death",
} as const;

const STAGE_CHOSEN = {
  cutScope: "flight",
  handicapAllowance: 60,
  countBest: 2,
} as const;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });

  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(new Array(18).fill(4)),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  courseId = course.id;
  const tee = await prisma.tee.create({
    data: { courseId, name: `${TAG} blues`, courseRating: 72, slopeRating: 130, par: 72, position: 0 },
  });
  teeId = tee.id;

  const source = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} member-guest`,
      dates: "12-14 June",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "1 June",
      shareToken: `${TAG}-src-${process.pid}`,
      courseId,
      defaultTeeId: teeId,
      ...CHOSEN,
    },
  });
  sourceId = source.id;
  await prisma.eventCourse.create({ data: { eventId: sourceId, courseId } });

  await prisma.stage.create({
    data: {
      eventId: sourceId,
      position: 0,
      type: "Stroke Play Round",
      format: "Greensomes",
      holes: 18,
      cutEnabled: true,
      cutMode: "count",
      cutCount: 8,
      allowanceWeights: [60, 40],
      ...STAGE_CHOSEN,
    },
  });

  const user = await prisma.user.create({
    data: { email: `${TAG}.boss@example.invalid`.toLowerCase(), name: "boss", password: "x" },
  });
  await prisma.account.create({
    data: { eventId: sourceId, email: `${TAG}.boss@example.invalid`.toLowerCase(), name: "boss", role: "admin" },
  });

  jar.clear();
  await createSession(user.id);
  await setActiveEvent(sourceId);

  const res = await cloneEvent(sourceId, `${TAG} member-guest 2027`);
  expect(res.ok, res.error ?? "clone should succeed").toBe(true);

  const copy = await prisma.event.findFirstOrThrow({
    where: { name: `${TAG} member-guest 2027` },
  });
  copyId = copy.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the settings that decide what kind of tournament it is", () => {
  for (const [field, value] of Object.entries(CHOSEN)) {
    it(`carries ${field}`, async () => {
      const copy = await prisma.event.findUniqueOrThrow({ where: { id: copyId } });
      expect((copy as unknown as Record<string, unknown>)[field]).toBe(value);
    });
  }

  it("carries the catalogued venue, not just its name", async () => {
    // The copy kept the venue NAME and dropped the id, so the two disagreed —
    // the exact split the schema says "cannot disagree".
    const copy = await prisma.event.findUniqueOrThrow({ where: { id: copyId } });
    expect(copy.courseId).toBe(courseId);
    expect(copy.course).toBe(`${TAG} links`);
  });

  it("carries the round's default tees", async () => {
    // Without it the copy silently falls back to whichever tee sorts first by
    // position — "the exact wrongness this column was added to end".
    const copy = await prisma.event.findUniqueOrThrow({ where: { id: copyId } });
    expect(copy.defaultTeeId).toBe(teeId);
  });
});

describe("what a copy must still decide for itself", () => {
  it("starts with no dates and no deadline", async () => {
    const copy = await prisma.event.findUniqueOrThrow({ where: { id: copyId } });
    expect(copy.dates).toBe("");
    expect(copy.regDeadline).toBe("");
  });

  it("starts as a draft with its own share token", async () => {
    const copy = await prisma.event.findUniqueOrThrow({ where: { id: copyId } });
    const source = await prisma.event.findUniqueOrThrow({ where: { id: sourceId } });
    expect(copy.status).toBe("draft");
    expect(copy.shareToken).not.toBe(source.shareToken);
    expect(copy.shareToken.length).toBeGreaterThan(0);
  });

  it("carries no players, matches or scores", async () => {
    expect(await prisma.player.count({ where: { eventId: copyId } })).toBe(0);
    expect(await prisma.match.count({ where: { eventId: copyId } })).toBe(0);
    expect(await prisma.scorecard.count({ where: { eventId: copyId } })).toBe(0);
  });
});

describe("each copied round", () => {
  it("keeps the cut the committee actually set", async () => {
    // Four cut fields were copied and `cutScope` was not, so a per-flight cut
    // became an overall one and a different set of players advanced.
    const round = await prisma.stage.findFirstOrThrow({ where: { eventId: copyId } });
    expect(round.cutScope).toBe(STAGE_CHOSEN.cutScope);
    expect(round.cutEnabled).toBe(true);
    expect(round.cutMode).toBe("count");
    expect(round.cutCount).toBe(8);
  });

  it("keeps the committee's own handicap arithmetic", async () => {
    const round = await prisma.stage.findFirstOrThrow({ where: { eventId: copyId } });
    expect(round.handicapAllowance).toBe(STAGE_CHOSEN.handicapAllowance);
    expect(round.countBest).toBe(STAGE_CHOSEN.countBest);
    expect(round.allowanceWeights).toEqual([60, 40]);
  });

  it("still starts with no deadline and no Round Code", async () => {
    const round = await prisma.stage.findFirstOrThrow({ where: { eventId: copyId } });
    expect(round.deadline).toBe("");
    expect(round.accessCode).toBe("");
  });
});
