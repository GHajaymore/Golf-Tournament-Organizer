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
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { saveClubCourse } from "@/app/actions/courses";
import { resolveCourse } from "@/lib/courses";

/**
 * A VENUE IS A LIVE RECORD; THE CARD A ROUND WAS SCORED ON IS HISTORY.
 *
 * `deleteClubCourse` says exactly that and snapshots the card onto the events
 * that would lose it. Editing the same card did neither, and `resolveCourse`
 * prefers the linked course over an event's own card — so correcting a par
 * rewrote every round ever played there.
 *
 * Measured on 2026-09-17 before the fix: a COMPLETED medal read "level par",
 * the club corrected the 1st from a 4 to a 5, and the same finished
 * tournament read "-1" on the leaderboard. Nothing warned, and no stroke
 * changed.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-COURSE-HISTORY";
const arr = (n: number, v: number) => JSON.stringify(new Array(n).fill(v));
const SI = JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1));
const PAR_4S = arr(18, 4);
// A par 5 at the 4th: a real routing. A card of one 5 then seventeen 4s is
// refused by `implausibleCard` as sorted rather than in hole order.
const FOURS_WITH_A_FIVE = [4, 4, 4, 5, ...new Array(14).fill(4)];
const PAR_WITH_A_FIVE = JSON.stringify(FOURS_WITH_A_FIVE);

let orgId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

/** A club course, a tournament pointing at it, and a card on it if `played`. */
async function venue(played: boolean) {
  const course = await prisma.course.create({
    data: { organizationId: orgId, name: `${TAG} links ${Math.random()}`, city: "", pars: PAR_4S, yards: arr(18, 400), strokeIndex: SI },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} medal ${Math.random()}`,
      status: "complete", shape: "series", format: "stroke", formationRule: "balanced",
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      courseId: course.id,
      shareToken: `audit-course-${Date.now()}-${Math.random()}`,
      registrationToken: `r-${Date.now()}-${Math.random()}`,
    },
  });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross" },
  });
  if (played) {
    const player = await prisma.player.create({
      data: {
        eventId: event.id, name: `${TAG} PAT`,
        email: `${TAG.toLowerCase()}-p-${Date.now()}-${Math.random()}@example.invalid`,
        handicap: 10, seed: 1, status: "confirmed",
      },
    });
    await prisma.scorecard.create({
      data: { eventId: event.id, stageId: stage.id, playerId: player.id, strokes: arr(18, 4), status: "approved" },
    });
  }

  // A real console session, so the action runs its real guards.
  const email = `${TAG.toLowerCase()}-org-${Date.now()}-${Math.random()}@example.invalid`;
  const user = await prisma.user.create({ data: { email, name: `${TAG} Org`, password: "x" } });
  await prisma.account.create({ data: { eventId: event.id, email, name: `${TAG} Org`, role: "admin" } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: "owner" } });
  jar.clear();
  await createSession(user.id);
  await setActiveEvent(event.id);

  return { courseId: course.id, eventId: event.id };
}

/** The card this event's scores are actually worked out from. */
async function cardOf(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { courseRef: true },
  });
  return resolveCourse(event);
}

const edit = (courseId: string, pars: number[], played?: "keep-history" | "rescore") =>
  saveClubCourse({
    id: courseId,
    name: `${TAG} links edited`,
    city: "",
    pars,
    yards: new Array(18).fill(400),
    strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    played,
  });


beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } })).id;
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("editing a club course that rounds were scored on", () => {
  it("saves without a question when nothing has been played on it — the control", async () => {
    const { courseId, eventId } = await venue(false);
    expect(await edit(courseId, FOURS_WITH_A_FIVE)).toMatchObject({ ok: true });
    // And the empty tournament follows the corrected card, which is the point
    // of correcting it.
    expect((await cardOf(eventId)).pars[3]).toBe(5);
  });

  it("refuses the first time, names the cost, and writes nothing", async () => {
    const { courseId, eventId } = await venue(true);
    const res = await edit(courseId, FOURS_WITH_A_FIVE);
    expect(res).toMatchObject({ ok: false, needsConfirm: true, cards: 1 });
    expect(res.events?.[0]).toContain(`${TAG} medal`);

    const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(course.pars, "refused and wrote anyway").toBe(PAR_4S);
    expect((await cardOf(eventId)).pars[3]).toBe(4);
  });

  it("keeps the played tournament on the card it was scored on, and moves the venue on", async () => {
    const { courseId, eventId } = await venue(true);
    expect(await edit(courseId, FOURS_WITH_A_FIVE, "keep-history")).toMatchObject({ ok: true });

    // The venue is corrected…
    const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(course.pars).toBe(PAR_WITH_A_FIVE);

    // …and the finished tournament still scores against the old card.
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.customPars, "the snapshot").toBe(PAR_4S);
    expect(event.courseId, "the live link has to go, or resolveCourse reads it first").toBeNull();
    expect((await cardOf(eventId)).pars[3]).toBe(4);
  });

  it("re-scores the played tournament when the organizer asks for that instead", async () => {
    const { courseId, eventId } = await venue(true);
    expect(await edit(courseId, FOURS_WITH_A_FIVE, "rescore")).toMatchObject({ ok: true });
    expect((await cardOf(eventId)).pars[3]).toBe(5);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).customPars).toBe("");
  });

  it("does not ask about a change that cannot move a score", async () => {
    /**
     * Yardage is never scored off — `cardRefusal` says so and a re-validation
     * pass once threw away 33 good cards over it — and a rename is a label.
     * A question on those teaches an organizer to click through the one that
     * matters.
     */
    const { courseId } = await venue(true);
    const res = await saveClubCourse({
      id: courseId,
      name: `${TAG} links renamed`,
      city: "Newtown",
      pars: new Array(18).fill(4),
      yards: new Array(18).fill(455),
      strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    });
    expect(res).toMatchObject({ ok: true });
    const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(course.name).toBe(`${TAG} links renamed`);
    expect(course.yards).toBe(arr(18, 455));
  });

  it("leaves a tournament with a card of its own alone", async () => {
    /**
     * A deliberate custom card outranks the club's, so it is neither counted
     * nor overwritten — the same rule the delete path states.
     */
    const { courseId, eventId } = await venue(true);
    await prisma.event.update({
      where: { id: eventId },
      data: { customPars: arr(18, 3), customYards: arr(18, 150), customStrokeIndex: SI },
    });
    expect(await edit(courseId, FOURS_WITH_A_FIVE), "nothing scores off this card now").toMatchObject({
      ok: true,
    });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.customPars, "its own card was overwritten").toBe(arr(18, 3));
  });
});
