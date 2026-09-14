import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A TOURNAMENT'S OWN COURSE IS ONE OF ITS VENUES.
 *
 * Every writer of a venue links it — `setStageCourse`, `setMatchCourse` and
 * `nameMatchVenue` all upsert an `EventCourse` row, each under a comment
 * saying why: "so the existing per-match course picker and every downstream
 * resolver accept it". `saveEvent` — the screen where a club picks the course
 * in the first place — wrote `Event.courseId` and stopped.
 *
 * So a tournament could hold two answers to "where is this played" that
 * disagreed, and the demo data does: `Event.courseId` names Blue Ash while
 * the only `EventCourse` row names Green Crest.
 *
 * IT IS NOT COSMETIC, because `teesForEvent` reads tees through the VENUE
 * join. On that tournament the "Played from" picker offered Green Crest's
 * three sets under a header reading Blue Ash — and `teeForPlay`, asked to
 * scope its fallback to `event.courseId`, found no tees at that course at all
 * and fell through to the first across every venue. A round at Blue Ash
 * priced off Green Crest's slope.
 *
 * Asserted against real rows because that is where it lives: the link table,
 * the action, and the tee reader are three pieces and the gap was between
 * them.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-EVENTVENUE";
const EMAIL = `${TAG}-owner@example.invalid`.toLowerCase();

const session = { email: EMAIL, name: `${TAG} owner`, eventId: "", role: "admin" };
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveEvent } = await import("@/app/actions/tournament");
const { teesForEvent } = await import("@/lib/services/handicaps");

let eventId = "";
let homeId = "";
let awayId = "";

const PARS = new Array(18).fill(4);

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

beforeAll(async () => {
  await scrub();
  const user = await prisma.user.create({ data: { email: EMAIL, name: `${TAG} owner` } });
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "owner" },
  });

  const card = {
    pars: JSON.stringify(PARS),
    yards: JSON.stringify(new Array(18).fill(400)),
    strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
  };
  const [home, away] = await Promise.all([
    prisma.course.create({ data: { organizationId: org.id, name: `${TAG} home`, city: "", ...card } }),
    prisma.course.create({ data: { organizationId: org.id, name: `${TAG} away`, city: "", ...card } }),
  ]);
  homeId = home.id;
  awayId = away.id;
  await Promise.all([
    prisma.tee.create({
      data: { courseId: home.id, name: `${TAG} home white`, courseRating: 71, slopeRating: 120, par: 72 },
    }),
    prisma.tee.create({
      data: { courseId: away.id, name: `${TAG} away white`, courseRating: 68, slopeRating: 105, par: 72 },
    }),
  ]);

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  eventId = event.id;
  session.eventId = eventId;
  await prisma.account.create({
    data: { eventId, email: EMAIL, name: `${TAG} owner`, role: "admin" },
  });
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

/** The shape `saveEvent` takes, with only the venue varying. */
const details = (courseId: string, course: string) => ({
  name: `${TAG} open`,
  dates: "",
  format: "match",
  course,
  courseId,
  city: "",
  address: "",
  regDeadline: "",
  capacity: 0,
  playerCountMode: "registration",
  manualPlayerCount: 0,
  courseMode: "fixed",
  sideStyle: "individual",
});

describe("picking the tournament's course makes it a venue", () => {
  it("links it, so the tee reader can see its sets", async () => {
    /**
     * THE WHOLE BUG, AS ONE ASSERTION. Before this, `teesForEvent` came back
     * EMPTY for a tournament whose course had been chosen on Tournament
     * details — the tees exist, the course exists, and the join row that
     * connects them was never written. The picker on that same screen then
     * had nothing to offer, or worse, offered another venue's sets.
     */
    await saveEvent(details(homeId, `${TAG} home`));

    const links = await prisma.eventCourse.findMany({ where: { eventId }, select: { courseId: true } });
    expect(links.map((l) => l.courseId), "the chosen course is not a venue").toContain(homeId);

    const tees = await teesForEvent(eventId);
    expect(tees.map((t) => t.name), "its tees are invisible to the tee picker").toContain(
      `${TAG} home white`,
    );
  });

  it("adds a venue when the course changes, and retires nothing", async () => {
    /**
     * UPSERT, NEVER DELETE. A tournament may legitimately have several
     * venues, and a round or a match may already point at the old one —
     * removing it would orphan them, and `teeForPlay` would then step past a
     * tee that no longer resolves. Changing the event's course adds; the
     * Courses list is where a venue is retired deliberately.
     */
    await saveEvent(details(awayId, `${TAG} away`));

    const after = (
      await prisma.eventCourse.findMany({ where: { eventId }, select: { courseId: true } })
    ).map((l) => l.courseId);
    expect(after, "the new course was not linked").toContain(awayId);
    expect(after, "changing the course silently retired the old venue").toContain(homeId);
  });

  it("links nothing when the course was typed rather than picked", async () => {
    /**
     * A name with no id is a course this club does not have on file, which is
     * a real and supported answer — `saveEvent` stores the name and leaves
     * `courseId` null. There is nothing to link, and inventing a row would
     * be worse than the gap: it would put a course in the venue list that
     * has no card, no tees and no id to hang either on.
     */
    const before = await prisma.eventCourse.count({ where: { eventId } });
    await saveEvent(details("", "Somewhere the club has never played"));
    expect(await prisma.eventCourse.count({ where: { eventId } })).toBe(before);
  });
});
