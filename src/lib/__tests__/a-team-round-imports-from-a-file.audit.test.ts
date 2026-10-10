import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A TEAM ROUND'S CARDS IMPORT FROM A FILE (2026-10-10).
 *
 * A 120-player four-ball came back as a spreadsheet and could only be typed in
 * side by side: `importScores` writes `Scorecard`, which a team round never
 * reads. `importTeamScores` files each row on its SIDE — a player's own ball
 * on a four-ball, one card per side on a scramble — and the board then reads
 * it, which is the assertion that matters: a card written where no reader
 * looks is the defect this replaces.
 *
 * Controls: a player on no side is reported, not written; a four-ball row
 * naming only the side is refused (whose ball would it be?); a scramble side
 * named twice keeps the first card.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TEAMIMPORT";
const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

let session: Record<string, string> | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { importTeamScores } = await import("@/app/actions/tournament");
const { teamStandings } = await import("@/lib/services/teams");

const ids = { event: "", fourBall: "", scramble: "", fbSide: "", scSide: "", ann: "", ben: "", cal: "", dee: "", loner: "" };

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id, name: `${TAG} pairs`, format: "stroke", status: "live", dates: "", course: "",
      city: "", address: "", regDeadline: "", shareToken: `${TAG}-${process.pid}`,
      customPars: JSON.stringify(PARS), customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
    },
  });
  ids.event = event.id;
  const stage = (position: number, format: string) =>
    prisma.stage.create({
      data: { eventId: event.id, position, description: format, type: "Stroke Play Round", format, scoringBasis: "gross", holes: 18 },
    });
  ids.fourBall = (await stage(0, "Four-Ball")).id;
  ids.scramble = (await stage(1, "Scramble")).id;
  const player = async (name: string) =>
    (
      await prisma.player.create({
        data: { eventId: event.id, name: `${TAG} ${name}`, email: `${TAG}-${name}@example.invalid`.toLowerCase(), status: "confirmed", handicap: 10, seed: 0 },
      })
    ).id;
  for (const who of ["ann", "ben", "cal", "dee", "loner"] as const) ids[who] = await player(who);
  const side = async (stageId: string, name: string, members: string[]) =>
    (
      await prisma.team.create({
        data: { eventId: event.id, stageId, name, members: { create: members.map((playerId, position) => ({ playerId, position })) } },
      })
    ).id;
  ids.fbSide = await side(ids.fourBall, `${TAG} Ann & Ben`, [ids.ann, ids.ben]);
  ids.scSide = await side(ids.scramble, `${TAG} Cal & Dee`, [ids.cal, ids.dee]);
  session = { eventId: event.id, email: `${TAG}-staff@example.invalid`.toLowerCase(), viewRole: "admin", name: "staff", role: "admin", userId: "", accountId: "" };
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const card = (n: number) => new Array(18).fill(n);
const board = (stageId: string, format: string) => teamStandings(ids.event, stageId, format, PARS, SI, "gross");

describe("importing a four-ball", () => {
  it("files each player's card on their side, and the board reads the better ball", async () => {
    const out = await importTeamScores(ids.fourBall, [
      { playerId: ids.ann, strokes: card(5) },
      { playerId: ids.ben, strokes: card(4) },
    ]);
    expect(out).toMatchObject({ ok: true, written: 2 });
    const rows = await prisma.teamScorecard.findMany({ where: { stageId: ids.fourBall }, select: { teamId: true, playerId: true, matchId: true } });
    expect(rows.map((r) => [r.teamId, r.playerId, r.matchId]).sort()).toEqual(
      [[ids.fbSide, ids.ann, ""], [ids.fbSide, ids.ben, ""]].sort(),
    );
    const [side] = await board(ids.fourBall, "Four-Ball");
    expect([side.played, side.gross]).toEqual([18, 72]);
  });

  it("CONTROL: a player on no side, and a row naming only the side, are refused", async () => {
    const out = await importTeamScores(ids.fourBall, [
      { playerId: ids.loner, strokes: card(3) },
      { teamId: ids.fbSide, strokes: card(3) },
    ]);
    expect(out.written).toBe(0);
    expect(out.problems).toHaveLength(2);
    expect(await prisma.teamScorecard.count({ where: { stageId: ids.fourBall } })).toBe(2);
  });
});

describe("importing a scramble", () => {
  it("files ONE card for the side, named by the side or a player, and keeps the first", async () => {
    const out = await importTeamScores(ids.scramble, [
      { teamId: ids.scSide, strokes: card(4) },
      { playerId: ids.dee, strokes: card(6) },
    ]);
    expect(out).toMatchObject({ ok: true, written: 1 });
    expect(out.problems).toHaveLength(1);
    const rows = await prisma.teamScorecard.findMany({ where: { stageId: ids.scramble }, select: { teamId: true, playerId: true } });
    expect(rows).toEqual([{ teamId: ids.scSide, playerId: "" }]);
    const [side] = await board(ids.scramble, "Scramble");
    expect([side.played, side.gross]).toEqual([18, 72]);
  });
});
