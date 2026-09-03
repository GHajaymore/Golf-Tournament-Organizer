import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The card a saved match is actually scored against.
 *
 * `saveMatchScorecard` resolved the EVENT's course and nothing else, so
 * `Match.courseId` and `Stage.courseId` were both ignored — a match played at
 * another venue was scored against a course nobody played, and the per-hole
 * winners derived from it were STORED. `/live` read the same match through
 * `courseForMatch` and showed the right answer, so the board and the record
 * disagreed with no way to tell which was which.
 *
 * Driven through the real action, because the fault is in what it writes down.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MATCH-VENUE";

let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null =
  null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveMatchScorecard } = await import("@/app/actions/tournament");

let orgId = "";

/**
 * Stroke indexes chosen so that every card here disagrees with every other.
 *
 * Match play is decided hole by hole, and in a NET match the only thing the
 * card contributes is WHERE the strokes land. So the fixtures must differ on
 * stroke index, and differ in a way that survives the re-ranking a nine gets:
 *
 *   - the VENUE's front nine ascends, so it re-ranks to 1..9 in order and the
 *     strokes land at the START of the card;
 *   - its back nine DESCENDS, so it re-ranks to 9..1 and the strokes land at
 *     the END;
 *   - the EVENT's card is the venue's front nine reversed, so reading the
 *     wrong course moves every stroke to the other end too.
 *
 * The first version of this file used gross match play and cards that differed
 * only in par. Every assertion passed with the venue lookup deleted, because
 * gross match play compares strokes and never looks at the card at all — a
 * fixture that could not fail.
 */
const VENUE_SI = [...Array.from({ length: 9 }, (_, i) => i + 1), ...Array.from({ length: 9 }, (_, i) => 18 - i)];
const EVENT_SI = [...Array.from({ length: 9 }, (_, i) => 9 - i), ...Array.from({ length: 9 }, (_, i) => i + 10)];

/** A handicap difference big enough to light up four holes of a nine. */
const B_INDEX = 8;

