import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";

/**
 * A PLAYER MAY REPORT THEIR KNOCKOUT TIE; THE CLUB APPROVES IT (Ajay,
 * 2026-09-28: "player may enter it but organizer/club needs to approve it").
 *
 * The rule that matters is the second half. A report is a request: it must not
 * move the draw, crown anybody or count as played until staff approve it — and
 * approving must record exactly what the console's own click records. So these
 * drive the real actions against real rows and read the draw back through
 * `loadEventState`, the one reader every board uses.
 *
 * Needs a live DATABASE_URL:
 *   npx vitest run --config vitest.audit.config.ts
 */

let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { reportBracketResult, approveBracketReport, rejectBracketReport, setBracketWinner } = await import(
  "@/app/actions/tournament"
);

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TIE-REPORT";
let orgId = "";

async function seed(status = "live") {
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
      status,
      shareToken: `audit-tie-${stamp}`,
      bracketMode: "single",
    },
  });
  const eventId = event.id;
  // A straight knockout: the bracket is the first round, so the whole field is drawn.
  await prisma.stage.create({ data: { eventId, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  const players: { id: string; email: string; name: string }[] = [];
  for (let i = 0; i < 4; i += 1) {
    const email = `${TAG.toLowerCase()}-${i}-${stamp}@example.invalid`;
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} P${i + 1}`, email, handicap: 5 + i, seed: i + 1, status: "confirmed" },
    });
    players.push({ id: p.id, email, name: p.name });
  }
  const state = await loadEventState(eventId);
  const [first, second] = state!.brackets.winners.rounds[0].matches;
  return { eventId, players, first, second };
}

const as = (eventId: string, who: { email: string; name: string }, role = "player") => {
  session = { eventId, email: who.email, viewRole: role, name: who.name, role };
};
const staff = (eventId: string) =>
  as(eventId, { email: `${TAG.toLowerCase()}-staff@example.invalid`, name: `${TAG} staff` }, "admin");
const playerOf = (players: { id: string; email: string; name: string }[], id: string | null) =>
  players.find((p) => p.id === id)!;

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  orgId = (await prisma.organization.create({ data: { name: `${TAG} org`, kind: "club" } })).id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("a player's report is a request, not a result", () => {
  it("files a report the draw does not read, and the organizer's queue counts it", async () => {
    const { eventId, players, first } = await seed();
    const me = playerOf(players, first.a.playerId);
    as(eventId, me);

    const r = await reportBracketResult(first.key, first.a.playerId!, "3&2");
    expect(r).toEqual({ ok: true });

    expect(await prisma.bracketReport.count({ where: { eventId } })).toBe(1);
    expect(await prisma.bracketWinner.count({ where: { eventId } })).toBe(0);
    const state = await loadEventState(eventId);
    expect(state!.brackets.winners.rounds[0].matches[0].winnerId).toBeNull();
    expect(state!.reviewing.knockouts).toBe(1);
    // Nothing is frozen by a request: the draw is only written by a result.
    expect((await prisma.event.findUnique({ where: { id: eventId } }))!.bracketDraw).toBe("");
  });

  it("approving records the winner and the margin exactly as the console would, and empties the queue", async () => {
    const { eventId, players, first } = await seed();
    as(eventId, playerOf(players, first.b.playerId));
    await reportBracketResult(first.key, first.a.playerId!, "2 up");

    staff(eventId);
    expect(await approveBracketReport(first.key)).toEqual({ ok: true });

    const won = await prisma.bracketWinner.findFirst({ where: { eventId, key: first.key } });
    expect(won?.winnerId).toBe(first.a.playerId);
    expect(won?.result).toBe("2 up");
    expect(await prisma.bracketReport.count({ where: { eventId } })).toBe(0);
    const state = await loadEventState(eventId);
    expect(state!.brackets.winners.rounds[0].matches[0].winnerId).toBe(first.a.playerId);
    expect(state!.reviewing.knockouts).toBe(0);
    // The first result freezes the draw, whichever door it came through.
    expect((await prisma.event.findUnique({ where: { id: eventId } }))!.bracketDraw).not.toBe("");
  });

  it("turning it down leaves the tie open", async () => {
    const { eventId, players, first } = await seed();
    as(eventId, playerOf(players, first.a.playerId));
    await reportBracketResult(first.key, first.a.playerId!, "");
    staff(eventId);
    expect(await rejectBracketReport(first.key)).toEqual({ ok: true });
    expect(await prisma.bracketReport.count({ where: { eventId } })).toBe(0);
    expect(await prisma.bracketWinner.count({ where: { eventId } })).toBe(0);
  });

  it("an organizer recording the tie themselves answers the report too", async () => {
    const { eventId, players, first } = await seed();
    as(eventId, playerOf(players, first.a.playerId));
    await reportBracketResult(first.key, first.a.playerId!, "");
    staff(eventId);
    await setBracketWinner(first.key, first.b.playerId!);
    expect(await prisma.bracketReport.count({ where: { eventId } })).toBe(0);
    expect((await loadEventState(eventId))!.reviewing.knockouts).toBe(0);
  });
});

describe("who may report, and what", () => {
  it("refuses somebody who is not in the tie", async () => {
    const { eventId, players, first, second } = await seed();
    as(eventId, playerOf(players, second.a.playerId)); // in the OTHER tie
    const r = await reportBracketResult(first.key, first.a.playerId!, "");
    expect(r.ok).toBe(false);
    expect(await prisma.bracketReport.count({ where: { eventId } })).toBe(0);
  });

  it("CONTROL: the same player may report their own tie", async () => {
    const { eventId, players, second } = await seed();
    as(eventId, playerOf(players, second.a.playerId));
    expect((await reportBracketResult(second.key, second.b.playerId!, "")).ok).toBe(true);
  });

  it("refuses a winner who is not in the tie", async () => {
    const { eventId, players, first, second } = await seed();
    as(eventId, playerOf(players, first.a.playerId));
    const r = await reportBracketResult(first.key, second.a.playerId!, "");
    expect(r.ok).toBe(false);
    expect(await prisma.bracketReport.count({ where: { eventId } })).toBe(0);
  });

  it("refuses before the tournament is launched", async () => {
    const { eventId, players, first } = await seed("draft");
    as(eventId, playerOf(players, first.a.playerId));
    expect((await reportBracketResult(first.key, first.a.playerId!, "")).ok).toBe(false);
  });

  it("a player cannot approve a report", async () => {
    const { eventId, players, first } = await seed();
    const me = playerOf(players, first.a.playerId);
    as(eventId, me);
    await reportBracketResult(first.key, first.a.playerId!, "");
    await expect(approveBracketReport(first.key)).rejects.toThrow();
    expect(await prisma.bracketWinner.count({ where: { eventId } })).toBe(0);
  });
});
