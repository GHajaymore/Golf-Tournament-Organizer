import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * ROUND DAY (2026-09-28, Ajay: "go ahead with your recommendations as a golf
 * pro"): the pin sheet a committee sets on the morning, the time a round is
 * allowed, and pace of play read off the tee sheet and the cards.
 *
 * What needs real rows: who may write a pin sheet and to which round, and how
 * far each group has got when its cards live in two different tables.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROUNDDAY";
const session = { email: "zz-roundday@example.invalid", name: "ZZ Secretary", eventId: "", role: "admin", viewRole: "admin", userId: "", accountId: "" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { setPinSheet, setPaceMinutes } = await import("@/app/actions/round-day");
const { paceRoundsFor } = await import("@/lib/services/pace");

let eventId = "";
let today = "";
let closed = "";
let far = "";
let otherStage = "";
const p: Record<string, string> = {};

const nine = (n: number) => JSON.stringify(Array.from({ length: 18 }, (_, i) => (i < n ? 4 : null)));

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club` } });
  const mk = (name: string) =>
    prisma.event.create({
      data: { organizationId: org.id, name, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${name}-${process.pid}` },
    });
  const ev = await mk(`${TAG} medal`);
  const other = await mk(`${TAG} somebody else's`);
  eventId = ev.id;
  session.eventId = ev.id;

  for (const [i, who] of ["ann", "bea", "cal", "dee", "eve"].entries()) {
    const row = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: `zz-roundday-${who}@example.invalid`, seed: i + 1, status: "confirmed" },
    });
    p[who] = row.id;
  }
  const day = new Date().toISOString().slice(0, 10);
  const sheet = JSON.stringify({
    savedAt: new Date().toISOString(),
    startType: "tee",
    groups: [
      { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [p.ann, p.bea] },
      { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [p.cal, p.dee] },
      { name: "Group 3", startHole: 1, time: "", playerIds: [p.eve] },
    ],
  });
  today = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: day, teeSheet: sheet } })).id;
  closed = (await prisma.stage.create({ data: { eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: day, teeSheet: sheet, closedAt: new Date() } })).id;
  far = (await prisma.stage.create({ data: { eventId, position: 2, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: "2020-01-01", teeSheet: sheet } })).id;
  otherStage = (await prisma.stage.create({ data: { eventId: other.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })).id;

  // Group 1 keeps their own cards: Ann is through five, Bea three.
  await prisma.scorecard.create({ data: { eventId, stageId: today, playerId: p.ann, strokes: nine(5) } });
  await prisma.scorecard.create({ data: { eventId, stageId: today, playerId: p.bea, strokes: nine(3) } });
  // Group 2 is a side sharing one ball: its only card is the TEAM's, through seven.
  const side = await prisma.team.create({ data: { eventId, stageId: today, name: `${TAG} side` } });
  await prisma.teamMember.create({ data: { teamId: side.id, playerId: p.cal } });
  await prisma.teamMember.create({ data: { teamId: side.id, playerId: p.dee } });
  await prisma.teamScorecard.create({ data: { eventId, stageId: today, teamId: side.id, strokes: nine(7) } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the pin sheet", () => {
  it("is stored for the round, and logged under Recent changes", async () => {
    const r = await setPinSheet(today, [{ on: 22, side: "R", off: 6 }, null, { on: 15, side: "C" }]);
    expect(r).toEqual({ ok: true });
    const stored = JSON.parse((await prisma.stage.findUniqueOrThrow({ where: { id: today } })).pinSheet);
    expect(stored).toHaveLength(18);
    expect(stored[0]).toEqual({ on: 22, side: "R", off: 6 });
    expect(stored[2]).toEqual({ on: 15, side: "C", off: 0 });
    const log = await prisma.auditLog.findFirst({ where: { eventId, action: "pin-sheet" }, orderBy: { createdAt: "desc" } });
    expect(log?.detail).toBe("Pin sheet set for Round 1 (2 holes)");
  });

  it("names the hole to fix and stores nothing", async () => {
    const r = await setPinSheet(today, [null, { on: 90, side: "C" }]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Hole 2:/);
    const stored = JSON.parse((await prisma.stage.findUniqueOrThrow({ where: { id: today } })).pinSheet);
    expect(stored[0]).toEqual({ on: 22, side: "R", off: 6 }); // the last good sheet, untouched
  });

  it("an all-blank sheet clears it", async () => {
    expect(await setPinSheet(today, new Array(18).fill(null))).toEqual({ ok: true });
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: today } })).pinSheet).toBe("");
  });

  it("refuses a round in somebody else's tournament", async () => {
    const r = await setPinSheet(otherStage, [{ on: 20, side: "C" }]);
    expect(r).toEqual({ ok: false, error: "That round isn't in this tournament." });
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: otherStage } })).pinSheet).toBe("");
  });

  it("refuses a player", async () => {
    session.role = "player";
    try {
      await expect(setPinSheet(today, [{ on: 20, side: "C" }])).rejects.toThrow(/organizer or assistant/);
      await expect(setPaceMinutes(today, 240)).rejects.toThrow(/organizer or assistant/);
    } finally {
      session.role = "admin";
    }
  });
});

describe("the time allowed", () => {
  it("is set within a real day's golf, and back to the default with zero", async () => {
    expect(await setPaceMinutes(today, 240)).toEqual({ ok: true });
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: today } })).paceMinutes).toBe(240);
    expect((await setPaceMinutes(today, 90)).ok).toBe(false);
    expect((await setPaceMinutes(today, 245.5)).ok).toBe(false);
    expect((await setPaceMinutes(otherStage, 240)).ok).toBe(false);
    expect(await setPaceMinutes(today, 0)).toEqual({ ok: true });
  });
});

describe("pace of play reads how far each group has got", () => {
  it("off the furthest card in the group, whichever table it lives in", async () => {
    const rounds = await paceRoundsFor(eventId);
    expect(rounds.map((r) => r.stageId)).toEqual([today]);
    const [round] = rounds;
    expect(round.groups).toEqual([
      // Ann's five, not Bea's three: one player entering is enough to place the four.
      { name: "Group 1", time: "8:00 AM", size: 2, thru: 5 },
      // A shared ball's card belongs to its side.
      { name: "Group 2", time: "8:10 AM", size: 2, thru: 7 },
    ]);
  });

  it("CONTROL: the rounds left out are left out for their reasons", async () => {
    // Same sheet, same day — closed. Same sheet — dated years ago. Neither measured.
    const ids = (await paceRoundsFor(eventId)).map((r) => r.stageId);
    expect(ids).not.toContain(closed);
    expect(ids).not.toContain(far);
    // And reopening the closed one brings it straight back.
    await prisma.stage.update({ where: { id: closed }, data: { closedAt: null } });
    expect((await paceRoundsFor(eventId)).map((r) => r.stageId)).toContain(closed);
    await prisma.stage.update({ where: { id: closed }, data: { closedAt: new Date() } });
  });
});
