import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * DELETING A ROUND OR A TOURNAMENT IS A PURGE (Ajay, 2026-11-07).
 *
 * `Scorecard`, `TeamScorecard` and `RoundHandicap` carry a `stageId` but no
 * foreign key to `Stage`, so `removeStage` left them behind while its confirm
 * said "the matches and cards go with it" (found by the review of #1039); and
 * `HonoursEntry`, `SmsDelivery` and `EmailFailure` carry an `eventId` and no
 * foreign key, so `deleteEvent` left them behind still naming people.
 *
 * Seeds a round and a tournament touching every table that has no cascade, plus
 * a sample of those that do; deletes; then counts EVERY table the schema says
 * has an `eventId` or a `stageId` (not only the seeded ones), so a table added
 * tomorrow is asked too.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PURGE";
const PARS = new Array(18).fill(4);
const strokes = JSON.stringify(PARS);

let session: { eventId: string; email: string; viewRole: string; name: string; role: string; userId: string; accountId: string } | null = null;
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// deleteEvent lands with a redirect; the audit is of the rows, not the landing.
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {},
}));

const { removeStage, deleteEvent } = await import("@/app/actions/tournament");
const { enteredCardCount } = await import("@/lib/services/round-cards");

const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const tablesWith = (column: string) =>
  [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
    .filter(([, , body]) => body.split("\n").some((l) => l.trim().split(/\s+/)[0] === column))
    .map(([, name]) => name);

async function rowsIn(table: string, column: string, id: string): Promise<number> {
  const r = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${column}" = $1`, id)) as { n: number }[];
  return r[0].n;
}

const staffEmail = `${TAG}.staff@example.invalid`.toLowerCase();
let orgId = "";
let eventId = "";
let otherEventId = "";
let r1 = "";
let r2 = "";
let otherStage = "";
let ann = "";

async function eventWith(suffix: string) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${suffix}`,
      status: "live",
      // A live tournament is locked until the organizer unlocks it.
      configUnlocked: true,
      shape: "series",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${suffix}-${process.pid}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
}

/** Everything the purge has to reach, for one round of one event. */
async function seedRound(evId: string, stageId: string, playerId: string, teamId: string) {
  await prisma.scorecard.create({ data: { eventId: evId, stageId, playerId, strokes, status: "approved" } });
  await prisma.teamScorecard.create({ data: { eventId: evId, stageId, teamId, strokes } });
  await prisma.roundHandicap.create({ data: { eventId: evId, stageId, playerId, override: 5 } });
  await prisma.handicapPost.create({ data: { eventId: evId, stageId, playerId, postKey: `${evId}:${stageId}:${playerId}` } });
  const expense = await prisma.expense.create({ data: { eventId: evId, stageId, description: "zz cart", amountCents: 100, paidBy: playerId } });
  await prisma.expenseShare.create({ data: { expenseId: expense.id, playerId } });
  await prisma.expensePayment.create({ data: { expenseId: expense.id, playerId, amountCents: 50 } });
  const contest = await prisma.contest.create({ data: { eventId: evId, stageId, name: "zz closest" } });
  await prisma.contestEntry.create({ data: { contestId: contest.id, playerId } });
  const game = await prisma.sideGame.create({ data: { eventId: evId, stageId, kind: "birdies" } });
  await prisma.sideGameEntry.create({ data: { sideGameId: game.id, playerId } });
  await prisma.tournamentFund.create({ data: { eventId: evId, stageId, direction: "in", description: "zz fees", amountCents: 100 } });
}

beforeAll(async () => {
  await clean();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } })).id;
  eventId = (await eventWith("main")).id;
  otherEventId = (await eventWith("other")).id;
  const mk = (id: string, position: number) =>
    prisma.stage.create({ data: { eventId: id, position, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18 } });
  r1 = (await mk(eventId, 0)).id;
  r2 = (await mk(eventId, 1)).id;
  otherStage = (await mk(otherEventId, 0)).id;
  ann = (await prisma.player.create({ data: { eventId, name: `${TAG} ann`, email: `${TAG}.ann@example.invalid`, seed: 1, status: "confirmed" } })).id;
  const cy = (await prisma.player.create({ data: { eventId: otherEventId, name: `${TAG} cy`, email: `${TAG}.cy@example.invalid`, seed: 1, status: "confirmed" } })).id;
  await prisma.account.create({ data: { eventId, name: "zz staff", email: staffEmail, role: "admin" } });
  const team = await prisma.team.create({ data: { eventId, name: `${TAG} side`, seed: 1 } });
  const otherTeam = await prisma.team.create({ data: { eventId: otherEventId, name: `${TAG} other side`, seed: 1 } });
  await seedRound(eventId, r1, ann, team.id);
  await seedRound(eventId, r2, ann, team.id);
  await seedRound(otherEventId, otherStage, cy, otherTeam.id);
  // Event-level rows with no foreign key to the event.
  for (const evId of [eventId, otherEventId]) {
    await prisma.honoursEntry.create({ data: { organizationId: orgId, eventId: evId, eventName: `${TAG}`, championName: "zz champion" } });
    await prisma.smsDelivery.create({ data: { organizationId: orgId, eventId: evId, toPhone: "+1 555 0100", body: "zz" } });
    await prisma.emailFailure.create({ data: { organizationId: orgId, eventId: evId, kind: "registration", reason: "quota" } });
    await prisma.auditLog.create({ data: { eventId: evId, actor: "zz", action: "zz", detail: "zz" } });
    const thread = await prisma.thread.create({ data: { organizationId: orgId, eventId: evId, scopeKey: "event:zz" } });
    await prisma.message.create({ data: { threadId: thread.id, authorEmail: "zz@example.invalid", body: "zz" } });
  }
  session = { eventId, email: staffEmail, viewRole: "admin", name: "zz staff", role: "admin", userId: "zz", accountId: "" };
});

async function clean() {
  // Tables with no foreign key to the club: by the club's id, before it goes.
  const orgs = (await prisma.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })).map((o) => o.id);
  await prisma.honoursEntry.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.smsDelivery.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.emailFailure.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

afterAll(async () => {
  try {
    await clean();
  } finally {
    await prisma.$disconnect();
  }
});

describe("removing a round", () => {
  it("starts with the cards of both rounds counted — the control", async () => {
    expect(await enteredCardCount(eventId)).toBe(4); // 2 stroke + 2 team
    expect(await rowsIn("RoundHandicap", "eventId", eventId)).toBe(2);
  });

  it("leaves no table holding the round, and the other round and the players alone", async () => {
    const res = await removeStage(r2, true);
    expect(res.ok).toBe(true);
    expect(await prisma.stage.count({ where: { id: r2 } })).toBe(0);
    const stageTables = tablesWith("stageId");
    expect(stageTables).toEqual(expect.arrayContaining(["Scorecard", "RoundHandicap", "Expense", "SideGame", "Match"]));
    for (const t of stageTables) {
      expect(await rowsIn(t, "stageId", r2), `${t} still holds the deleted round`).toBe(0);
    }
    // The other round is still whole.
    for (const t of ["Scorecard", "TeamScorecard", "RoundHandicap", "HandicapPost", "Expense", "Contest", "SideGame", "TournamentFund"]) {
      expect(await rowsIn(t, "stageId", r1), `${t} lost the OTHER round`).toBe(1);
    }
    expect(await rowsIn("ExpenseShare", "playerId", ann)).toBe(1);
    expect(await prisma.player.count({ where: { id: ann } })).toBe(1);
    // The count the "this will destroy results" confirms read.
    expect(await enteredCardCount(eventId)).toBe(2);
    // An audit line that says what happened and never who played.
    const line = await prisma.auditLog.findFirst({ where: { eventId, action: "Round deleted" } });
    expect(line?.actor).toBe("zz staff");
  });

  it("deletes nothing of another tournament when handed its round id", async () => {
    await removeStage(otherStage, true);
    expect(await prisma.stage.count({ where: { id: otherStage } })).toBe(1);
    expect(await rowsIn("Scorecard", "stageId", otherStage)).toBe(1);
    expect(await rowsIn("Expense", "stageId", otherStage)).toBe(1);
  });
});

describe("deleting a tournament", () => {
  it("is there before — the control", async () => {
    for (const t of ["HonoursEntry", "SmsDelivery", "EmailFailure", "AuditLog", "Thread", "Scorecard", "Player"]) {
      expect(await rowsIn(t, "eventId", eventId), `${t} not seeded`).toBeGreaterThan(0);
    }
  });

  it("leaves no table holding it, and the other tournament untouched", async () => {
    await expect(deleteEvent(eventId)).rejects.toThrow("NEXT_REDIRECT"); // it lands on a surviving tournament
    expect(await prisma.event.count({ where: { id: eventId } })).toBe(0);
    const eventTables = tablesWith("eventId").filter((t) => t !== "Event");
    expect(eventTables).toEqual(expect.arrayContaining(["HonoursEntry", "SmsDelivery", "EmailFailure", "Scorecard", "AuditLog"]));
    for (const t of eventTables) {
      expect(await rowsIn(t, "eventId", eventId), `${t} still holds the deleted tournament`).toBe(0);
    }
    for (const t of ["HonoursEntry", "SmsDelivery", "EmailFailure", "AuditLog", "Thread", "Player"]) {
      expect(await rowsIn(t, "eventId", otherEventId), `${t} lost the OTHER tournament`).toBeGreaterThan(0);
    }
  });
});
