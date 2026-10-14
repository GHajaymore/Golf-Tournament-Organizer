import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE RESULTS THE APP WRITES DOWN GIVE THE STROKES FOR TEES OF A HIGHER PAR.
 *
 * Rules of Handicapping 6.2b — see
 * `tees-of-a-higher-par-get-their-strokes.test.ts` for the Rule, and
 * `every-reader-gives-the-strokes-for-the-pars.audit.test.ts` for the readers
 * that are worked out again every time a board is drawn. These three are the
 * ones where a wrong figure is KEPT:
 *
 *     a team match        `recomputeTeamMatch` stores who won each hole
 *     a file of net cards  `importScores` converts net back to gross and stores
 *                          the gross — nothing recomputes a stored stroke
 *     a league's table     `leagueMeetings` reads the cards again, and is here
 *                          because it must name the same holes as the stored
 *                          result of the very same match
 *
 * The fixture makes the handicap the only thing that can decide a hole: every
 * ball is a four on every hole, both sets are slope 113 with the rating equal
 * to the par (so a course handicap IS the index). Side A are two scratch
 * players off the par-71 whites; side B are a scratch player and a 10.0, both
 * off the par-72 reds. The 10.0 plays off 10 and one more for the pars: eleven
 * strokes, on stroke indexes 1 to 11, which here are holes 1 to 11. Without the
 * Rule the 11th is halved.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PARSTORED";

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);
const fours = () => new Array(18).fill(4);

let session: {
  eventId: string;
  email: string;
  viewRole: string;
  name: string;
  role: string;
  userId: string;
  accountId: string;
} | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { importScores, importTeamScores } = await import("@/app/actions/tournament");
const { leagueMeetings } = await import("@/lib/services/league");

