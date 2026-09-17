import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A WHOLE LEAGUE SEASON, PLAY-OFFS INCLUDED, AGAINST REAL ROWS.
 *
 * Four clubs, four team rounds, a top-four play-off: weeks one and two are
 * the season, week three the semi-finals, week four the final. Every step
 * goes through the actions a captain and an organizer use — nominate, draw,
 * and the cards the scorers would enter.
 *
 * Built so a wrong answer looks different. Club 0 shoots 4s, club 1 5s,
 * club 2 6s, club 3 7s, so the season order is fixed; then the semi-final
 * has an UPSET (club 3 beats the top seed) and a LEVEL meeting (clubs 1 and
 * 2 both shoot 5s), so "who goes through" cannot be answered by the table.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-league-playoff";

const session = {
  email: `${TAG}@example.invalid`,
  name: `${TAG} organizer`,
  eventId: "",
  role: "admin",
  viewRole: "admin",
};
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { drawLeagueWeek, nominatePair, setPlayoffHoleWinner } = await import("@/app/actions/league");
const { leagueTable, leaguePlayoffs, leagueSeason, leagueMeetings } = await import("@/lib/services/league");

const club: string[] = [];
const roster: string[][] = [];
const week: string[] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const flat = (s: number) => JSON.stringify(new Array(18).fill(s));

async function nominate(w: number, clubs: number[]) {
  for (const c of clubs) {
    expect(await nominatePair(week[w], club[c], roster[c]), `week ${w} club ${c}`).toEqual({ ok: true });
  }
}

/** Enter every card in a round, each club's players shooting `score(club)` on every hole. */
async function score(w: number, strokes: (clubIndex: number) => number) {
  const matches = await prisma.match.findMany({
    where: { eventId: session.eventId, stageId: week[w] },
    select: { teamAId: true, teamBId: true },
  });
  for (const m of matches) {
    for (const teamId of [m.teamAId, m.teamBId]) {
      const side = await prisma.team.findUniqueOrThrow({
        where: { id: teamId! },
        select: { clubGroupId: true, members: { select: { playerId: true } } },
      });
      for (const { playerId } of side.members) {
        await prisma.teamScorecard.create({
          data: {
            eventId: session.eventId,
            stageId: week[w],
            teamId: teamId!,
            playerId,
            strokes: flat(strokes(club.indexOf(side.clubGroupId!))),
          },
        });
      }
    }
  }
}

const strength = (c: number) => 4 + c;

