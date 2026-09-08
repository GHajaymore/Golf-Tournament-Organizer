import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A MATCH MUST NOT BE PINNED TO A COURSE THAT CANNOT SCORE IT.
 *
 * A club's library can hold a row that is a name and nothing else — added
 * once and never filled in. `nameMatchVenue` never asked: a NEW course had
 * its card refused or stored, and an EXISTING one was checked for ownership
 * and nothing more. So the match could be attached to a course with no pars
 * and no stroke index, and the round then scored against nothing: to-par
 * against no par, handicap strokes with nowhere to fall. Every total looks
 * perfectly ordinary, which is what makes it worth a test rather than a
 * comment.
 *
 * Two ways in, and the second is the worse one:
 *
 *   - tapping the course in the venue prompt sends a `courseId`
 *   - TYPING its name sends a `newCourse` carrying a full, valid card, which
 *     `matchCourse` resolves to the existing row — and the card the scorer
 *     just typed was DISCARDED
 *
 * Asserted against real rows because the whole question is what ends up in
 * the database: whether the card was stored, on which row, and whether a
 * second course was created under the same name.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CARDLESS";

const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];

let session: { eventId: string; email: string; name: string; role: string; viewRole: string } | null =
  null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { nameMatchVenue } = await import("@/app/actions/courses");

let eventId = "";
let matchId = "";
let cardlessId = "";
let cardedId = "";

/** By the mark, in both directions — see attestation.audit.test.ts and #200. */
async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** Put the course back to having no card, for the next case. */
async function blank(id: string) {
  await prisma.course.update({
    where: { id },
    data: { pars: "", yards: "", strokeIndex: "" },
  });
}

beforeAll(async () => {
  await scrub();

  const org = await prisma.organization.create({ data: { name: `${TAG} Society`, kind: "community" } });

  // The row that is a name and nothing else — the whole subject.
  const cardless = await prisma.course.create({
    data: { organizationId: org.id, name: `${TAG} Green Crest`, city: "Middletown", pars: "", yards: "", strokeIndex: "" },
  });
  cardlessId = cardless.id;

  const carded = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} Blue Ash`,
      city: "Blue Ash",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
  });
  cardedId = carded.id;

  const event = await prisma.event.create({
    data: {
      name: `${TAG} League`,
      organizationId: org.id,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG.toLowerCase()}-${Date.now()}`,
      courseMode: "open",
      scoreEntryBy: "players",
    },
  });
  eventId = event.id;

  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Round Robin", format: "Match Play", holes: 18 },
  });
  const group = await prisma.group.create({ data: { eventId, name: "Flight A", position: 0 } });
  const [a, b] = await Promise.all([
    prisma.player.create({
      data: { eventId, name: `${TAG} Ann`, email: `${TAG}-ann@example.invalid`.toLowerCase(), seed: 1, status: "confirmed" },
    }),
    prisma.player.create({
      data: { eventId, name: `${TAG} Bob`, email: `${TAG}-bob@example.invalid`.toLowerCase(), seed: 2, status: "confirmed" },
    }),
  ]);
  const match = await prisma.match.create({
    data: { eventId, stageId: stage.id, groupId: group.id, round: 1, playerAId: a.id, playerBId: b.id, holes: "[]", scoreStatus: "pending" },
  });
  matchId = match.id;

  session = { eventId, email: `${TAG}-organizer@example.invalid`.toLowerCase(), name: "Organizer", role: "admin", viewRole: "admin" };
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

const cardOf = async (id: string) =>
  prisma.course.findUniqueOrThrow({ where: { id }, select: { pars: true, strokeIndex: true } });

describe("naming a venue the club has, without a card", () => {
  it("refuses to attach it with no card, and names the course", async () => {
    /**
     * THE DEFECT. This returned ok and pinned the match to a course with no
     * pars and no stroke index.
     */
    await blank(cardlessId);
    const res = await nameMatchVenue(matchId, { courseId: cardlessId, nine: "full" });

    expect(res.ok, "a course with no card cannot score a round").toBe(false);
    // The refusal has to be actionable: which course, and what to do.
    expect(res.error).toMatch(/Green Crest/);
    expect(res.error).toMatch(/no card/i);
  });

  it("leaves the match unattached when it refuses", async () => {
    // A refusal that attached the course anyway would be the worst of both.
    const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { courseId: true } });
    expect(m.courseId).toBeFalsy();
  });

  it("takes the card and stores it on the row the club already has", async () => {
    await blank(cardlessId);
    const res = await nameMatchVenue(matchId, {
      courseId: cardlessId,
      newCourse: { name: `${TAG} Green Crest`, city: "", address: "", pars: PARS, yards: [], strokeIndex: SI },
      nine: "full",
    });
    expect(res.ok, res.error ?? "").toBe(true);

    const after = await cardOf(cardlessId);
    expect(JSON.parse(after.pars)).toEqual(PARS);
    expect(JSON.parse(after.strokeIndex)).toEqual(SI);
  });

  it("does not create a second course under the same name", async () => {
    /**
     * The reason the card is written to the existing row rather than through
     * the new-course path: a library of three Green Crests with one usable
     * card between them is the failure `matchCourse` exists to prevent.
     */
    const rows = await prisma.course.findMany({ where: { name: `${TAG} Green Crest` }, select: { id: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(cardlessId);
  });

  it("refuses a card that would not pass on a new course either", async () => {
    // One standard, wherever a card is written down. A duplicated stroke
    // index gives one hole two shots and another none, in every match.
    await blank(cardlessId);
    const bad = [...SI];
    bad[3] = bad[2];
    const res = await nameMatchVenue(matchId, {
      courseId: cardlessId,
      newCourse: { name: `${TAG} Green Crest`, city: "", address: "", pars: PARS, yards: [], strokeIndex: bad },
      nine: "full",
    });
    expect(res.ok).toBe(false);
    expect(await cardOf(cardlessId).then((c) => c.pars), "nothing stored on a refusal").toBe("");
  });
});

describe("a course that already has a card — the control", () => {
  it("attaches without asking for one", async () => {
    /**
     * Without this the cases above pass just as well against an action that
     * refuses every course, which would break the ordinary path this screen
     * exists for.
     */
    const res = await nameMatchVenue(matchId, { courseId: cardedId, nine: "full" });
    expect(res.ok, res.error ?? "").toBe(true);
  });

  it("does not let a passing card overwrite the one it has", async () => {
    // The stored card is the club's. A scorer typing a different one must not
    // silently restate it for everybody — that is how a course quietly
    // changes its stroke index under rounds already played on it.
    const flat = new Array(18).fill(4);
    const inOrder = Array.from({ length: 18 }, (_, i) => i + 1);
    await nameMatchVenue(matchId, {
      courseId: cardedId,
      newCourse: { name: `${TAG} Blue Ash`, city: "", address: "", pars: flat, yards: [], strokeIndex: inOrder },
      nine: "full",
    });
    expect(JSON.parse((await cardOf(cardedId)).pars), "the club's card was overwritten").toEqual(PARS);
  });
});