const ids = { event: "", match: "", fourBall: "", medal: "", sideA: "", sideB: "", clubB: "" };
const player: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
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
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
  });
  // Rating equal to par and the standard slope: a course handicap is the index.
  const white = await prisma.tee.create({
    data: { courseId: course.id, name: `${TAG} white`, courseRating: 71, slopeRating: 113, par: 71, position: 0 },
  });
  const red = await prisma.tee.create({
    data: { courseId: course.id, name: `${TAG} red`, gender: "female", courseRating: 72, slopeRating: 113, par: 72, position: 1 },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `${TAG}-${process.pid}`,
      registrationToken: `${TAG}r-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      courseId: course.id,
      defaultTeeId: white.id,
      teePolicy: "own",
    },
  });
  ids.event = event.id;
  await prisma.eventCourse.create({ data: { eventId: event.id, courseId: course.id } });

  const fourBall = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Round Robin",
      format: "Four-Ball",
      holes: 18,
      scoringBasis: "net",
      handicapAllowance: 100,
      courseId: course.id,
    },
  });
  ids.fourBall = fourBall.id;
  const medal = await prisma.stage.create({
    data: { eventId: event.id, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "net", courseId: course.id },
  });
  ids.medal = medal.id;

  const clubA = await prisma.group.create({ data: { eventId: event.id, name: `${TAG} club A`, position: 0 } });
  const clubB = await prisma.group.create({ data: { eventId: event.id, name: `${TAG} club B`, position: 1 } });
  const carrier = await prisma.group.create({ data: { eventId: event.id, name: `${TAG} fixtures`, position: 2, isCarrier: true } });
  ids.clubB = clubB.id;

  const specs = [
    { club: clubA.id, tag: "A", players: [{ index: 0, tee: null }, { index: 0, tee: null }] },
    // BOTH of side B are on the higher par, and nobody on side A is — so a
    // reader that measured each side from its own lowest par would find no
    // difference on either side and give no stroke at all.
    { club: clubB.id, tag: "B", players: [{ index: 0, tee: red.id }, { index: 10, tee: red.id }] },
  ];
  for (const spec of specs) {
    const side = await prisma.team.create({
      data: { eventId: event.id, stageId: fourBall.id, name: `${TAG} ${spec.tag}`, seed: 1, clubGroupId: spec.club },
    });
    if (spec.tag === "A") ids.sideA = side.id;
    else ids.sideB = side.id;
    for (const [i, who] of spec.players.entries()) {
      const p = await prisma.player.create({
        data: {
          eventId: event.id,
          name: `${TAG} ${spec.tag}${i}`,
          email: `${TAG}.${spec.tag}${i}@example.invalid`.toLowerCase(),
          handicap: who.index,
          handicapType: "18",
          seed: 1,
          status: "confirmed",
          groupId: spec.club,
          teeId: who.tee,
        },
      });
      player[`${spec.tag}${i}`] = p.id;
      await prisma.teamMember.create({ data: { teamId: side.id, playerId: p.id, position: i } });
    }
  }

  const match = await prisma.match.create({
    data: {
      eventId: event.id,
      stageId: fourBall.id,
      groupId: carrier.id,
      round: 1,
      playerAId: "",
      playerBId: "",
      teamAId: ids.sideA,
      teamBId: ids.sideB,
      holes: JSON.stringify(new Array(18).fill(null)),
    },
  });
  ids.match = match.id;

  session = {
    eventId: event.id,
    email: `${TAG}-staff@example.invalid`.toLowerCase(),
    viewRole: "admin",
    name: `${TAG} staff`,
    role: "admin",
    userId: "",
    accountId: "",
  };
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** A stored match's holes as a list of who won each, however the column spells it. */
function holesOf(stored: string): string[] {
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) return parsed.map((h) => (h == null ? "" : String(h)));
  } catch {
    // A plain string of letters, one a hole.
  }
  return stored.split("");
}

/**
 * A SINGLES match decided from the two players' own cards — what
 * `saveMatchScorecard` stores when each player returns their gross. A scratch
 * man off the par-71 whites against a scratch woman off the par-72 reds, both
 * in fours: by the Rule she receives the one stroke the pars differ by, on
 * stroke index 1, and wins the match 1 up. The screens told her so — the
 * scorer's and her own both price a match through `matchHandicapFor` — while
 * the stored result was worked out off bare course handicaps, and halved it.
 */
describe("a singles net match between the two pars, decided from its cards", () => {
  it("stores the 1st as hers and the rest halved, and the screens give her the same stroke", async () => {
    const { saveMatchScorecard } = await import("@/app/actions/tournament");
    const { loadEventState } = await import("@/lib/services/tournament");
    const singles = await prisma.stage.create({
      data: {
        eventId: ids.event,
        position: 2,
        type: "Round Robin",
        format: "Match Play",
        holes: 18,
        scoringBasis: "net",
        courseId: (await prisma.event.findUniqueOrThrow({ where: { id: ids.event } })).courseId,
      },
    });
    const group = await prisma.group.findFirstOrThrow({ where: { eventId: ids.event, isCarrier: true } });
    const match = await prisma.match.create({
      data: {
        eventId: ids.event,
        stageId: singles.id,
        groupId: group.id,
        round: 1,
        playerAId: player.A0,
        playerBId: player.B0,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    });

    const state = await loadEventState(ids.event);
    if (!state) throw new Error("the tournament did not load");
    expect(state.matchHandicapFor(player.A0, match.id), "he is on the lowest par").toBe(0);
    expect(state.matchHandicapFor(player.B0, match.id), "she is owed the difference in pars").toBe(1);

    await saveMatchScorecard(match.id, "A", fours());
    await saveMatchScorecard(match.id, "B", fours());
    const stored = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(holesOf(stored.holes), `stored as ${stored.holes}`).toEqual(["B", ...new Array(17).fill("H")]);
  });

  it("and the same where the match named its own tees, which the screens read another way", async () => {
    // A match with a set of its own is priced by `matchHandicapFor` off a map
    // of its own (`courseHcpByMatch`), not the round's: the other branch.
    const { saveMatchScorecard } = await import("@/app/actions/tournament");
    const { loadEventState } = await import("@/lib/services/tournament");
    const white = await prisma.tee.findFirstOrThrow({ where: { name: `${TAG} white` } });
    const singles = await prisma.stage.findFirstOrThrow({ where: { eventId: ids.event, format: "Match Play" } });
    const group = await prisma.group.findFirstOrThrow({ where: { eventId: ids.event, isCarrier: true } });
    const match = await prisma.match.create({
      data: {
        eventId: ids.event,
        stageId: singles.id,
        groupId: group.id,
        round: 2,
        playerAId: player.A1,
        playerBId: player.B0,
        teeId: white.id,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    });
    const state = await loadEventState(ids.event);
    if (!state) throw new Error("the tournament did not load");
    expect(state.matchHandicapFor(player.A1, match.id)).toBe(0);
    expect(state.matchHandicapFor(player.B0, match.id), "her own reds still beat the match's whites").toBe(1);

    await saveMatchScorecard(match.id, "A", fours());
    await saveMatchScorecard(match.id, "B", fours());
    const stored = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(holesOf(stored.holes), `stored as ${stored.holes}`).toEqual(["B", ...new Array(17).fill("H")]);
  });
});

describe("a four-ball match with one player on the higher par", () => {
  it("the stored result gives her eleven holes, not ten", async () => {
    const out = await importTeamScores(
      ids.fourBall,
      ["A0", "A1", "B0", "B1"].map((who) => ({ playerId: player[who], strokes: fours() })),
    );
    expect(out.ok, `import refused: ${out.ok === false ? (out.error ?? JSON.stringify(out.problems)) : ""}`).toBe(true);
    expect(out.written).toBe(4);

    const match = await prisma.match.findUniqueOrThrow({ where: { id: ids.match } });
    const holes = holesOf(match.holes);
    expect(holes, `stored as ${match.holes}`).toHaveLength(18);
    // Whatever letter the column uses for side B, the first hole is hers: ten
    // strokes or eleven, she has one there and nobody else has any.
    const hers = holes[0];
    expect(hers, "nobody won the 1st, so this asserts nothing").not.toBe("");
    expect(holes.slice(0, 11), "holes 1 to 11: a stroke each, against three fours").toEqual(new Array(11).fill(hers));
    // The 12th on are level: no stroke, four balls on four.
    expect(holes.slice(11).every((h) => h !== hers), `holes 12 to 18 stored as ${holes.slice(11).join(",")}`).toBe(true);
  });

  it("the round froze her stroke for the pars with her handicap", async () => {
    const rows = await prisma.roundHandicap.findMany({ where: { stageId: ids.fourBall } });
    const of = (who: string) => rows.find((r) => r.playerId === player[who]);
    expect(of("B1")?.frozen).toBe(10);
    expect(of("B1")?.frozenParStrokes).toBe(1);
    expect(["A0", "A1", "B0"].map((who) => of(who)?.frozenParStrokes)).toEqual([0, 0, 1]);
  });

  it("and the league's own reading of the same cards names the same holes", async () => {
    const [meeting] = await leagueMeetings(ids.event, ids.fourBall, "holes");
    expect(meeting.pairings).toHaveLength(1);
    const pairing = meeting.pairings[0];
    const theirs = pairing.clubB === ids.clubB ? "B" : "A";
    expect(pairing.holes.slice(0, 11)).toEqual(new Array(11).fill(theirs));
    expect(pairing.holes[11], "the 12th is hers only on twelve strokes").not.toBe(theirs);
    expect(pairing.holes[10], "the 11th is hers only with the stroke for the pars").toBe(theirs);
  });
});

describe("a file of net cards for a medal off two pars", () => {
  it("stores her gross eleven above her net: ten at 95% of 10.0, and one for the pars", async () => {
    const out = await importScores(ids.medal, "net-strokes", [
      { playerId: player.B1, strokes: fours() },
      { playerId: player.A0, strokes: fours() },
    ]);
    expect(out.ok, `import refused: ${out.ok === false ? (out.error ?? "") : ""}`).toBe(true);
    expect(out.written).toBe(2);

    const stored = async (who: string) => {
      const card = await prisma.scorecard.findFirstOrThrow({ where: { stageId: ids.medal, playerId: player[who] } });
      return JSON.parse(card.strokes) as number[];
    };
    const hers = await stored("B1");
    // 95% of 10.0 is 9.5, which is 10 (a half goes up); the pars make it 11.
    expect(hers.reduce((a, b) => a + b, 0), `stored ${hers.join(",")}`).toBe(72 + 11);
    expect(hers.slice(0, 11)).toEqual(new Array(11).fill(5));
    expect(hers.slice(11)).toEqual(new Array(7).fill(4));
    // CONTROL: the scratch player off the lower par is given nothing.
    expect(await stored("A0")).toEqual(fours());
  });

  it("and the board gives back the net that was in the file", async () => {
    const { loadEventState } = await import("@/lib/services/tournament");
    const state = await loadEventState(ids.event);
    expect(state!.strokeHandicapFor(player.B1, ids.medal)).toBe(11);
    expect(state!.strokeHandicapFor(player.A0, ids.medal)).toBe(0);
  });
});
