import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { weekViewFor } from "@/lib/services/week-view";

/**
 * A SKINS NIGHT PAYS HOLES AND A NASSAU IS THREE BETS.
 *
 * `positionsExist` in `formats.ts` says exactly that, and the leaderboard has
 * rendered both on their own boards since they were added. The league week
 * sheet ranked them on NET STROKES anyway — so a skins league night read
 * "1st · 57 net" on one screen and "6 skins" on the other, for different
 * players, about the same evening.
 *
 * And the Nassau was worse than wrong, it was absent: its three bets live on
 * the MATCH, and the sheet asked whether any Scorecard existed for a stage
 * whose type is "Stroke Play Round". Eight settled matches read as "No scores
 * are in for week 3 yet."
 *
 * Both found on the seeded festival on 2026-09-20 — the eleven formats the
 * club had never played. Neither is exotic: a skins night is the commonest
 * side game in the game, and both were simply never rendered.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WEEK-POINTS";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [1, 11, 17, 5, 3, 13, 15, 7, 9, 2, 12, 18, 6, 4, 14, 16, 8, 10];

let eventId = "";
let skinsId = "";
let nassauId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      shape: "series",
      format: "stroke",
      status: "active",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
    },
  });
  eventId = event.id;

  const group = await prisma.group.create({ data: { eventId, name: `${TAG} draw`, position: 0 } });
  const players = [];
  for (const [i, who] of ["Ann", "Bob", "Cal", "Dee"].entries()) {
    players.push(
      await prisma.player.create({
        data: {
          eventId,
          groupId: group.id,
          name: `${TAG} ${who}`,
          email: `${TAG}-${who}@example.invalid`.toLowerCase(),
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
      }),
    );
  }

  /**
   * WEEK 1 IS SKINS, with cards that decide holes outright.
   *
   * Handicaps are zero and the cards differ on purpose: a hole must be won
   * OUTRIGHT to be a skin, so a fixture where everybody matches produces a
   * board of nothing but carries and could not tell a working skins reader
   * from a broken one.
   */
  const skins = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      description: "Week 1",
      type: "Stroke Play Round",
      format: "Skins",
      scoringBasis: "gross",
      holes: 18,
    },
  });
  skinsId = skins.id;

  for (const [i, p] of players.entries()) {
    await prisma.scorecard.create({
      data: {
        eventId,
        stageId: skinsId,
        playerId: p.id,
        // Ann birdies the 1st alone; everybody else pars it. One clean skin,
        // and the rest of the card is level so the board is not noise.
        strokes: JSON.stringify(PARS.map((par, hole) => (hole === 0 && i === 0 ? par - 1 : par))),
      },
    });
  }

  /**
   * WEEK 2 IS A NASSAU, recorded as MATCHES on a stroke-type stage — which is
   * how the app records one, and the exact shape the sheet could not see.
   */
  const nassau = await prisma.stage.create({
    data: {
      eventId,
      position: 1,
      description: "Week 2",
      type: "Stroke Play Round",
      format: "Nassau",
      scoringBasis: "net",
      holes: 18,
    },
  });
  nassauId = nassau.id;

  await prisma.match.create({
    data: {
      eventId,
      stageId: nassauId,
      groupId: group.id,
      round: 1,
      playerAId: players[0].id,
      playerBId: players[1].id,
      // A front nine A wins, a back nine B wins, and eighteen holes played —
      // a Nassau is played out, which is the whole point of the third bet.
      holes: JSON.stringify([
        "A", "A", "H", "H", "H", "H", "H", "H", "H",
        "B", "B", "H", "H", "H", "H", "H", "H", "H",
      ]),
      scoreStatus: "confirmed",
    },
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a skins league night", () => {
  it("is not ranked on net strokes", async () => {
    const view = await weekViewFor(eventId, skinsId);
    expect(view, "the week sheet did not build").toBeTruthy();
    expect(
      view!.results,
      "a skins night is still ranked as a medal — the sheet and the board name different winners",
    ).toEqual([]);
    expect(view!.hasScoreTable).toBe(false);
  });

  it("shows the skins board instead", async () => {
    const view = await weekViewFor(eventId, skinsId);
    expect(view!.nightBoard?.kind).toBe("skins");
    const board = view!.nightBoard!.kind === "skins" ? view!.nightBoard!.board : null;
    // The control: the fixture really does decide a hole. A board of nothing
    // but carries would pass a shape assertion and prove nothing.
    expect(board!.outcome.standings.some((s) => s.skins > 0), "no skin was won at all").toBe(true);
  });

  it("is a played night, not an empty one", async () => {
    const view = await weekViewFor(eventId, skinsId);
    expect(view!.empty).toBe(false);
    expect(view!.weeks.find((w) => w.stageId === skinsId)!.played).toBe(true);
  });
});

describe("a Nassau league night", () => {
  it("is not reported as having no scores", async () => {
    /**
     * The fourth kind of night this sheet has had to be taught. Its bets are
     * on the MATCH and its stage type is "Stroke Play Round", so both the
     * sheet and the week strip went looking for scorecards and found none.
     */
    const view = await weekViewFor(eventId, nassauId);
    expect(view!.empty, "eight settled matches read as a night nobody played").toBe(false);
    expect(view!.weeks.find((w) => w.stageId === nassauId)!.played).toBe(true);
  });

  it("shows the three bets, not a stroke ranking", async () => {
    const view = await weekViewFor(eventId, nassauId);
    expect(view!.results).toEqual([]);
    expect(view!.nightBoard?.kind).toBe("nassau");
    const rows = view!.nightBoard!.kind === "nassau" ? view!.nightBoard!.rows : [];
    expect(rows.length).toBe(1);
    // Three segments, and the fixture decides two of them in opposite
    // directions — so a reader that returned the same winner for every bet
    // would fail here.
    expect(rows[0].outcome.segments.length).toBe(3);
    const [front, back] = rows[0].outcome.segments;
    expect(front.key).toBe("front");
    expect(front.result?.winner).toBe("A");
    expect(back.key).toBe("back");
    expect(back.result?.winner).toBe("B");
  });
});
