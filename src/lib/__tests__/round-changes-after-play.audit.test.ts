import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * THE ROUNDS-AND-FORMAT RULE ON REAL ROWS (J12, state machine PR 7b), by the
 * actions an organizer reaches, on a LAUNCHED tournament:
 *
 *   - a round nobody has scored takes a new allowance at once — the setup lock
 *     no longer refuses it after launch;
 *   - a scored round of cards is ASKED first, in the Golf Pro's words, and only
 *     a yes writes; then every playing handicap is worked out again off the
 *     figure frozen at its first card, and Recent changes says what moved, old
 *     to new, by the Rules (worked by hand below from decimal indexes);
 *   - a player's tees changed after play RE-FREEZE that player in the scored
 *     round and nobody else, and the line says so;
 *   - a scored round's format, and deleting it, are REFUSED in words; a scored
 *     round of matches refuses a change of basis;
 *   - an undrawn round still deletes on one press, launched;
 *   - a played round's new day is said; and once completed, every one of
 *     these is refused with Reopen as the way out.
 *
 * The database is read afterwards, not only the answer: a refusal that still
 * wrote would satisfy every assertion about what came back.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/round-changes-after-play.audit.test.ts
 */

type Session = { email: string; name: string; eventId: string; role: string; viewRole?: string; userId?: string; accountId?: string };
const session: { current: Session | null } = { current: null };
vi.mock("@/lib/auth", () => ({ getSession: async () => session.current, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { setStageAllowance } = await import("@/app/actions/teams");
const { setStageFormat, setStageScoringBasis, removeStage, setStagePlayedOn } = await import("@/app/actions/tournament");
const { setPlayerTee } = await import("@/app/actions/courses");
const { freezeRoundHandicaps } = await import("@/lib/services/round-handicap");
const { COMPLETED_DATES, COMPLETED_ROUNDS, SCHEDULES_WORDS } = await import("@/lib/domain/round-change");

const prisma = new PrismaClient();
const TAG = "zz-j12rounds";
const RUN = randomBytes(4).toString("hex");

/** White: CR 72.4, Slope 131, Par 71. Yellow: CR 69.0, Slope 120, Par 71. */
const WHITE = { courseRating: 72.4, slopeRating: 131, par: 71 };
const YELLOW = { courseRating: 69.0, slopeRating: 120, par: 71 };
/** Invented players, decimal indexes. */
const FIELD = [
  { name: `${TAG} Ottoline Brack`, index: 12.4 },
  { name: `${TAG} Fenwick Ashdown`, index: 5.3 },
  { name: `${TAG} Marigold Teague`, index: 20.1 },
];

const ids = { org: "", event: "", white: "", yellow: "", medal: "", matches: "", later: "", spare: "" };
const players: string[] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const stageOf = (id: string) => prisma.stage.findUnique({ where: { id } });
const frozenOf = async (stageId: string) =>
  new Map((await prisma.roundHandicap.findMany({ where: { stageId }, select: { playerId: true, frozen: true } })).map((r) => [r.playerId, r.frozen]));
const lastLine = async () => (await prisma.auditLog.findFirst({ where: { eventId: ids.event, action: "round.recomputed" }, orderBy: { createdAt: "desc" } }))?.detail ?? "";

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  ids.org = org.id;
  const links = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify([4, 4, 3, 5, 4, 4, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5]),
      yards: JSON.stringify(new Array(18).fill(380)),
      strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  ids.white = (await prisma.tee.create({ data: { courseId: links.id, name: "White", gender: "any", ...WHITE, position: 0 } })).id;
  ids.yellow = (await prisma.tee.create({ data: { courseId: links.id, name: "Yellow", gender: "any", ...YELLOW, position: 1 } })).id;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} autumn medal ${RUN}`,
      // Launched, as `launchTournament` leaves it: the setup lock is on.
      status: "live",
      configUnlocked: false,
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "",
      capacity: 40,
      shareToken: randomBytes(10).toString("hex"),
      courseId: links.id,
      defaultTeeId: ids.white,
      teePolicy: "own",
    },
  });
  ids.event = event.id;
  await prisma.eventCourse.create({ data: { eventId: event.id, courseId: links.id } });
  const stage = (position: number, data: Record<string, unknown>) =>
    prisma.stage.create({ data: { eventId: event.id, position, holes: 18, scoringBasis: "net", ...data } as never });
  ids.medal = (await stage(0, { type: "Stroke Play Round", format: "Stroke Play", handicapAllowance: 95 })).id;
  ids.matches = (await stage(1, { type: "Round Robin", format: "Match Play" })).id;
  ids.later = (await stage(2, { type: "Stroke Play Round", format: "Stroke Play", handicapAllowance: 95 })).id;
  ids.spare = (await stage(3, { type: "Stroke Play Round", format: "Stroke Play" })).id;
  for (const [i, p] of FIELD.entries()) {
    players.push(
      (
        await prisma.player.create({
          data: { eventId: event.id, name: p.name, email: `${TAG}-p${i}-${RUN}@example.invalid`, handicap: p.index, handicapType: "18", seed: i + 1, status: "confirmed" },
        })
      ).id,
    );
  }
  // Round 1 played: a whole card each, frozen as the card write freezes it.
  for (const id of players) {
    await prisma.scorecard.create({ data: { eventId: event.id, stageId: ids.medal, playerId: id, strokes: JSON.stringify(new Array(18).fill(5)), status: "entered" } });
  }
  await freezeRoundHandicaps(event.id, ids.medal);
  // Round 2 played as matches: one match with holes recorded.
  const flight = await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 } });
  await prisma.match.create({
    data: { eventId: event.id, stageId: ids.matches, groupId: flight.id, round: 1, playerAId: players[0], playerBId: players[1], holes: JSON.stringify(["A", "H", "B"]) },
  });
  session.current = { email: `${TAG}-sec-${RUN}@example.invalid`, name: `${TAG} secretary`, eventId: event.id, role: "admin", viewRole: "admin" };
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** Course Handicap = Index × Slope ÷ 113 + (CR − Par), unrounded; the allowance taken of it, rounded once (Rules of Handicapping 6.1, 6.2; Appendix C). */
const playing = (index: number, tee: typeof WHITE, pct: number) => Math.floor(((index * tee.slopeRating) / 113 + (tee.courseRating - tee.par)) * (pct / 100) + 0.5);

describe("a launched tournament's rounds, judged by what a change would invalidate (J12)", () => {
  it("an unscored round takes a new allowance at once — launch is not a reason to refuse it", async () => {
    expect(await setStageAllowance(ids.later, 85)).toEqual({ ok: true });
    expect((await stageOf(ids.later))?.handicapAllowance).toBe(85);
  });

  it("a scored round of cards is asked first, in the Golf Pro's words, and nothing is written until yes", async () => {
    const asked = await setStageAllowance(ids.medal, 85);
    expect(asked).toMatchObject({ ok: false, needsConfirm: true, cards: 3 });
    expect(asked.says).toBe(
      "This changes a term of the competition after play. Every net score in Round 1 (3 cards) is worked out again. Money is final-only, so nothing paid changes.",
    );
    expect((await stageOf(ids.medal))?.handicapAllowance).toBe(95);
  });

  it("on yes: written, worked out again off the frozen figure, and Recent changes says who moved — by the Rules", async () => {
    // By hand: 12.4 → 15.775… → 15 at 95%, 13 at 85%; 5.3 → 7.544… → 7, 6; 20.1 → 24.701… → 23, 21.
    expect(FIELD.map((p) => [playing(p.index, WHITE, 95), playing(p.index, WHITE, 85)])).toEqual([
      [15, 13],
      [7, 6],
      [23, 21],
    ]);
    expect(await setStageAllowance(ids.medal, 85, true)).toEqual({ ok: true });
    expect((await stageOf(ids.medal))?.handicapAllowance).toBe(85);
    const line = await lastLine();
    expect(line).toContain("Round 1: handicap allowance 95% → 85% after play. 3 cards in Round 1 worked out again.");
    for (const [i, p] of FIELD.entries()) expect(line).toContain(`${players[i]} ${playing(p.index, WHITE, 95)} → ${playing(p.index, WHITE, 85)}`);
    // The frozen Course Handicaps themselves did not move: only the allowance taken of them.
    expect([...(await frozenOf(ids.medal)).values()].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([8, 16, 25]);
  });

  it("a player's tees changed after play re-freeze that player in the scored round, and nobody else", async () => {
    const before = await frozenOf(ids.medal);
    const asked = await setPlayerTee(players[0], ids.yellow);
    expect(asked).toMatchObject({ ok: false, needsConfirm: true });
    expect(asked.says).toMatch(/^This changes a term of the competition after play\. Every net score in Round 1 \(3 cards\) is worked out again\./);
    // A round of matches already played keeps its strokes, and the question says so.
    expect(asked.says).toContain("Matches already played keep the strokes they were played off.");
    expect((await prisma.player.findUnique({ where: { id: players[0] } }))?.teeId).toBeNull();

    expect(await setPlayerTee(players[0], ids.yellow, true)).toEqual({ ok: true });
    const after = await frozenOf(ids.medal);
    // Yellow: 12.4 × 120 ÷ 113 − 2 = 11.168… → frozen 11; at 85%, 9.49… → 9.
    expect(after.get(players[0])).toBe(11);
    expect(after.get(players[1])).toBe(before.get(players[1]));
    expect(after.get(players[2])).toBe(before.get(players[2]));
    expect(await lastLine()).toContain(`${players[0]} ${playing(12.4, WHITE, 85)} → ${playing(12.4, YELLOW, 85)}`);
  });

  it("a scored round's format, and deleting it, are refused in words, and nothing changes", async () => {
    expect(await setStageFormat(ids.medal, "Stableford")).toEqual({
      ok: false,
      error: "Round 1 was scored as Stroke Play; its cards would mean something else. Clear its scores on Score entry first.",
    });
    expect((await stageOf(ids.medal))?.format).toBe("Stroke Play");
    expect(await removeStage(ids.medal)).toMatchObject({ ok: false, refused: "Round 1 has scores. Clear them on Score entry first." });
    expect(await removeStage(ids.medal, true)).toMatchObject({ ok: false, refused: "Round 1 has scores. Clear them on Score entry first." });
    expect(await stageOf(ids.medal)).not.toBeNull();
  });

  it("a scored round of matches refuses a change of basis: a decided match is not worked out again", async () => {
    expect(await setStageScoringBasis(ids.matches, "gross", true)).toEqual({
      ok: false,
      error: "Round 2’s matches were played off these strokes. Clear its scores on Score entry first.",
    });
    expect((await stageOf(ids.matches))?.scoringBasis).toBe("net");
  });

  it("an undrawn round still deletes on one press, launched", async () => {
    expect(await removeStage(ids.spare)).toEqual({ ok: true });
    expect(await stageOf(ids.spare)).toBeNull();
  });

  it("a played round's new day is taken and said", async () => {
    expect(await setStagePlayedOn(ids.medal, "2026-11-21")).toEqual({ ok: true, said: SCHEDULES_WORDS });
  });

  it("once completed, every one of them is refused, with Reopen as the way out", async () => {
    await prisma.event.update({ where: { id: ids.event }, data: { status: "completed" } });
    try {
      expect(await setStageAllowance(ids.medal, 90, true)).toEqual({ ok: false, error: COMPLETED_ROUNDS });
      expect(await setStageFormat(ids.later, "Stableford")).toEqual({ ok: false, error: COMPLETED_ROUNDS });
      expect(await removeStage(ids.later, true)).toMatchObject({ ok: false, refused: COMPLETED_ROUNDS });
      expect(await setPlayerTee(players[1], ids.yellow, true)).toEqual({ ok: false, error: COMPLETED_ROUNDS });
      expect(await setStagePlayedOn(ids.medal, "2026-11-22")).toEqual({ ok: false, error: COMPLETED_DATES });
      expect((await stageOf(ids.medal))?.handicapAllowance).toBe(85);
      expect((await stageOf(ids.medal))?.playedOn).toBe("2026-11-21");
    } finally {
      await prisma.event.update({ where: { id: ids.event }, data: { status: "live" } });
    }
  });
});