/** The clubs meeting in a round, as sorted "i-j" labels. */
async function meetingsOf(w: number) {
  const matches = await prisma.match.findMany({
    where: { eventId: session.eventId, stageId: week[w] },
    select: { teamAId: true, teamBId: true },
  });
  const clubOfTeam = async (id: string) =>
    club.indexOf(
      (await prisma.team.findUniqueOrThrow({ where: { id }, select: { clubGroupId: true } })).clubGroupId!,
    );
  const labels: string[] = [];
  for (const m of matches) {
    const pair = [await clubOfTeam(m.teamAId!), await clubOfTeam(m.teamBId!)].sort();
    labels.push(pair.join("-"));
  }
  return labels.sort();
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      leaguePoints: "holes",
      leaguePlayoffClubs: 4,
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  session.eventId = event.id;

  for (let c = 0; c < 4; c += 1) {
    const g = await prisma.group.create({
      data: { eventId: event.id, name: `${TAG} club ${c}`, position: c },
      select: { id: true },
    });
    club.push(g.id);
    const players: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const p = await prisma.player.create({
        data: {
          eventId: event.id,
          name: `${TAG} c${c}p${i}`,
          email: `${TAG}-c${c}p${i}@example.invalid`,
          handicap: 0,
          seed: 1,
          status: "confirmed",
          groupId: g.id,
        },
        select: { id: true },
      });
      players.push(p.id);
    }
    roster.push(players);
  }

  for (let w = 0; w < 4; w += 1) {
    const s = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: w,
        type: "Round Robin",
        format: "Four-Ball",
        holes: 18,
        scoringBasis: "gross",
        handicapAllowance: 100,
      },
      select: { id: true },
    });
    week.push(s.id);
  }
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a season with play-offs", () => {
  it("splits four team rounds into two season weeks and two play-off rounds", async () => {
    expect(await leagueSeason(session.eventId)).toEqual({
      season: [week[0], week[1]],
      playoffs: [week[2], week[3]],
      size: 4,
    });
  });

  it("lists every club, and a provisional bracket, before anybody has nominated", async () => {
    const table = (await leagueTable(session.eventId, "holes")).rows;
    expect(table.map((r) => club.indexOf(r.clubId))).toEqual([0, 1, 2, 3]);
    const bracket = await leaguePlayoffs(session.eventId, "holes");
    expect(bracket?.rounds[0].meetings.map((m) => m && `${club.indexOf(m.clubA)}v${club.indexOf(m.clubB)}`)).toEqual(
      ["0v3", "1v2"],
    );
  });

  it("plays the season on the rotation", async () => {
    await nominate(0, [0, 1, 2, 3]);
    expect(await drawLeagueWeek(week[0])).toMatchObject({ ok: true, matches: 2, playoff: null });
    expect(await meetingsOf(0)).toEqual(["0-3", "1-2"]);
    await score(0, strength);

    await nominate(1, [0, 1, 2, 3]);
    expect(await drawLeagueWeek(week[1])).toMatchObject({ ok: true, matches: 2, playoff: null });
    expect(await meetingsOf(1)).toEqual(["0-2", "1-3"]);
  });

  it("will not draw the semi-finals while a season meeting is still out", async () => {
    await nominate(2, [0, 1, 2, 3]);
    const res = await drawLeagueWeek(week[2]);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/is not finished yet/);
    expect(await prisma.match.count({ where: { stageId: week[2] } })).toBe(0);
  });

  it("seeds the semi-finals from the finished season, 1 v 4 and 2 v 3", async () => {
    await score(1, strength);

    // Holes won only: clubs 0 and 1 won every hole of both meetings.
    const table = (await leagueTable(session.eventId, "holes")).rows;
    expect(table.map((r) => [club.indexOf(r.clubId), r.points, r.won])).toEqual([
      [0, 36, 2],
      [1, 36, 2],
      [2, 0, 0],
      [3, 0, 0],
    ]);

    expect(await drawLeagueWeek(week[2])).toMatchObject({ ok: true, matches: 2, playoff: "Semi-finals" });
    expect(await meetingsOf(2)).toEqual(["0-3", "1-2"]);
  });

  it("will not draw the final until both semi-finals have a result", async () => {
    await nominate(3, [0, 1, 2, 3]);
    const res = await drawLeagueWeek(week[3]);
    expect(res.ok).toBe(false);
    expect(await prisma.match.count({ where: { stageId: week[3] } })).toBe(0);
  });

  it("sends the upset winner through, and holds the level meeting for a play-off hole", async () => {
    // Club 3 shoots 3s and beats the top seed; clubs 1 and 2 both shoot 5s.
    await score(2, (c) => (c === 3 ? 3 : c === 0 ? 4 : 5));

    const held = await leaguePlayoffs(session.eventId, "holes");
    expect(held?.rounds.map((r) => r.name)).toEqual(["Semi-finals", "Final"]);
    /**
     * The upset is decided and 1 v 2 is not, so the final has one club and
     * therefore no meeting. The app used to fill the gap from the seeding;
     * a level meeting is settled on a play-off hole now (Ajay, 2026-09-18).
     */
    expect(held!.rounds[1].meetings).toEqual([null]);
    expect(
      held!.rounds[0].awaitingHole.map(([a, b]) => [club.indexOf(a), club.indexOf(b)]),
      "the level semi-final was not flagged",
    ).toEqual([[1, 2]]);
    expect(await drawLeagueWeek(week[3])).toMatchObject({ ok: false });

    // The committee reports the play-off hole: club 1 won it.
    expect(await setPlayoffHoleWinner(week[2], club[1], club[2], club[1])).toEqual({ ok: true });

    const bracket = await leaguePlayoffs(session.eventId, "holes");
    const final = bracket!.rounds[1].meetings[0];
    expect(final && [club.indexOf(final.clubA), final.seedA, club.indexOf(final.clubB), final.seedB]).toEqual([
      3, 4, 1, 2,
    ]);
    expect(bracket!.champion).toBeNull();

    expect(await drawLeagueWeek(week[3])).toMatchObject({ ok: true, matches: 1, playoff: "Final" });
    expect(await meetingsOf(3)).toEqual(["1-3"]);
  });

  it("leaves the season table alone — a semi-final is not a season week", async () => {
    const table = (await leagueTable(session.eventId, "holes")).rows;
    const three = table.find((r) => r.clubId === club[3]);
    // Club 3 won eighteen holes in the semi-final; none of them count here.
    expect(three).toMatchObject({ points: 0, played: 2, won: 0 });
  });

  it("crowns the winner of the final", async () => {
    await score(3, (c) => (c === 1 ? 4 : 6));
    const bracket = await leaguePlayoffs(session.eventId, "holes");
    expect(bracket?.champion).toBe(club[1]);
  });

  it("has no play-offs, and counts every round, when the league has none", async () => {
    await prisma.event.update({ where: { id: session.eventId }, data: { leaguePlayoffClubs: 0 } });
    try {
      expect(await leaguePlayoffs(session.eventId, "holes")).toBeNull();
      const three = (await leagueTable(session.eventId, "holes")).rows.find((r) => r.clubId === club[3]);
      // Now both play-off rounds count: eighteen holes from the semi-final,
      // none from the final, and two more meetings.
      expect(three).toMatchObject({ points: 18, played: 4 });
    } finally {
      await prisma.event.update({ where: { id: session.eventId }, data: { leaguePlayoffClubs: 4 } });
    }
  });
});

