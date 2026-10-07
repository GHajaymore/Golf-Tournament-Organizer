import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * SEVERAL CARDS IN ONE SAVE, AND NOT ONE MORE THAN THE CALLER MAY WRITE
 * (2026-10-07).
 *
 * `saveScorecards` and `saveTeamScorecards` carry every card a casual phone
 * changed in ONE request, because a second request sent as the scorer leaves
 * the screen was aborted and its card lost. They are new public endpoints, so
 * what is asserted here is the half a batch could get wrong: a card from
 * another tournament slipped into the list is refused and NOT written, while
 * the caller's own cards in the same batch still are.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-BATCH";
const email = `${TAG}.host@example.invalid`.toLowerCase();

let session: { eventId: string; email: string; viewRole: string; name: string; role: string; userId: string; accountId: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveScorecards, saveTeamScorecards } = await import("@/app/actions/tournament");

const ids = { a: "", c: "", stageA: "", stageC: "", ann: "", bea: "", stranger: "", teamC: "" };
const NINE = [4, 5, 3, 4, 4, 4, 3, 4, 5, null, null, null, null, null, null, null, null, null];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function event(name: string, orgId: string) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      status: "live",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${process.pid}`,
    },
  });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const other = await prisma.organization.create({ data: { name: `${TAG} other club`, kind: "club" } });
  const a = await event("A round", org.id);
  const c = await event("C elsewhere", other.id);
  await prisma.account.create({ data: { eventId: a.id, email, name: "zz host", role: "admin" } });
  const stageA = await prisma.stage.create({ data: { eventId: a.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  const stageC = await prisma.stage.create({ data: { eventId: c.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  const ann = await prisma.player.create({ data: { eventId: a.id, name: `${TAG} Ann`, email: `${TAG}.ann@example.invalid`.toLowerCase(), seed: 1, status: "confirmed" } });
  const bea = await prisma.player.create({ data: { eventId: a.id, name: `${TAG} Bea`, email: `${TAG}.bea@example.invalid`.toLowerCase(), seed: 2, status: "confirmed" } });
  const stranger = await prisma.player.create({ data: { eventId: c.id, name: `${TAG} stranger`, email: `${TAG}.x@example.invalid`.toLowerCase(), seed: 1, status: "confirmed" } });
  const teamC = await prisma.team.create({ data: { eventId: c.id, stageId: stageC.id, name: `${TAG} their side` } });
  Object.assign(ids, { a: a.id, c: c.id, stageA: stageA.id, stageC: stageC.id, ann: ann.id, bea: bea.id, stranger: stranger.id, teamC: teamC.id });
});

beforeEach(async () => {
  session = { eventId: ids.a, email, viewRole: "admin", name: "zz host", role: "admin", userId: "zz", accountId: "" };
  await prisma.scorecard.deleteMany({ where: { stageId: { in: [ids.stageA, ids.stageC] } } });
  await prisma.teamScorecard.deleteMany({ where: { stageId: { in: [ids.stageA, ids.stageC] } } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("cards saved together", () => {
  it("writes every card in the batch, each to its own player", async () => {
    const res = await saveScorecards(ids.stageA, [
      { playerId: ids.ann, strokes: NINE },
      { playerId: ids.bea, strokes: NINE.map((s) => (s == null ? null : s + 1)) },
    ]);
    expect(res).toEqual([
      { playerId: ids.ann, ok: true },
      { playerId: ids.bea, ok: true },
    ]);
    const rows = await prisma.scorecard.findMany({ where: { stageId: ids.stageA }, select: { playerId: true, strokes: true } });
    const byPlayer = Object.fromEntries(rows.map((r) => [r.playerId, JSON.parse(r.strokes)]));
    expect(byPlayer[ids.ann].slice(0, 3)).toEqual([4, 5, 3]);
    expect(byPlayer[ids.bea].slice(0, 3)).toEqual([5, 6, 4]);
  });

  it("refuses a player from another tournament slipped into the batch, and still saves the rest", async () => {
    const res = await saveScorecards(ids.stageA, [
      { playerId: ids.stranger, strokes: NINE },
      { playerId: ids.ann, strokes: NINE },
    ]);
    expect(res[0]).toMatchObject({ playerId: ids.stranger, ok: false });
    expect(res[1]).toEqual({ playerId: ids.ann, ok: true });
    expect(await prisma.scorecard.findFirst({ where: { playerId: ids.stranger } })).toBeNull();
    expect(await prisma.scorecard.findFirst({ where: { stageId: ids.stageA, playerId: ids.ann } })).not.toBeNull();
  });

  it("refuses a round in a tournament the caller cannot reach, and writes nothing", async () => {
    await expect(saveScorecards(ids.stageC, [{ playerId: ids.stranger, strokes: NINE }])).rejects.toThrow();
    expect(await prisma.scorecard.findFirst({ where: { stageId: ids.stageC } })).toBeNull();
  });

  it("refuses a team from another tournament, and writes nothing", async () => {
    const res = await saveTeamScorecards([{ teamId: ids.teamC, playerId: "", matchId: "", strokes: NINE }]);
    expect(res).toEqual([{ ok: false, error: "That team isn't in this tournament." }]);
    expect(await prisma.teamScorecard.findFirst({ where: { teamId: ids.teamC } })).toBeNull();
  });

  it("refuses a batch larger than any round", async () => {
    const many = Array.from({ length: 25 }, () => ({ playerId: ids.ann, strokes: NINE }));
    const res = await saveScorecards(ids.stageA, many);
    expect(res).toEqual([{ playerId: "", ok: false, error: "Too many cards in one save." }]);
    expect(await prisma.scorecard.findFirst({ where: { stageId: ids.stageA } })).toBeNull();
  });
});
