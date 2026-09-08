import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * DELETING A VENUE MUST NOT REWRITE A TOURNAMENT ALREADY PLAYED ON IT.
 *
 * `Event.courseId` is SET NULL, which preserves the ROWS and used to lose the
 * CARD. An event that picked a stored course has no card of its own, so after
 * the delete `resolveCourse` fell through to `UNKNOWN_COURSE` — pars `[]`,
 * stroke index `[]`.
 *
 * The strokes survived and every number made from them was wrong: to-par
 * computed against nothing, so a 70 on a par 72 reads "+70" on the public
 * board, and handicap allocation had no stroke index to allocate down. A
 * silent loss of the derived numbers is worse than a visible loss of the row.
 *
 * The same rule `Player.handicap` already follows: a venue is a live record,
 * the card a round was scored against is history.
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
import { deleteClubCourse } from "@/app/actions/courses";
import { resolveCourse } from "@/lib/courses";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-COURSEDEL";
const PARS = new Array(18).fill(4);
const YARDS = new Array(18).fill(400);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

let orgId = "";
let courseId = "";
let pickedId = "";
let ownCardId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const newEvent = (name: string, extra: Record<string, unknown>) => ({
  organizationId: orgId,
  name: `${TAG} ${name}`,
  dates: "",
  course: `${TAG}-Bushwood`,
  city: "",
  address: "",
  regDeadline: "",
  shareToken: `${TAG}-${name}-${Date.now()}`,
  ...extra,
});

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;

  const course = await prisma.course.create({
    data: {
      organizationId: orgId,
      name: `${TAG}-Bushwood`,
      city: "Cincinnati, OH",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(YARDS),
      strokeIndex: JSON.stringify(SI),
    },
  });
  courseId = course.id;

  // The ordinary case: an event that PICKED the stored course and so has no
  // card of its own.
  const picked = await prisma.event.create({ data: newEvent("picked", { courseId }) });
  pickedId = picked.id;

  // And one that points at the same course but carries its own card, which
  // must not be overwritten.
  const own = await prisma.event.create({
    data: newEvent("own", {
      courseId,
      customPars: JSON.stringify(new Array(18).fill(3)),
      customYards: JSON.stringify(new Array(18).fill(150)),
      customStrokeIndex: JSON.stringify(SI),
    }),
  });
  ownCardId = own.id;

  const user = await prisma.user.create({
    data: { email: `${TAG}-organizer@example.invalid`.toLowerCase(), name: "Organizer", password: "x" },
  });
  await prisma.account.create({
    data: { eventId: pickedId, email: user.email, name: "Organizer", role: "admin" },
  });
  jar.clear();
  await createSession(user.id);
  await setActiveEvent(pickedId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const cardOf = async (id: string) => {
  const ev = await prisma.event.findUnique({ where: { id }, include: { courseRef: true } });
  return resolveCourse(ev!);
};

describe("removing a venue from the library", () => {
  it("resolves the card before the delete, so the test can tell", async () => {
    // The precondition. Without it, "18 pars afterwards" could mean the delete
    // did nothing at all.
    expect((await cardOf(pickedId)).pars).toHaveLength(18);
  });

  it("leaves a tournament played there still scoring against its card", async () => {
    const res = await deleteClubCourse(courseId);
    expect(res.ok, res.error ?? "").toBe(true);

    const after = await cardOf(pickedId);
    expect(after.pars, "the card went with the venue").toHaveLength(18);
    expect(after.pars[0]).toBe(4);
    expect(
      after.strokeIndex,
      "no stroke index means handicap strokes have nowhere to fall",
    ).toHaveLength(18);
  });

  it("really did remove the course", async () => {
    // Snapshotting must not have quietly become "keep the course".
    expect(await prisma.course.findUnique({ where: { id: courseId } })).toBeNull();
    const ev = await prisma.event.findUnique({ where: { id: pickedId } });
    expect(ev!.courseId, "the reference is gone; the card is not").toBeNull();
  });

  it("does not overwrite an event that had a card of its own", async () => {
    // A deliberate custom card outranks the club's. Overwriting it would be
    // the delete deciding it knows better than the organizer.
    const own = await cardOf(ownCardId);
    expect(own.pars[0], "the event's own par was replaced by the club's").toBe(3);
  });
});