describe("the committee's tiebreak chain decides a level table", () => {
  /**
   * THE CHAIN IS THE TOURNAMENT'S, NOT THE ALPHABET'S. Two clubs level on
   * points are separated by `Event.tiebreakers` — the same chain the player
   * standings use — and only by the name when nothing in it can.
   *
   * Run against the fixture above, whose season left clubs 2 and 3 level on
   * nothing: club 2 lost both meetings and so did club 3, so the points are
   * equal and their head-to-head never happened in the season.
   */
  const order = async () => (await leagueTable(session.eventId, "holes")).rows.map((r) => club.indexOf(r.clubId));

  it("records the holes each club won and lost, for the committee to rank on", async () => {
    await prisma.event.update({
      where: { id: session.eventId },
      data: { tiebreakers: JSON.stringify(["holes-won-ratio"]) },
    });
    const rows = (await leagueTable(session.eventId, "holes")).rows;
    const top = rows.find((r) => r.clubId === club[0])!;
    const bottom = rows.find((r) => r.clubId === club[3])!;
    // Club 0 won every hole of both its meetings; club 3 lost every hole of
    // both of its. Twelve pairings of eighteen holes either way.
    expect([top.holesWon, top.holesLost]).toEqual([36, 0]);
    expect([bottom.holesWon, bottom.holesLost]).toEqual([0, 36]);
  });

  it("says which rule it used, in the committee's own words", async () => {
    const table = await leagueTable(session.eventId, "holes");
    expect(table.orderNote).toBe("Ranked on points, then hole differential (won − lost), then by name.");
  });

  it("ignores a chain of keys that mean nothing to a club", async () => {
    await prisma.event.update({
      where: { id: session.eventId },
      data: { tiebreakers: JSON.stringify(["toughest-6", "lower-handicap"]) },
    });
    const table = await leagueTable(session.eventId, "holes");
    expect(table.orderNote).toBe("Ranked on points. Clubs level on points are listed by name.");
    // Nothing usable, so the level clubs fall back to their names.
    const rows = table.rows.filter((r) => r.points === 0).map((r) => r.name);
    expect([...rows].sort()).toEqual(rows);
  });

  it("seeds the play-offs in the order the table is printed in", async () => {
    await prisma.event.update({
      where: { id: session.eventId },
      data: { tiebreakers: JSON.stringify(["holes-won-ratio"]) },
    });
    const table = await leagueTable(session.eventId, "holes");
    const bracket = await leaguePlayoffs(session.eventId, "holes");
    const seeds = bracket!.rounds[0].meetings.flatMap((m) => (m ? [m.clubA, m.clubB] : []));
    // Seeds 1..4 are the first four rows, in bracket order 1v4, 2v3.
    const top = table.rows.slice(0, 4).map((r) => r.clubId);
    expect(seeds).toEqual([top[0], top[3], top[1], top[2]]);
    expect(await order()).toHaveLength(4);
  });
});

