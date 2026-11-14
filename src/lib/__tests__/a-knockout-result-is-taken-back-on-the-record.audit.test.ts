import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";

/**
 * A KNOCKOUT RESULT IS TAKEN BACK ON THE RECORD, AND NEVER FROM UNDER A LATER ONE
 * (simplicity review, cut 3, 2026-11-14).
 *
 * The draw is rebuilt from its stored winners by position, so a result taken
 * back after its winner had played on took the later result off the draw too,
 * silently, and the bracket's tap wrote no audit line when it took one back.
 * These drive the real actions against real rows:
 *
 *   - Undo (`undoTieResult`, Score entry's Undo and Change result) takes a result
 *     back, re-opens the tie, and writes who, when and what;
 *   - it is REFUSED, in words naming the later tie, once that tie has a result,
 *     and nothing is deleted or written;
 *   - the bracket's tap (`setBracketWinner`) is refused under the same rule, for
 *     taking back AND for changing, and its taking back is on the record now;
 *   - Change result is Undo and then the tie's own record (`recordTieResult`);
 *   - it is sent the tie's two players, and refuses a place that holds another tie;
 *   - a player cannot call it.
 *
 * Needs a live DATABASE_URL:
 *   npx vitest run --config vitest.audit.config.ts
 */

let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { recordTieResult, setBracketWinner } = await import("@/app/actions/tournament");
const { undoTieResult } = await import("@/app/actions/knockout-results");

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TIE-UNDO";
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
      shareToken: `audit-undo-${stamp}`,
      bracketMode: "single",
    },
  });
  await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  for (let i = 0; i < n; i += 1) {
    await prisma.player.create({
      data: { eventId: event.id, name: `${TAG} P${i + 1}`, email: `${TAG.toLowerCase()}-${i}-${stamp}@example.invalid`, handicap: 5 + i, seed: i + 1, status: "confirmed" },
    });
  }
  session = { eventId: event.id, email: `${TAG.toLowerCase()}-staff@example.invalid`, viewRole: "admin", name: `${TAG} Secretary`, role: "admin" };
  const state = await loadEventState(event.id);
  return { eventId: event.id, view: state!.brackets.winners };
}

const rows = (eventId: string) =>
  prisma.bracketWinner.findMany({ where: { eventId }, select: { key: true, winnerId: true, result: true }, orderBy: { key: "asc" } });
const undoLines = (eventId: string) =>
  prisma.auditLog.findMany({ where: { eventId, action: "knockout.undo" }, select: { actor: true, detail: true, createdAt: true } });
