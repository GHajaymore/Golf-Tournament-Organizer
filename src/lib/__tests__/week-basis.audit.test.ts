import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { weekViewFor } from "@/lib/services/week-view";

/**
 * A LEAGUE NIGHT IS RANKED ON THE FIGURE THE ROUND IS SET TO.
 *
 * The weekly sheet asked one question — "is this Stableford?" — and answered
 * everything else with NET. So a round set to GROSS was ranked by net, the
 * header called it "net strokes", and the season table under it totalled net.
 *
 * WALKED, not reasoned about. On 2026-09-10 a society league week was built
 * with four cards chosen so gross and net order reverse — 76/77/78/79 off
 * handicaps of 10/12/14/16. Two screens, one round, opposite answers:
 *
 *   /leaderboard   "zz-lg Player 1 leads at +4", the 76 first, the 79 last
 *   /week          the 79 first and the 76 third, under "net strokes"
 *
 * `/week` is the SOCIETY's screen — it exists only for a league — so this is
 * the one product where the wrong answer is the one people read every week.
 *
 * THE FIXTURE IS THE POINT. Gross and net order must REVERSE, or a test of the
 * ranking passes on a rule that ignores the basis entirely, which is the rule
 * that shipped. Both bases are asserted here over the same four cards.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WEEKBASIS";
const PARS = new Array(18).fill(4);

let eventId = "";
let stageId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** The round's scoring basis, changed per test. */
async function setBasis(scoringBasis: string) {
  await prisma.stage.update({ where: { id: stageId }, data: { scoringBasis } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} society`, kind: "community" },
    select: { id: true },
  });
  // A real course row, because shots are allocated off a stroke index and a
  // fixture with none gives every player nought — which would make net and
  // gross identical and this whole file assert nothing.
  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} parkland`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: JSON.stringify(new Array(18).fill(380)),
      strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} winter league`,
      shape: "series",
      format: "stroke",
      status: "live",
      dates: "",
      course: `${TAG} parkland`,
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      customYards: JSON.stringify(new Array(18).fill(380)),
      courseId: course.id,
    },
    select: { id: true },
  });
  eventId = event.id;
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });

  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Week 1",
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      nine: "full",
      scoringBasis: "gross",
      courseId: course.id,
    },
    select: { id: true },
  });
  stageId = stage.id;

  /**
   * The low handicap shoots the HIGHER gross, so the two orders reverse.
   * Without that this fixture cannot tell a basis-aware ranking from one that
   * always reads net.
   */
  const field = [
    { who: "scratch", handicap: 10, over: 4 },
    { who: "middle", handicap: 12, over: 5 },
    { who: "higher", handicap: 14, over: 6 },
    { who: "highest", handicap: 16, over: 7 },
  ];
  for (const [i, f] of field.entries()) {
    const player = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${f.who}`,
        email: `${TAG}-${f.who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
        handicap: f.handicap,
        handicapType: "18",
      },
      select: { id: true },
    });
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId,
        playerId: player.id,
        strokes: JSON.stringify(PARS.map((par, h) => par + (h < f.over ? 1 : 0))),
      },
    });
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** The night's order, best first, by the short name in the fixture. */
async function order(): Promise<string[]> {
  const view = await weekViewFor(eventId, stageId);
  expect(view, "the week sheet did not build").toBeTruthy();
  return view!.results.map((r) => r.name.replace(`${TAG} `, ""));
}

describe("a gross league night", () => {
  it("is ranked by gross, the same way the leaderboard ranks it", async () => {
    await setBasis("gross");
    expect(await order()).toEqual(["scratch", "middle", "higher", "highest"]);
  });

  it("and says so rather than calling it net", async () => {
    await setBasis("gross");
    const view = await weekViewFor(eventId, stageId);
    expect(view!.basis).toBe("gross");
  });

  it("and totals gross in the season table beneath it", async () => {
    /**
     * The table is the half that outlives the night. Ranking the sheet
     * correctly and then accumulating a different figure underneath would be
     * the same defect one section down.
     */
    await setBasis("gross");
    const view = await weekViewFor(eventId, stageId);
    const top = view!.standings[0];
    expect(top.name.replace(`${TAG} `, "")).toBe("scratch");
    expect(top.value, "the gross it shot").toBe(76);
  });
});

describe("a net league night, over the identical cards", () => {
  it("turns the night over — which is what makes the test above mean anything", async () => {
    /**
     * THE ASSERTION THAT PROVES THE FIXTURE CAN EXPRESS A WRONG ANSWER. If
     * these four cards ranked the same way on both bases, the gross tests
     * would pass on a rule that reads net and ignores the round.
     */
    await setBasis("net");
    const net = await order();
    expect(net[0], "the highest handicap wins on net").toBe("highest");
    expect(net[0]).not.toBe("scratch");
  });

  it("and is unchanged from what it always did", async () => {
    // THE ASSERTION THAT KEEPS THIS FROM BEING A REWRITE FOR EVERY LEAGUE.
    // A net night is the ordinary case and must read exactly as before.
    await setBasis("net");
    const view = await weekViewFor(eventId, stageId);
    expect(view!.basis).toBe("net");
    expect(view!.standings[0].name.replace(`${TAG} `, "")).toBe("highest");
  });

  it("and 'both' stays on net, deliberately", async () => {
    // Both prizes are given; net is the figure a league table has always
    // carried. Named here so a change to it has to be made on purpose.
    await setBasis("both");
    const view = await weekViewFor(eventId, stageId);
    expect(view!.basis).toBe("net");
  });
});

describe("a Stableford league night", () => {
  it("still ranks on points", async () => {
    // Untouched by this change, and asserted because a three-way rule written
    // wrongly would most likely break the one branch that already existed.
    await setBasis("stableford");
    const view = await weekViewFor(eventId, stageId);
    expect(view!.basis).toBe("stableford");
    // Most shots received, most points: the same player who wins on net.
    expect(view!.results[0].name.replace(`${TAG} `, "")).toBe("highest");
  });
});
