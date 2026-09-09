import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/** Set by the season test before it drives the real server action. */
let session: { email: string; name: string; eventId: string; role: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

/**
 * A casual round feeds nothing at club level.
 *
 * The rule the whole feature rests on: a quick round is one game between
 * friends, it has no field, no flights and no committee, and it deletes itself
 * about a day after it is set up. Anything it leaves behind in the club's
 * records is therefore a record of something that no longer exists.
 *
 * It leaked in six places, found on 2026-09-09 by asking every club-level
 * aggregate whether it filtered on `shape`. Two of them WROTE PERMANENT CLUB
 * RECORDS, and those are the reason this file exists:
 *
 *   the club handicap   `memberHandicapRecord` gathered every entry the member
 *                       had in the club's events and built a suggested index
 *                       from the approved cards. `acceptClubHandicap` writes
 *                       that to `Member.handicap` — the number every future
 *                       competition scores that person off. A casual round's
 *                       players carry `memberId` whenever they were picked off
 *                       the roster, so four friends on a Tuesday could move
 *                       somebody's index and nothing in the number would say
 *                       so.
 *
 *   the honours board   `championSuggestions` offered any completed event to
 *                       the committee as a club champion. `HonoursEntry`
 *                       carries `eventId` with no foreign key, deliberately,
 *                       so the line outlives the event — confirm a casual
 *                       round and the 24-hour sweep then leaves a permanent
 *                       board entry pointing at nothing.
 *
 * The other four were counts and lists: the roster's entry count and "last
 * event", the club's "Tournaments" figure, and the access report.
 *
 * EVERY CASE HERE IS ASSERTED IN BOTH DIRECTIONS. A rule that excluded
 * everything would pass "the casual round is absent" and quietly break the
 * club, so each test also proves the tournament beside it still counts.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CASUAL-FEEDS";

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
/** A card good enough to count: eighteen holes, all returned. */
const CARD = JSON.stringify(new Array(18).fill(4));

let organizationId = "";
let memberId = "";
let tournamentId = "";
let casualId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** An event of `shape`, with the member in it and an approved card. */
async function eventWithCard(name: string, shape: string, courseId: string) {
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}`.slice(0, 60),
      // Completed, because that is what the honours board looks for — and a
      // casual round can reach it: `setEventStatus` asks nothing about shape.
      status: "completed",
      completedAt: new Date(),
      shape,
      format: "stroke",
      courseId,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  const stage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      nine: "full",
      scoringBasis: "gross",
      courseId,
    },
    select: { id: true },
  });
  const player = await prisma.player.create({
    data: {
      eventId: event.id,
      // THE JOIN THAT MADE THE LEAK REAL. A casual round's players carry a
      // memberId whenever they were picked off the club roster.
      memberId,
      name: `${TAG} Wren`,
      email: `${TAG}-wren@example.invalid`.toLowerCase(),
      handicap: 12,
      handicapType: "18",
      status: "confirmed",
      seed: 1,
    },
    select: { id: true },
  });
  await prisma.scorecard.create({
    data: {
      eventId: event.id,
      stageId: stage.id,
      playerId: player.id,
      strokes: CARD,
      status: "approved",
    },
  });
  return event.id;
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  organizationId = org.id;
  const course = await prisma.course.create({
    data: {
      organizationId,
      name: `${TAG} course`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
    select: { id: true },
  });
  const member = await prisma.member.create({
    data: { organizationId, name: `${TAG} Wren`, handicap: 12, handicapSource: "manual" },
    select: { id: true },
  });
  memberId = member.id;

  tournamentId = await eventWithCard("medal", "single", course.id);
  casualId = await eventWithCard("fourball", "match", course.id);
});

afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the club handicap", () => {
  it("counts the tournament's card and not the casual round's", async () => {
    /**
     * THE WORST OF THE SIX. What this record produces is written to
     * `Member.handicap` by `acceptClubHandicap` — a permanent club handicap.
     *
     * Both events hold one approved card for the same member, so the COUNT is
     * the whole assertion: two means the Sunday fourball is in the member's
     * handicap record, one means only the competition is.
     */
    const { memberHandicapRecord } = await import("@/lib/services/handicap-record");
    const record = await memberHandicapRecord(organizationId, memberId);
    expect(record, "the member exists").not.toBeNull();
    expect(record!.cardsFound, "the competition's card, and only that one").toBe(1);
  });

  it("and finds nothing at all when the only round was casual", async () => {
    // The other direction: a member who has played nothing but quick rounds
    // has no handicap record to accept, rather than one built from them.
    const only = await prisma.member.create({
      data: { organizationId, name: `${TAG} Sole`, handicap: 20, handicapSource: "manual" },
      select: { id: true },
    });
    const casual = await prisma.event.findUnique({
      where: { id: casualId },
      select: { id: true },
    });
    const stage = await prisma.stage.findFirst({
      where: { eventId: casual!.id },
      select: { id: true },
    });
    const player = await prisma.player.create({
      data: {
        eventId: casual!.id,
        memberId: only.id,
        name: `${TAG} Sole`,
        email: `${TAG}-sole@example.invalid`.toLowerCase(),
        handicap: 20,
        handicapType: "18",
        status: "confirmed",
        seed: 2,
      },
      select: { id: true },
    });
    await prisma.scorecard.create({
      data: {
        eventId: casual!.id,
        stageId: stage!.id,
        playerId: player.id,
        strokes: CARD,
        status: "approved",
      },
    });

    const { memberHandicapRecord } = await import("@/lib/services/handicap-record");
    const record = await memberHandicapRecord(organizationId, only.id);
    expect(record!.cardsFound).toBe(0);
  });
});

describe("the honours board", () => {
  it("offers the tournament as a champion and never the casual round", async () => {
    /**
     * `HonoursEntry.eventId` carries no foreign key, deliberately, so a board
     * line outlives its event. Confirming a casual round would therefore leave
     * a permanent club record pointing at a round the sweep deletes the next
     * day — under an auto-generated title like "Ada & Bo v Cal & Dee".
     */
    const { championSuggestions, championFor } = await import("@/lib/services/honours");
    const pending = await championSuggestions(organizationId);
    const ids = pending.map((p) => p.eventId);
    expect(ids, "the club's own competition is still offered").toContain(tournamentId);
    expect(ids, "a Sunday fourball is not a championship").not.toContain(casualId);

    // And the path that actually WRITES the board refuses it too — it is
    // reachable with an id that never appeared in the list above.
    expect(await championFor(organizationId, casualId)).toBeNull();
    expect(await championFor(organizationId, tournamentId)).not.toBeNull();
  });
});

describe("the roster", () => {
  it("counts tournament entries only, and names a tournament as the last one", async () => {
    const { loadRoster } = await import("@/lib/services/roster");
    const rows = await loadRoster(organizationId);
    const wren = rows.find((r) => r.id === memberId);
    expect(wren, "the member is on the roster").toBeDefined();
    // One each. Two would mean the fourball counted.
    expect(wren!.entryCount).toBe(1);
    expect(wren!.lastEvent).toContain("medal");
    expect(wren!.lastEvent).not.toContain("fourball");
  });
});

describe("the club's access report", () => {
  it("lists the tournament and not the casual round", async () => {
    const { organizationAccessReport } = await import("@/lib/services/access");
    const report = await organizationAccessReport(organizationId);
    const names = report.events.map((e) => e.name);
    expect(names.some((n) => n.includes("medal")), "the club's event").toBe(true);
    expect(names.some((n) => n.includes("fourball")), "four people's own game").toBe(false);
  });
});

describe("a season", () => {
  /**
   * Refused where `seriesId` is WRITTEN rather than filtered where it is
   * read: a round that must not be in a season must not be ATTACHABLE to one,
   * or the link sits in the database waiting for the next reader that forgets
   * to filter.
   *
   * Driven through the real action, both ways. An earlier version of this test
   * asserted only that `seriesId` was still null, which is trivially true of a
   * row nothing has touched — a test that cannot fail, which is exactly what
   * the mutation pass is for catching.
   */
  it("refuses a casual round and takes a tournament", async () => {
    const { setEventSeries } = await import("@/app/actions/series");
    const season = await prisma.series.create({
      data: { organizationId, name: `${TAG} order of merit` },
      select: { id: true },
    });

    session = { email: `${TAG}@example.invalid`.toLowerCase(), name: TAG, eventId: tournamentId, role: "admin" };
    const refused = await setEventSeries(casualId, season.id);
    expect(refused.ok, "a Sunday fourball is not a leg of a season").toBe(false);
    expect(refused.error).toMatch(/quick round/i);
    expect(
      (await prisma.event.findUnique({ where: { id: casualId }, select: { seriesId: true } }))?.seriesId,
    ).toBeNull();

    // THE OTHER DIRECTION, or this is just "refuse everything".
    const taken = await setEventSeries(tournamentId, season.id);
    expect(taken.ok, taken.error).toBe(true);
    expect(
      (await prisma.event.findUnique({ where: { id: tournamentId }, select: { seriesId: true } }))?.seriesId,
    ).toBe(season.id);
  });
});