const pairOf = (m: { a: { playerId: string | null }; b: { playerId: string | null } }) => [m.a.playerId!, m.b.playerId!];

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  orgId = (await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } })).id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("Undo on Score entry", () => {
  it("takes a result back, re-opens the tie, and puts who, when and what on the record", async () => {
    const { eventId, view } = await seed();
    const [first] = view.rounds[0].matches;
    const pair = pairOf(first);
    expect((await recordTieResult({ key: first.key, players: pair, winnerId: pair[1], how: "played", margin: "3&2" })).ok).toBe(true);
    const from = new Date(Date.now() - 1000);

    const r = await undoTieResult({ key: first.key, players: pair });
    expect(r).toEqual({ ok: true, said: `Semi-finals: ${first.b.name} beat ${first.a.name} 3&2` });
    expect(await rows(eventId)).toEqual([]);
    const lines = await undoLines(eventId);
    expect(lines.map((l) => [l.actor, l.detail])).toEqual([
      [`${TAG} Secretary`, `Semi-finals: ${first.b.name} beat ${first.a.name} 3&2: taken back on Score entry`],
    ]);
    expect(lines[0].createdAt.getTime()).toBeGreaterThanOrEqual(from.getTime());
    // The tie waits on a result again, and the final waits on it.
    const after = await loadEventState(eventId);
    expect(after!.brackets.winners.rounds[0].matches[0].winnerId).toBeNull();
    expect(after!.brackets.winners.rounds[1].matches[0].a.playerId).toBeNull();
  });

  it("is refused once the tie it fed has a result, naming that tie, and deletes and writes nothing", async () => {
    const { eventId, view } = await seed();
    const [first, second] = view.rounds[0].matches;
    await recordTieResult({ key: first.key, players: pairOf(first), winnerId: first.a.playerId!, how: "played", margin: "2 up" });
    await recordTieResult({ key: second.key, players: pairOf(second), winnerId: second.b.playerId!, how: "conceded" });
    const final = (await loadEventState(eventId))!.brackets.winners.rounds[1].matches[0];
    expect((await recordTieResult({ key: final.key, players: pairOf(final), winnerId: first.a.playerId!, how: "played", margin: "1 up" })).ok).toBe(true);
    const before = await rows(eventId);

    const r = await undoTieResult({ key: first.key, players: pairOf(first) });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(
      `Final: ${first.a.name} v ${second.b.name} already has a result, and it was played by this tie's winner. Undo that result first, then change this one.`,
    );
    expect(await rows(eventId)).toEqual(before);
    expect(await undoLines(eventId)).toEqual([]);

    // The way out works: the final first, then the semi-final.
    expect((await undoTieResult({ key: final.key, players: pairOf(final) })).ok).toBe(true);
    expect((await undoTieResult({ key: first.key, players: pairOf(first) })).ok).toBe(true);
    expect((await undoLines(eventId)).length).toBe(2);
  });

  it("Change result is Undo and then the tie's own record, both on the record", async () => {
    const { eventId, view } = await seed();
    const [first] = view.rounds[0].matches;
    const pair = pairOf(first);
    await recordTieResult({ key: first.key, players: pair, winnerId: pair[0], how: "played", margin: "" });
    expect((await undoTieResult({ key: first.key, players: pair })).ok).toBe(true);
    expect((await recordTieResult({ key: first.key, players: pair, winnerId: pair[1], how: "walkover" })).ok).toBe(true);
    expect(await rows(eventId)).toEqual([{ key: first.key, winnerId: pair[1], result: "W/O" }]);
    const actions = (await prisma.auditLog.findMany({ where: { eventId }, orderBy: { createdAt: "asc" }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(["knockout.result", "knockout.undo", "knockout.result"]);
  });

  it("refuses a place that holds a different tie, and a tie with no result", async () => {
    const { eventId, view } = await seed();
    const [first, second] = view.rounds[0].matches;
    expect((await undoTieResult({ key: first.key, players: pairOf(first) })).error).toBe("That tie has no result to take back.");
    await recordTieResult({ key: first.key, players: pairOf(first), winnerId: first.a.playerId!, how: "played" });
    const r = await undoTieResult({ key: first.key, players: [first.a.playerId!, second.a.playerId!] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/draw has changed/);
    expect((await rows(eventId)).length).toBe(1);
  });

  it("is the committee's: a player cannot take a result back", async () => {
    const { eventId, view } = await seed();
    const [first] = view.rounds[0].matches;
    await recordTieResult({ key: first.key, players: pairOf(first), winnerId: first.a.playerId!, how: "played" });
    session = { ...session!, viewRole: "player", role: "player" };
    await expect(undoTieResult({ key: first.key, players: pairOf(first) })).rejects.toThrow();
    expect((await rows(eventId)).length).toBe(1);
  });
});

describe("the bracket's tap, under the same rule", () => {
  it("takes a result back on the record while its winner has not played on", async () => {
    const { eventId, view } = await seed();
    const [first] = view.rounds[0].matches;
    expect((await setBracketWinner(first.key, first.a.playerId!)).ok).toBe(true);
    expect((await setBracketWinner(first.key, first.a.playerId!)).ok).toBe(true);
    expect(await rows(eventId)).toEqual([]);
    expect((await undoLines(eventId)).map((l) => l.detail)).toEqual([
      `Semi-finals: ${first.a.name} beat ${first.b.name}: taken back on the draw`,
    ]);
  });

  it("refuses to take back or change a result once the tie it fed has one", async () => {
    const { eventId, view } = await seed();
    const [first, second] = view.rounds[0].matches;
    await setBracketWinner(first.key, first.a.playerId!);
    await setBracketWinner(second.key, second.a.playerId!);
    const final = (await loadEventState(eventId))!.brackets.winners.rounds[1].matches[0];
    await setBracketWinner(final.key, second.a.playerId!);
    const before = await rows(eventId);

    const back = await setBracketWinner(first.key, first.a.playerId!);
    expect(back.ok).toBe(false);
    expect(back.error).toMatch(/^Final: .* already has a result, and it was played by this tie's winner\. Undo that result first/);
    const change = await setBracketWinner(first.key, first.b.playerId!);
    expect(change.ok).toBe(false);
    expect(await rows(eventId)).toEqual(before);
    expect(await undoLines(eventId)).toEqual([]);
  });
});
