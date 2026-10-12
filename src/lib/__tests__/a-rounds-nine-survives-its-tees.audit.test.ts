import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND'S NINE SURVIVES HAVING ITS TEES OR ITS VENUE SET (sweep 1, b3, 2026-10-10).
 *
 * A round set to the BACK nine became the front nine — holes 1 to 9, front
 * pars, front stroke index — the moment a member of staff picked its tees, or
 * confirmed its venue, from the score-entry screen. Nothing on that screen
 * mentions the nine.
 *
 * `setStageCourse` takes the nine as its third argument and wrote it every
 * time. The rounds screen sends the round's real nine; the score-entry panel
 * had to send SOMETHING to reach the arguments after it, sent "full", and
 * `applyNine` reads anything that is not "back" as the front. So the two
 * screens that can call this action disagreed about what an unstated nine
 * means, and the one that did not know the answer overwrote it.
 *
 * The action now changes the nine only when it is told one. Which nine a round
 * plays decides the par of every hole and where every handicap stroke falls
 * (Rule 3.3b: a card is returned for the holes played), so it is never a
 * default.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-NINEKEPT";
const EMAIL = `${TAG}.staff@example.invalid`.toLowerCase();
const session = { email: EMAIL, name: `${TAG} staff`, eventId: "", role: "assistant" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { setStageCourse } = await import("@/app/actions/courses");

let stageId = "";
let courseId = "";
let awayId = "";
let whiteId = "";

const eighteen = (n: number) => JSON.stringify(Array.from({ length: 18 }, () => n));

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const course = (name: string) =>
    prisma.course.create({
      data: { organizationId: org.id, name: `${TAG} ${name}`, city: "", pars: eighteen(4), yards: eighteen(380), strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)) },
    });
  courseId = (await course("home")).id;
  awayId = (await course("away")).id;
  whiteId = (await prisma.tee.create({ data: { courseId, name: "White", courseRating: 71.2, slopeRating: 126, par: 72 } })).id;
  const event = await prisma.event.create({
    data: { organizationId: org.id, name: `${TAG} twilight nine`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}` },
  });
  session.eventId = event.id;
  await prisma.account.create({ data: { eventId: event.id, email: EMAIL, name: `${TAG} staff`, role: "assistant" } });
  stageId = (
    await prisma.stage.create({
      data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stableford", holes: 9, nine: "back", courseId },
    })
  ).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const round = async () => prisma.stage.findUnique({ where: { id: stageId }, select: { nine: true, teeId: true, courseId: true } });

describe("setting a round's tees or venue leaves its nine alone", () => {
  it("picking the tees from score entry keeps the back nine", async () => {
    // What the score-entry panel sends: the venue it already has, no nine, the tees.
    const res = await setStageCourse(stageId, courseId, undefined, true, whiteId);
    expect(res.ok).toBe(true);
    expect(await round()).toEqual({ nine: "back", teeId: whiteId, courseId });
  });

  it("confirming a new venue from score entry keeps the back nine", async () => {
    const res = await setStageCourse(stageId, awayId, undefined, true);
    expect(res.ok).toBe(true);
    expect(await round()).toMatchObject({ nine: "back", courseId: awayId });
  });

  it("the plain venue pick, with nothing else said, keeps it too", async () => {
    const res = await setStageCourse(stageId, courseId);
    expect(res.ok).toBe(true);
    expect((await round())?.nine).toBe("back");
  });

  it("CONTROL: the rounds screen, which states the nine, still changes it", async () => {
    await setStageCourse(stageId, courseId, "front", true);
    expect((await round())?.nine).toBe("front");
    await setStageCourse(stageId, courseId, "full", true);
    expect((await round())?.nine).toBe("full");
    await setStageCourse(stageId, courseId, "back", true);
    expect((await round())?.nine).toBe("back");
  });

  it("CONTROL: a nine that is none of the three is still stored as the whole card, not as typed", async () => {
    await setStageCourse(stageId, courseId, "middle", true);
    expect((await round())?.nine).toBe("full");
  });
});
