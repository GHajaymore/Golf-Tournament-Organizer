import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";

/**
 * A SCRATCH COMPETITION MAY NOT BE SEPARATED BY HANDICAP, AND WAS.
 *
 * `stroke-countback.ts` opens by saying the countback runs on the basis the
 * competition was played on, "because a net comp separated on gross would hand
 * the prize to the low handicapper the countback exists to stop". That was
 * fixed inside the countback. The SORT that feeds it kept a cross-basis
 * secondary — `x.gross - y.gross || x.net - y.net` on a gross competition —
 * and the shared-rank pass then required BOTH scores to match before it would
 * call two players level. So two players level on gross and apart on net were
 * ordered by net, declared not tied, and the countback never ran.
 *
 * FOUND BY RENDERING the seeded Demo Cup's board on 2026-09-15, a gross
 * competition:
 *
 *     rank 3   gross 70   net 64   Elena Petrova
 *     rank 4   gross 70   net 65   Sang-woo Kim
 *     rank 5   gross 70   net 68   AJ
 *
 * Three places awarded on handicap in the one format that exists to exclude
 * it, while the player's own Rules tab said "Countback: last 9 holes, then the
 * last 6, then the last 3, then the final hole. A tie that survives shares the
 * place."
 *
 * AGAINST REAL ROWS because the defect was in the service's inline sort, not
 * in a domain function — `level-on-the-basis.test.ts` can prove the rule and
 * cannot prove that `loadEventState` asks it. Seven thousand unit tests passed
 * throughout.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-BASIS";

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [1, 11, 17, 3, 7, 13, 15, 5, 9, 2, 12, 18, 4, 8, 14, 16, 6, 10];

let orgId = "";

/**
 * Two cards on the same TOTAL that no countback can separate, built hole by
 * hole so the fixture earns its tie instead of asserting it.
 *
 * Both are 72 (4 on every hole). Identical everywhere, so the last nine, the
 * last six, the last three and the final hole are all level too — which is the
 * only way to reach the shared-rank pass and see what it decides.
 */
const flat = (n: number) => JSON.stringify(new Array(18).fill(n));

async function seed(basis: "gross" | "net") {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${basis} ${Date.now()}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      shareToken: `audit-basis-${Date.now()}-${Math.random()}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(SI),
      /**
       * ALL THREE, or the round has no course at all.
       *
       * `fromEvent` returns null unless pars, yards AND stroke index all
       * parse, so omitting yards — which nothing scores off — leaves every
       * hole reading as stroke index 18. A twelve-handicapper then receives no
       * shots anywhere and net equals gross, which is precisely how this
       * fixture spent three runs unable to express the defect. The control
       * below is what said so.
       */
      customYards: JSON.stringify(new Array(18).fill(400)),
    },
  });
  const eventId = event.id;
  /**
   * A RATED COURSE, because a handicap that never becomes a Course Handicap is
   * a handicap that never reaches the net score. Slope 113 is the neutral
   * rung, so a 12 index plays off 12 and the arithmetic below is readable.
   */
  const course = await prisma.course.create({
    data: {
      organizationId: orgId,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(SI),
    },
  });
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });
  const tee = await prisma.tee.create({
    data: { courseId: course.id, name: "Blue", position: 0, courseRating: 72, slopeRating: 113, par: 72 },
  });
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Round Robin",
      format: "Stroke Play",
      holes: 18,
      scoringBasis: basis,
      // REQUIRED, and zero by default. Without it every playing handicap
      // resolves to nought, both players score net 72, and the fixture cannot
      // express the defect at all — which is exactly what the control caught.
      handicapAllowance: 100,
    },
  });
  const flight = (await prisma.group.create({ data: { eventId, name: "A", position: 0 } })).id;

  /**
   * TWO PLAYERS LEVEL ON GROSS AND TWELVE SHOTS APART ON NET.
   *
   * SCRATCH plays off 0, so gross 72 is net 72. BANDIT plays off 12, so the
   * same gross 72 is net 60. On a GROSS competition they are level and owed a
   * countback they cannot win; on a NET competition BANDIT wins outright.
   *
   * Seeds are deliberately the wrong way round — SCRATCH is seed 2 — so a
   * result that merely falls out of entry order is distinguishable from one
   * that was decided.
   */
  const spec = [
    { label: "BANDIT", handicap: 12, seed: 1 },
    { label: "SCRATCH", handicap: 0, seed: 2 },
  ];
  const ids: Record<string, string> = {};
  for (const s of spec) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${s.label}`,
        email: `${TAG.toLowerCase()}-${s.label}-${Date.now()}-${Math.random()}@example.invalid`,
        handicap: s.handicap,
        seed: s.seed,
        status: "confirmed",
        groupId: flight,
        teeId: tee.id,
      },
    });
    ids[s.label] = p.id;
    await prisma.scorecard.create({
      data: { eventId, stageId: stage.id, playerId: p.id, strokes: flat(4) },
    });
    /**
     * The handicap stated as a COMMITTEE OVERRIDE rather than left to be
     * resolved off tees and slope.
     *
     * `resolveRoundHandicap` puts an override ahead of everything else, so the
     * number this round is played off is the number written here — no course
     * rating, no allowance conversion, nothing between the fixture and the
     * net score it is trying to produce. An earlier draft set only the roster
     * handicap and both players still came out net 72; the control below is
     * what caught it.
     */
    await prisma.roundHandicap.create({
      data: { eventId, stageId: stage.id, playerId: p.id, override: s.handicap },
    });
  }
  return { eventId, ids };
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  orgId = (await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } })).id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("a gross competition", () => {
  it("really does put the two players twelve net shots apart", async () => {
    /**
     * The control. If the handicaps failed to reach the net score, both
     * assertions below would pass on a fixture that could not express the
     * defect at all — the exact failure CLAUDE.md asks every fixture to rule
     * out before it is counted as coverage.
     */
    const { eventId, ids } = await seed("gross");
    const state = await loadEventState(eventId);
    const row = (id: string) => state!.strokeStandings.find((s) => s.player.id === id)!;

    expect(row(ids["SCRATCH"]).gross).toBe(row(ids["BANDIT"]).gross);
    expect(row(ids["SCRATCH"]).net - row(ids["BANDIT"]).net).toBe(12);
  });

  it("shares the place between two players level on gross", async () => {
    // The defect: they were ranked 1 and 2, by net, in a competition that does
    // not use net.
    const { eventId, ids } = await seed("gross");
    const state = await loadEventState(eventId);
    const rankOf = (id: string) => state!.strokeStandings.find((s) => s.player.id === id)!.rank;

    expect(rankOf(ids["SCRATCH"]), "the scratch player was placed below an equal gross").toBe(1);
    expect(rankOf(ids["BANDIT"])).toBe(1);
  });
});

describe("a net competition", () => {
  it("separates them, because net is what it is decided on", async () => {
    /**
     * The other half, and the guard against over-correcting: a basis the
     * competition DOES use must still decide the place outright. Twelve shots
     * is not a tie.
     */
    const { eventId, ids } = await seed("net");
    const state = await loadEventState(eventId);
    const rankOf = (id: string) => state!.strokeStandings.find((s) => s.player.id === id)!.rank;

    expect(rankOf(ids["BANDIT"])).toBe(1);
    expect(rankOf(ids["SCRATCH"])).toBe(2);
  });
});
