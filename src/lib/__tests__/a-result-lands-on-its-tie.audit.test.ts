import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { parsePlayBy } from "../domain/knockout-play-by";

/**
 * A RESULT FROM THE "TO PLAY" LIST LANDS ON ITS TIE — AND ONLY THERE (the panel,
 * 2026-10-23: "a result is saved by TIE ID, never by position, and its
 * confirmation names the round and both players").
 *
 * `recordTieResult` is sent the tie's key AND its two players. These drive the
 * real action against real rows and read the draw back through `loadEventState`:
 *
 *   - a result for the tie as it stands is recorded, margin and all, and said
 *     back naming the round and both players;
 *   - the same key sent with a different pair (the place now holds another tie)
 *     writes nothing and says why;
 *   - a winner from outside the tie, a tie already decided, a tie waiting on the
 *     one before it: refused, nothing written;
 *   - conceded, walkover and withdrawn are recorded in golf's words;
 *   - a player cannot call it at all.
 *
 * And `setKnockoutPlayBy`: dates are kept for this tournament's knockout only,
 * and refused when a round would be due after the round it feeds.
 *
 * Needs a live DATABASE_URL:
 *   npx vitest run --config vitest.audit.config.ts
 */

let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { recordTieResult, setKnockoutPlayBy } = await import("@/app/actions/tournament");

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TIE-LANDS";
let orgId = "";

async function seed(n = 4) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${stamp}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "live",
      shareToken: `audit-lands-${stamp}`,
      bracketMode: "single",
    },
  });
  const stage = await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  for (let i = 0; i < n; i += 1) {
    await prisma.player.create({
      data: { eventId: event.id, name: `${TAG} P${i + 1}`, email: `${TAG.toLowerCase()}-${i}-${stamp}@example.invalid`, handicap: 5 + i, seed: i + 1, status: "confirmed" },
    });
  }
  session = { eventId: event.id, email: `${TAG.toLowerCase()}-staff@example.invalid`, viewRole: "admin", name: `${TAG} staff`, role: "admin" };
  const state = await loadEventState(event.id);
  return { eventId: event.id, stageId: stage.id, view: state!.brackets.winners };
}

const rows = (eventId: string) => prisma.bracketWinner.findMany({ where: { eventId }, select: { key: true, winnerId: true, result: true } });

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  orgId = (await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } })).id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("a result from the To-play list", () => {
  it("lands on the tie it was entered for, and says so naming the round and both players", async () => {
    const { eventId, view } = await seed();
    const [first] = view.rounds[0].matches;
    const r = await recordTieResult({ key: first.key, players: [first.a.playerId!, first.b.playerId!], winnerId: first.b.playerId!, how: "played", margin: "3&2" });
    expect(r).toEqual({ ok: true, said: `Semi-finals: ${first.b.name} beat ${first.a.name} 3&2` });
    expect(await rows(eventId)).toEqual([{ key: first.key, winnerId: first.b.playerId, result: "3&2" }]);
    const after = await loadEventState(eventId);
    expect(after!.brackets.winners.rounds[1].matches[0].a.playerId).toBe(first.b.playerId);
  });

  it("is refused, and writes nothing, when the place now holds a different tie", async () => {
    const { eventId, view } = await seed();
    const [first, second] = view.rounds[0].matches;
    const r = await recordTieResult({ key: first.key, players: [first.a.playerId!, second.a.playerId!], winnerId: first.a.playerId!, how: "played", margin: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/draw has changed/);
    expect(await rows(eventId)).toEqual([]);
  });

  it("refuses a winner from outside the tie, a decided tie and a tie still waiting — writing nothing", async () => {
    const { eventId, view } = await seed();
    const [first, second] = view.rounds[0].matches;
    const pair = [first.a.playerId!, first.b.playerId!];
    expect((await recordTieResult({ key: first.key, players: pair, winnerId: second.a.playerId!, how: "played" })).ok).toBe(false);
    expect(await rows(eventId)).toEqual([]);
    // The final waits on both semi-finals.
    const final = view.rounds[1].matches[0];
    expect((await recordTieResult({ key: final.key, players: pair, winnerId: pair[0], how: "played" })).ok).toBe(false);
    expect(await rows(eventId)).toEqual([]);
    // Decided once; a second entry is refused and the first stands.
    expect((await recordTieResult({ key: first.key, players: pair, winnerId: pair[0], how: "conceded" })).ok).toBe(true);
    const again = await recordTieResult({ key: first.key, players: pair, winnerId: pair[1], how: "played", margin: "1 up" });
    expect(again.ok).toBe(false);
    expect(await rows(eventId)).toEqual([{ key: first.key, winnerId: pair[0], result: "conceded" }]);
    // And how is one of the four ways a tie is settled, or nothing is written.
    expect((await recordTieResult({ key: second.key, players: [second.a.playerId!, second.b.playerId!], winnerId: second.a.playerId!, how: "coin toss" })).ok).toBe(false);
  });

  it("records conceded, walkover and withdrawn in golf's words", async () => {
    const { view } = await seed(8);
    const ties = view.rounds[0].matches;
    const said: string[] = [];
    for (const [i, how] of (["conceded", "walkover", "withdrawn"] as const).entries()) {
      const m = ties[i];
      const r = await recordTieResult({ key: m.key, players: [m.a.playerId!, m.b.playerId!], winnerId: m.a.playerId!, how });
      said.push(r.said ?? r.error ?? "");
    }
    expect(said[0]).toMatch(/ by concession$/);
    expect(said[1]).toMatch(/ by walkover$/);
    expect(said[2]).toMatch(/ \(opponent withdrew\)$/);
  });

  it("is the committee's: a player cannot record a tie", async () => {
    const { eventId, view } = await seed();
    const [first] = view.rounds[0].matches;
    session = { ...session!, viewRole: "player", role: "player" };
    await expect(
      recordTieResult({ key: first.key, players: [first.a.playerId!, first.b.playerId!], winnerId: first.a.playerId!, how: "played" }),
    ).rejects.toThrow();
    expect(await rows(eventId)).toEqual([]);
  });
});

describe("a knockout's play-by dates", () => {
  it("are kept on this tournament's knockout, and refused out of order or for another tournament's round", async () => {
    const other = await seed();
    const { stageId } = await seed();
    expect(await setKnockoutPlayBy(stageId, { "1": "2026-11-14", "0": "2026-11-28" })).toEqual({ ok: true });
    const kept = await prisma.stage.findUniqueOrThrow({ where: { id: stageId } });
    expect(parsePlayBy(kept.knockoutPlayBy)).toEqual({ 0: "2026-11-28", 1: "2026-11-14" });
    // The semi-finals due after the final: refused, and the dates kept stand.
    const late = await setKnockoutPlayBy(stageId, { "1": "2026-12-01", "0": "2026-11-28" });
    expect(late.ok).toBe(false);
    expect(late.error).toMatch(/due after the round it feeds/);
    expect(parsePlayBy((await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).knockoutPlayBy)).toEqual({ 0: "2026-11-28", 1: "2026-11-14" });
    // Another tournament's knockout, from this session: refused, untouched.
    const foreign = await setKnockoutPlayBy(other.stageId, { "0": "2026-11-28" });
    expect(foreign.ok).toBe(false);
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: other.stageId } })).knockoutPlayBy).toBe("");
  });
});