async function seedMatch(opts: { basis: "net" | "gross"; matchNine: string; stageNine: string }) {
  const venue = await prisma.course.create({
    data: {
      organizationId: orgId,
      name: `${TAG} venue`,
      city: "Elsewhere",
      pars: JSON.stringify([...new Array(9).fill(3), ...new Array(9).fill(5)]),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(VENUE_SI),
    },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${Date.now()}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "active",
      shape: "series",
      formationRule: "balanced",
      shareToken: `audit-venue-${Date.now()}-${Math.random()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      // Deliberately the venue's front nine reversed, so scoring against the
      // event's card puts every stroke on the opposite end of the round.
      customStrokeIndex: JSON.stringify(EVENT_SI),
      courses: { create: { courseId: venue.id } },
    },
  });
  const eventId = event.id;
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Match Play",
      holes: 9,
      nine: opts.stageNine,
      scoringBasis: opts.basis,
    },
  });
  const g = await prisma.group.create({ data: { eventId, name: "A", position: 0 } });
  const mk = async (label: string, handicap: number, seed: number) =>
    (
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${label}`,
          email: `${TAG.toLowerCase()}-${label}-${Date.now()}-${Math.random()}@example.invalid`,
          handicap,
          seed,
          status: "confirmed",
          groupId: g.id,
        },
      })
    ).id;
  const a = await mk("A", 0, 1);
  const b = await mk("B", B_INDEX, 2);
  const match = await prisma.match.create({
    data: {
      eventId,
      stageId: stage.id,
      groupId: g.id,
      round: 1,
      playerAId: a,
      playerBId: b,
      // The match names its own venue, which is the thing that was ignored.
      courseId: venue.id,
      nine: opts.matchNine,
      holes: JSON.stringify(new Array(9).fill(null)),
    },
  });

  session = {
    eventId,
    email: `${TAG.toLowerCase()}-staff@example.invalid`,
    viewRole: "admin",
    name: `${TAG} staff`,
    role: "admin",
  };
  return { eventId, matchId: match.id, venueId: venue.id, a, b };
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("a match is scored on the card it was played on", () => {
  /** Both sides return the same score on every hole, so the ONLY thing that
   *  can decide a hole is where B's handicap strokes fell. */
  const level = () => new Array(9).fill(4);

  it("allocates off the match's own venue, not the event's course", async () => {
    /**
     * The venue's front nine ascends, so its strokes land on the opening
     * holes; the event's card is that nine reversed, so reading the wrong
     * course puts every stroke on the closing holes instead. Same scores, same
     * handicaps, opposite result — and the result is what gets STORED.
     */
    const { matchId } = await seedMatch({
      basis: "net",
      matchNine: "front",
      stageNine: "front",
    });

    await saveMatchScorecard(matchId, "A", level());
    await saveMatchScorecard(matchId, "B", level());

    const saved = await prisma.match.findUnique({ where: { id: matchId } });
    const holes = JSON.parse(saved!.holes) as (string | null)[];

    expect(holes).toHaveLength(9);
    // B receives strokes on the venue's hardest holes, which are the first
    // ones. Every other hole is halved.
    const won = holes.flatMap((h, i) => (h === "B" ? [i] : []));
    expect(won.length).toBeGreaterThan(0);
    expect(won.every((i) => i < 4), `B won holes ${won.join(",")} — expected the opening ones`).toBe(
      true,
    );
    expect(holes.slice(won.length).every((h) => h === "H")).toBe(true);
  });

  it("honours the match's own nine though it shares the round's course", async () => {
    /**
     * The round says front; the match says back. Under the old rule the
     * match's answer was read only alongside its own course, so a pairing
     * playing the same venue on the other nine was scored on the front.
     *
     * The venue's back nine descends, so its strokes land on the CLOSING
     * holes — the exact opposite end from the front nine. The stored winners
     * say which half the app actually used.
     */
    const { matchId } = await seedMatch({
      basis: "net",
      matchNine: "back",
      stageNine: "front",
    });

    await saveMatchScorecard(matchId, "A", level());
    await saveMatchScorecard(matchId, "B", level());

    const saved = await prisma.match.findUnique({ where: { id: matchId } });
    const holes = JSON.parse(saved!.holes) as (string | null)[];

    expect(holes).toHaveLength(9);
    const won = holes.flatMap((h, i) => (h === "B" ? [i] : []));
    expect(won.length).toBeGreaterThan(0);
    expect(won.every((i) => i >= 5), `B won holes ${won.join(",")} — expected the closing ones`).toBe(
      true,
    );
  });

  it("refuses to store a net result it cannot allocate strokes for", async () => {
    /**
     * With no card there is no stroke index, so every hole was decided scratch
     * and then stored as the NET result. The organizer sees a settled match,
     * correctly formatted, decided under a rule the round is not being played
     * under. Better to refuse and say why.
     */
    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} nocard ${Date.now()}`,
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        capacity: 0,
        status: "active",
        shape: "series",
        formationRule: "balanced",
        shareToken: `audit-nocard-${Date.now()}-${Math.random()}`,
      },
    });
    const stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 0,
        type: "Round Robin",
        format: "Match Play",
        holes: 18,
        scoringBasis: "net",
      },
    });
    const g = await prisma.group.create({
      data: { eventId: event.id, name: "A", position: 0 },
    });
    const mk = async (label: string, handicap: number, seed: number) =>
      (
        await prisma.player.create({
          data: {
            eventId: event.id,
            name: `${TAG} ${label}`,
            email: `${TAG.toLowerCase()}-${label}-${Date.now()}-${Math.random()}@example.invalid`,
            handicap,
            seed,
            status: "confirmed",
            groupId: g.id,
          },
        })
      ).id;
    const match = await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        groupId: g.id,
        round: 1,
        playerAId: await mk("N1", 4, 1),
        playerBId: await mk("N2", 18, 2),
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    });
    session = {
      eventId: event.id,
      email: `${TAG.toLowerCase()}-staff@example.invalid`,
      viewRole: "admin",
      name: `${TAG} staff`,
      role: "admin",
    };

    await expect(
      saveMatchScorecard(match.id, "A", new Array(18).fill(4)),
    ).rejects.toThrow(/no course card/i);
  });

  it("still scores a GROSS match with no card at all", async () => {
    /**
     * The guard against the guard. A community match-play league has no fixed
     * venue — opponents play wherever suits them — and gross match play needs
     * no par and no stroke index to say who won a hole. Refusing that would
     * break a tournament the app deliberately supports.
     */
    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} grossnocard ${Date.now()}`,
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        capacity: 0,
        status: "active",
        shape: "series",
        formationRule: "balanced",
        shareToken: `audit-grossnc-${Date.now()}-${Math.random()}`,
      },
    });
    const stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 0,
        type: "Round Robin",
        format: "Match Play",
        holes: 18,
        scoringBasis: "gross",
      },
    });
    const g = await prisma.group.create({
      data: { eventId: event.id, name: "A", position: 0 },
    });
    const mk = async (label: string, seed: number) =>
      (
        await prisma.player.create({
          data: {
            eventId: event.id,
            name: `${TAG} ${label}`,
            email: `${TAG.toLowerCase()}-${label}-${Date.now()}-${Math.random()}@example.invalid`,
            handicap: 10,
            seed,
            status: "confirmed",
            groupId: g.id,
          },
        })
      ).id;
    const match = await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        groupId: g.id,
        round: 1,
        playerAId: await mk("G1", 1),
        playerBId: await mk("G2", 2),
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    });
    session = {
      eventId: event.id,
      email: `${TAG.toLowerCase()}-staff@example.invalid`,
      viewRole: "admin",
      name: `${TAG} staff`,
      role: "admin",
    };

    await saveMatchScorecard(match.id, "A", new Array(18).fill(4));
    await saveMatchScorecard(match.id, "B", new Array(18).fill(5));

    const saved = await prisma.match.findUnique({ where: { id: match.id } });
    const holes = JSON.parse(saved!.holes) as (string | null)[];
    expect(holes.every((h) => h === "A")).toBe(true);
  });
});