describe("a level play-off meeting, and a committee decision", () => {
  /**
   * Ajay, 2026-09-18: a tie is settled by a play-off hole, and the club may
   * overturn a played result "with cautions". Both are decisions the app
   * cannot watch happen, so both are recorded — and both are shown.
   */
  /**
   * Re-score 0 v 3 so it halves every hole. 1 v 2 keeps the play-off hole
   * the cell above recorded, so exactly one meeting is left level.
   */
  async function halveTheSemi() {
    const sides = await prisma.team.findMany({
      where: { stageId: week[2], clubGroupId: { in: [club[0], club[3]] } },
      select: { id: true },
    });
    await prisma.teamScorecard.updateMany({
      where: { teamId: { in: sides.map((s) => s.id) } },
      data: { strokes: flat(4) },
    });
  }

  it("sends nobody through while the semi-final is level, and says so", async () => {
    await halveTheSemi();
    const bracket = await leaguePlayoffs(session.eventId, "holes");
    expect(bracket!.rounds[1].meetings, "invented a winner from the seeding").toEqual([null]);
    expect(bracket!.rounds[0].awaitingHole.length, "did not flag the level meeting").toBe(1);

    // And the final cannot be drawn off a bracket nobody has come through.
    const res = await drawLeagueWeek(week[3], true);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/finished level/);
  });

  it("records who won the play-off hole, and moves the bracket on", async () => {
    expect(await setPlayoffHoleWinner(week[2], club[0], club[3], club[3])).toEqual({ ok: true });
    const bracket = await leaguePlayoffs(session.eventId, "holes");
    const through = bracket!.rounds[1].meetings[0];
    expect(
      through && [through.clubA, through.clubB].includes(club[3]),
      "the hole winner is not through",
    ).toBe(true);

    const decision = bracket!.rounds[0].decisions.find((d) => d.winner === club[3]);
    expect(decision, "the decision is not on the bracket at all").toBeTruthy();
    expect(decision!.overrode, "a level meeting is not an override").toBe(false);
  });

  it("refuses a club that did not play the meeting", async () => {
    expect(await setPlayoffHoleWinner(week[2], club[0], club[3], club[1])).toEqual({
      ok: false,
      error: "The winner has to be one of the two clubs that played.",
    });
  });

  it("refuses to overturn a played result without a reason, then records one that says so", async () => {
    // The FINAL, which club 1 won outright — both semi-finals are level.
    const played = (await leagueMeetings(session.eventId, week[3], "holes")).find(
      (m) => m.pointsA !== m.pointsB,
    );
    expect(played, "no decided meeting to overturn").toBeTruthy();
    const winnerSide = played!.pointsA > played!.pointsB ? played!.clubAId : played!.clubBId;
    const loserSide = winnerSide === played!.clubAId ? played!.clubBId : played!.clubAId;

    const bare = await setPlayoffHoleWinner(week[3], played!.clubAId, played!.clubBId, loserSide);
    expect(bare.ok).toBe(false);
    expect(!bare.ok && bare.error).toMatch(/committee decision, and needs a reason/);

    const empty = await setPlayoffHoleWinner(week[3], played!.clubAId, played!.clubBId, loserSide, {
      reason: " ",
    });
    expect(empty).toEqual({ ok: false, error: "Say why the committee is overturning the result." });

    const recorded = await setPlayoffHoleWinner(
      week[3],
      played!.clubAId,
      played!.clubBId,
      loserSide,
      { reason: "Ineligible player in the second pair" },
    );
    expect(recorded).toEqual({ ok: true });

    const bracket = await leaguePlayoffs(session.eventId, "holes");
    const decision = bracket!.rounds[1].decisions.find((d) => d.winner === loserSide);
    expect(decision).toMatchObject({
      overrode: true,
      note: "Ineligible player in the second pair",
    });
    expect(decision!.decidedBy, "a decision with nobody's name on it").toBeTruthy();

    // The decision, not the points, crowns the champion.
    expect(bracket!.champion, "the points still decided it").toBe(loserSide);
  });

  it("writes every decision to the audit log, naming what it overturned", async () => {
    const lines = await prisma.auditLog.findMany({
      where: { eventId: session.eventId, action: "league-playoff-hole" },
      select: { detail: true },
    });
    expect(lines.some((l) => /beat .* on the play-off hole/.test(l.detail))).toBe(true);
    expect(
      lines.some((l) => /committee overturned the result: Ineligible player/.test(l.detail)),
      "an override with no trail",
    ).toBe(true);
  });
});
