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
let clubRows = "";
const userEmail = `${TAG}.user@example.invalid`.toLowerCase();

/** Every club- and person-level row the test made, as one comparable string. */
async function clubLevel(): Promise<string> {
  const members = await prisma.member.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });
  const user = await prisma.user.findUnique({ where: { email: userEmail } });
  const orgMembers = await prisma.organizationMember.findMany({ where: { organizationId: orgId } });
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  return JSON.stringify({ members, user, orgMembers, org });
}

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
  // Each entry is linked to the club's roster record (handicap, GHIN, history) and
  // the club has a person with a sign-in: none of it may go with a tournament.
  const user = await prisma.user.create({ data: { email: userEmail, name: "zz user" } });
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: "member" } });
  const member = (n: string, handicap: number) =>
    prisma.member.create({
      data: { organizationId: orgId, name: `${TAG} ${n}`, email: `${TAG}.${n}@example.invalid`, ghin: "zz-1", homeClub: "zz home", handicap, handicapType: "18", handicapSource: "manual", memberNumber: `zz-${n}` },
    });
  const annMember = await member("ann", 12.4);
  const cyMember = await member("cy", 3.1);
  ann = (await prisma.player.create({ data: { eventId, memberId: annMember.id, name: `${TAG} ann`, email: userEmail, seed: 1, status: "confirmed" } })).id; // the User IS this entry's account (linked by address)
  const cy = (await prisma.player.create({ data: { eventId: otherEventId, memberId: cyMember.id, name: `${TAG} cy`, email: `${TAG}.cy@example.invalid`, seed: 1, status: "confirmed" } })).id;
  clubRows = await clubLevel();
  await prisma.account.create({ data: { eventId, name: "zz staff", email: staffEmail, role: "admin" } });
  // The same person is also on the tournament's own access list, as its assistant.
  await prisma.account.create({ data: { eventId, name: "zz user", email: userEmail, role: "assistant" } });
  expect(await prisma.player.count({ where: { eventId, email: userEmail } })).toBe(1);
  expect(await prisma.user.count({ where: { email: userEmail } })).toBe(1);
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
  await prisma.user.deleteMany({ where: { email: userEmail } });
}

