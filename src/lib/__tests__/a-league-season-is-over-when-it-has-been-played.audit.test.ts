import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A LEAGUE SEASON IS OVER WHEN IT HAS BEEN PLAYED — NOT WHEN IT HAS BEEN DRAWN,
 * AND NOT BEFORE.
 *
 * Three things a league built for the purpose said on 2026-10-13, each of them
 * a statement about golf nobody had played:
 *
 *   the table        "Played 1" for every club on the day a week was DRAWN.
 *                    A meeting exists from the draw, and the table counted
 *                    every meeting that exists. The pairs' own table on the
 *                    leaderboard said "P 0" of the same four-balls.
 *   the play-offs    "Final: (1) A v B (2)" over a league in which nobody had
 *                    played — the two clubs first in the alphabet — with
 *                    nothing to say it was where the table stood and not who
 *                    was in the final.
 *   the draw         with one week of three played and pairs put up on the
 *                    final's tab, Draw made the final. Its check, "every
 *                    meeting before them has a result", is made of the
 *                    meetings that exist, and a week nobody drew has none.
 *
 * One league, four clubs of one pair each, three season weeks and a final,
 * walked in the order a secretary would. The complete season, drawn without a
 * question, is `league-playoff.audit.test.ts`: that is the control for the
 * question asked here.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-league-season";

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

const { drawLeagueWeek, nominatePair } = await import("@/app/actions/league");
const { leagueTable, leaguePlayoffs } = await import("@/lib/services/league");

const club: string[] = [];
const roster: string[][] = [];
const week: string[] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** Every side of a week returns a card of `strokes(club)` on each of the first `holes` holes. */
async function score(w: number, strokes: (clubIndex: number) => number, holes = 18) {
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
      const s = strokes(club.indexOf(side.clubGroupId!));
      const card = JSON.stringify(Array.from({ length: 18 }, (_, h) => (h < holes ? s : null)));
      for (const { playerId } of side.members) {
        await prisma.teamScorecard.upsert({
          where: { stageId_matchId_teamId_playerId: { stageId: week[w], matchId: "", teamId: teamId!, playerId } },
          update: { strokes: card },
          create: { eventId: session.eventId, stageId: week[w], teamId: teamId!, playerId, strokes: card },
        });
      }
    }
  }
}

const table = async () => leagueTable(session.eventId, "match");
const playedBy = async () => (await table()).rows.map((r) => r.played);

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      leaguePoints: "match",
      leaguePlayoffClubs: 2,
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
    const g = await prisma.group.create({ data: { eventId: event.id, name: `${TAG} club ${c}`, position: c }, select: { id: true } });
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

  // Three season weeks — every club meets every other once — and a final.
  for (let w = 0; w < 4; w += 1) {
    const s = await prisma.stage.create({
      data: { eventId: event.id, position: w, type: "Round Robin", format: "Four-Ball", holes: 18, scoringBasis: "gross", handicapAllowance: 100 },
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

describe("before anybody has played", () => {
  it("nobody has played a meeting, all six are still to come, and the final is where the table stands", async () => {
    const t = await table();
    expect(t.rows.map((r) => r.played)).toEqual([0, 0, 0, 0]);
    expect(t.unsettled, "three weeks of two meetings").toBe(6);
    const bracket = await leaguePlayoffs(session.eventId, "match");
    expect(bracket?.rounds.map((r) => r.name)).toEqual(["Final"]);
    expect(bracket?.provisional, "the final is printed as settled over a season nobody has played").toBe(6);
  });

  it("a week that has been DRAWN has not been played", async () => {
    for (let c = 0; c < 4; c += 1) expect(await nominatePair(week[0], club[c], roster[c])).toEqual({ ok: true });
    expect(await drawLeagueWeek(week[0])).toMatchObject({ ok: true, matches: 2 });
    expect(await playedBy(), "a drawn meeting was counted as played").toEqual([0, 0, 0, 0]);
    expect((await table()).unsettled).toBe(6);
  });

  it("and neither has one still out on the course", async () => {
    // Nine holes in: club 0 and club 1 are winning, and nothing is over.
    await score(0, (c) => 4 + c, 9);
    const t = await table();
    expect(t.rows.map((r) => r.played), "a meeting nine holes old was counted as played").toEqual([0, 0, 0, 0]);
    expect(t.rows.map((r) => r.won)).toEqual([0, 0, 0, 0]);
    expect(t.unsettled).toBe(6);
  });
});

describe("once a week is in", () => {
  it("each club has played one, the winners have won one, and four meetings are left", async () => {
    await score(0, (c) => 4 + c);
    const t = await table();
    const byClub = new Map(t.rows.map((r) => [club.indexOf(r.clubId), r]));
    for (let c = 0; c < 4; c += 1) expect(byClub.get(c)!.played, `club ${c}`).toBe(1);
    // CONTROL: the week really was decided — somebody won, and it was the lower scorers.
    expect(t.rows.reduce((n, r) => n + r.won, 0)).toBe(2);
    expect(byClub.get(0)!.won).toBe(1);
    expect(byClub.get(3)!.won).toBe(0);
    expect(t.unsettled).toBe(4);
    expect((await leaguePlayoffs(session.eventId, "match"))?.provisional).toBe(4);
  });
});

describe("drawing the final off a season with two weeks never played", () => {
  it("asks first, with the number of meetings that were never played, and draws nothing", async () => {
    const seeded = (await table()).rows.slice(0, 2).map((r) => club.indexOf(r.clubId));
    for (const c of seeded) expect(await nominatePair(week[3], club[c], roster[c])).toEqual({ ok: true });

    const res = await drawLeagueWeek(week[3]);
    expect(res).toEqual({ ok: false, error: "4 season meetings were never played.", needsConfirm: true, missing: 4 });
    expect(await prisma.match.count({ where: { stageId: week[3] } }), "asked, and drew anyway").toBe(0);
    // Saying yes to the OTHER question is not saying yes to this one.
    expect(await drawLeagueWeek(week[3], true)).toMatchObject({ ok: false, needsConfirm: true, missing: 4 });
    expect(await prisma.match.count({ where: { stageId: week[3] } })).toBe(0);
  });

  it("draws it when the committee says so, and the final is then the final", async () => {
    expect(await drawLeagueWeek(week[3], false, true)).toMatchObject({ ok: true, matches: 1, playoff: "Final" });
    expect(await prisma.match.count({ where: { stageId: week[3] } })).toBe(1);
    const bracket = await leaguePlayoffs(session.eventId, "match");
    expect(bracket?.provisional, "a final that has been drawn is still printed as provisional").toBe(0);
    // The table still says how much of the season was not played.
    expect((await table()).unsettled).toBe(4);
  });

  it("and drawing it again is asked about twice: the season, then the draw it would replace", async () => {
    expect(await drawLeagueWeek(week[3])).toMatchObject({ ok: false, needsConfirm: true, missing: 4 });
    const second = await drawLeagueWeek(week[3], false, true);
    expect(second).toMatchObject({ ok: false, needsConfirm: true, existing: 1 });
    expect(!second.ok && second.missing, "the second question is the season again").toBeUndefined();
    expect(await drawLeagueWeek(week[3], true, true)).toMatchObject({ ok: true, matches: 1, playoff: "Final" });
  });
});
