import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * "ONE CARD FOR THE SIDE" ON A GROSS FOUR-BALL IS SAVED AND SCORED (2026-10-10).
 *
 * The Rounds screen offers it on a two-ball round played on gross, and the
 * entry screen honoured it — one card per side. Then the save refused that card
 * ("needs a card for each partner") and the board read only the partners' own
 * cards, so the setting was a dead end. `oneCardPerSide` is now the one answer
 * every writer and reader asks.
 *
 * Best of TWO is the case worth pinning: the side's card then carries two balls
 * a hole, so par for it is twice the hole's — 8s on par 4s are level par, not
 * thirty-six over.
 *
 * Controls: the same format WITHOUT the setting still wants a card each, and
 * refuses the side's.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SIDEONLY";
const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

let session: Record<string, string> | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveTeamScorecard, importTeamScores } = await import("@/app/actions/tournament");
const { teamStandings } = await import("@/lib/services/teams");

const ids = { event: "", oneCard: "", bestTwo: "", perPlayer: "", s1: "", s2: "", s3: "", p: [] as string[] };

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
  const stage = (position: number, format: string, scoreInput: string, countBest = 0) =>
    prisma.stage.create({
      data: { eventId: event.id, position, description: format, type: "Stroke Play Round", format, scoringBasis: "gross", holes: 18, scoreInput, countBest },
    });
  ids.oneCard = (await stage(0, "Four-Ball", "side-only")).id;
  ids.bestTwo = (await stage(1, "Best Ball", "side-only", 2)).id;
  ids.perPlayer = (await stage(2, "Four-Ball", "")).id;
  for (let i = 0; i < 6; i += 1) {
    ids.p.push(
      (
        await prisma.player.create({
          data: { eventId: event.id, name: `${TAG} P${i}`, email: `${TAG}-p${i}@example.invalid`.toLowerCase(), status: "confirmed", handicap: 12, seed: i },
        })
      ).id,
    );
  }
  const side = async (stageId: string, members: string[]) =>
    (
      await prisma.team.create({
        data: { eventId: event.id, stageId, name: `${TAG} side ${stageId.slice(-4)}`, members: { create: members.map((playerId, position) => ({ playerId, position })) } },
      })
    ).id;
  ids.s1 = await side(ids.oneCard, [ids.p[0], ids.p[1]]);
  ids.s2 = await side(ids.bestTwo, [ids.p[2], ids.p[3]]);
  ids.s3 = await side(ids.perPlayer, [ids.p[4], ids.p[5]]);
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
const board = (stageId: string, format: string, countBest = 0) =>
  teamStandings(ids.event, stageId, format, PARS, SI, "gross", 0, null, countBest);

describe("a gross four-ball entered as one card for the side", () => {
  it("saves the side's card and the board scores it, off no handicap", async () => {
    expect(await saveTeamScorecard(ids.s1, "", "", card(4))).toEqual({ ok: true });
    const [row] = await board(ids.oneCard, "Four-Ball");
    expect([row.played, row.gross, row.toPar]).toEqual([18, 72, 0]);
  });

  it("refuses a partner's own card on that round", async () => {
    expect((await saveTeamScorecard(ids.s1, ids.p[0], "", card(4))).ok).toBe(false);
  });

  it("reads a best-two card against par for two balls", async () => {
    const out = await importTeamScores(ids.bestTwo, [{ playerId: ids.p[2], strokes: card(8) }]);
    expect(out).toMatchObject({ ok: true, written: 1 });
    const stored = await prisma.teamScorecard.findMany({ where: { stageId: ids.bestTwo }, select: { playerId: true } });
    expect(stored).toEqual([{ playerId: "" }]);
    const [row] = await board(ids.bestTwo, "Best Ball", 2);
    expect([row.played, row.gross, row.toPar]).toEqual([18, 144, 0]);
  });
});

describe("CONTROL: the same format without the setting", () => {
  it("still wants a card each, and refuses the side's", async () => {
    expect((await saveTeamScorecard(ids.s3, "", "", card(4))).ok).toBe(false);
    expect(await saveTeamScorecard(ids.s3, ids.p[4], "", card(4))).toEqual({ ok: true });
    const [row] = await board(ids.perPlayer, "Four-Ball");
    expect([row.played, row.gross]).toEqual([18, 72]);
  });
});