afterAll(async () => {
  try {
    await clean();
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * A ROUND WITH SCORES IS NOT DELETED (J12, state machine PR 7b; section 3,
 * "Delete a round": "Round 2 has scores. Clear them on Score entry first.").
 * Refused for anybody, force or not, before the money question — and once its
 * cards are cleared the purge below takes everything else tied to it.
 */
describe("a round with scores is refused before anything is counted", () => {
  it("refuses in the rule's words, force or not, and deletes nothing", async () => {
    for (const force of [false, true]) {
      expect(await removeStage(r2, force)).toMatchObject({ ok: false, refused: "Round 2 has scores. Clear them on Score entry first." });
    }
    expect(await prisma.stage.count({ where: { id: r2 } })).toBe(1);
    expect(await rowsIn("Scorecard", "stageId", r2)).toBe(1);
    expect(await rowsIn("Expense", "stageId", r2)).toBe(1);
    // Cleared on Score entry: the cards go, and everything else stays for the purge to reach.
    await prisma.scorecard.deleteMany({ where: { stageId: r2 } });
    await prisma.teamScorecard.deleteMany({ where: { stageId: r2 } });
  });
});

describe("who may delete a round that holds money records", () => {
  it("an Assistant is refused in plain words and nothing is deleted, even with force", async () => {
    session = { ...session!, role: "assistant" };
    try {
      for (const force of [false, true]) {
        const res = await removeStage(r2, force);
        expect(res).toMatchObject({ ok: false, refused: "Ask the Organizer to delete this round — it holds money records." });
      }
      expect(await prisma.stage.count({ where: { id: r2 } })).toBe(1);
      expect(await rowsIn("Expense", "stageId", r2)).toBe(1);
      expect(await rowsIn("RoundHandicap", "stageId", r2)).toBe(1);
    } finally {
      session = { ...session!, role: "admin" };
    }
  });

  it("an Assistant may still delete a round that holds no money records", async () => {
    session = { ...session!, role: "assistant" };
    const bare = (await prisma.stage.create({ data: { eventId, position: 9, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18 } })).id;
    try {
      expect((await removeStage(bare)).ok).toBe(true);
      expect(await prisma.stage.count({ where: { id: bare } })).toBe(0);
    } finally {
      session = { ...session!, role: "admin" };
    }
  });

  it("the Organizer is not refused (the next block deletes r2 as the Organizer)", async () => {
    expect(await removeStage(r2)).toMatchObject({ needsConfirm: true, records: 4 });
  });
});

describe("deleting a knockout round", () => {
  it("takes its bracket results, reports and stored draw, and leaves another tournament's", async () => {
    const ko = (await prisma.stage.create({ data: { eventId, position: 8, type: "Bracket Stage", format: "Match Play", holes: 18 } })).id;
    await prisma.event.update({ where: { id: eventId }, data: { bracketDraw: "zz-draw" } });
    await prisma.bracketWinner.create({ data: { eventId, key: "winners-0-0", winnerId: ann, result: "3&2" } });
    await prisma.bracketReport.create({ data: { eventId, key: "winners-0-1", winnerId: ann, reportedById: ann } });
    await prisma.bracketWinner.create({ data: { eventId: otherEventId, key: "winners-0-0", winnerId: "zz" } });
    expect(await prisma.bracketWinner.count({ where: { eventId } })).toBe(1); // the control
    // A knockout with a result is not deleted (J12, PR 7b): its results are cleared on the Bracket first.
    expect(await removeStage(ko, true)).toMatchObject({ ok: false, refused: "Round 3 has results. Clear them on the Bracket first." });
    await prisma.bracketWinner.deleteMany({ where: { eventId } });
    expect((await removeStage(ko, true)).ok).toBe(true);
    expect(await prisma.bracketWinner.count({ where: { eventId } })).toBe(0);
    expect(await prisma.bracketReport.count({ where: { eventId } })).toBe(0);
    expect((await prisma.event.findUnique({ where: { id: eventId }, select: { bracketDraw: true } }))?.bracketDraw).toBe("");
    expect(await prisma.bracketWinner.count({ where: { eventId: otherEventId } })).toBe(1);
  });

  it("deleting a stroke-play round leaves the bracket's results alone", async () => {
    await prisma.stage.create({ data: { eventId, position: 8, type: "Bracket Stage", format: "Match Play", holes: 18 } });
    const sp = (await prisma.stage.create({ data: { eventId, position: 7, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18 } })).id;
    await prisma.bracketWinner.create({ data: { eventId, key: "winners-0-0", winnerId: ann } });
    expect((await removeStage(sp)).ok).toBe(true);
    expect(await prisma.bracketWinner.count({ where: { eventId } })).toBe(1);
    await prisma.bracketWinner.deleteMany({ where: { eventId } });
    await prisma.stage.deleteMany({ where: { eventId, position: 8 } });
  });
});

describe("removing a round", () => {
  it("starts with the other round's cards counted — the control", async () => {
    // Round 2's were cleared on Score entry above (J12, PR 7b): Round 1 keeps 1 stroke + 1 team.
    expect(await enteredCardCount(eventId)).toBe(2);
    expect(await rowsIn("RoundHandicap", "eventId", eventId)).toBe(2);
  });

  it("leaves no table holding the round, and the other round and the players alone", async () => {
    // Asked first, the confirm counts what will go: the money records (its cards were cleared first).
    const ask = await removeStage(r2);
    expect(ask).toMatchObject({ needsConfirm: true, cards: 0, records: 4 });
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
    // The club's roster, the sign-in and the membership are exactly as they were.
    expect(await clubLevel()).toBe(clubRows);
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
    // The tournament's entries are gone; the club's Members they pointed at are not,
    // nor their handicap and history fields, the User sign-in, or the membership.
    expect(await prisma.player.count({ where: { eventId } })).toBe(0);
    expect(await prisma.member.count({ where: { organizationId: orgId } })).toBe(2);
    expect(await prisma.account.count({ where: { eventId } })).toBe(0); // the tournament's own access list goes
    expect(await prisma.user.count({ where: { email: userEmail } })).toBe(1); // the sign-in of the person who was in it stays
    expect(await clubLevel()).toBe(clubRows);
    // The other tournament's entry still points at its Member.
    expect((await prisma.player.findFirst({ where: { eventId: otherEventId }, select: { memberId: true } }))?.memberId).toBeTruthy();
  });
});
