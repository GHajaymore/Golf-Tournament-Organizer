import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * WHAT THE EVERY-ACTION SWEEP FOUND (2026-10-11).
 *
 * `e2e/every-action-vs-a-stranger.spec.ts` calls every server action as the
 * Commissioner of ANOTHER club, carrying a club's real ids, and asks the
 * database what moved. 808 calls; three things moved that should not have.
 * Each is pinned here against real rows, with the control that the proper
 * use still works.
 *
 *   1. Inviting somebody to your club's staff by email RENAMED their account
 *      to whatever you typed — any existing user, whoever they were.
 *   2. The organizer's own "who won this tie" took any key and any id: a
 *      bracket could name a player from another club, or a tie the draw does
 *      not have. (`matrix.test.ts` asserts a bracket winner is in its own
 *      match; the door that writes one never asked.)
 *   3. Disputing or reopening a match that is not in your tournament did
 *      nothing — and wrote "Result disputed" in the audit log all the same.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { addOrganizationMember } from "@/app/actions/organization";
import { disputeMatch, reopenMatch, setBracketWinner, setPrizeWinner } from "@/app/actions/tournament";
import { loadEventState } from "@/lib/services/tournament";
import { bracketDraws } from "@/lib/domain/my-tie";

const prisma = new PrismaClient();
const TAG = `zz-sweepfound-${process.pid}`;

/** One club with a knockout, and another with a match — each with its own Commissioner. */
const home = { org: "", event: "", admin: "", players: [] as string[] };
const away = { org: "", event: "", admin: "", match: "", players: [] as string[] };
let annId = "";
const ANN = `${TAG}-ann@example.invalid`;

async function as(userId: string, eventId: string) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
}

async function club(name: string, stageType: string) {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${name}`, kind: "club" }, select: { id: true } });
  const event = await prisma.event.create({
    data: {
      name: `${TAG} ${name} open`,
      organizationId: org.id,
      status: "live",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}`,
    },
    select: { id: true },
  });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: stageType, format: "Match Play", holes: 18 },
    select: { id: true },
  });
  const players: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const p = await prisma.player.create({
      data: { eventId: event.id, name: `${TAG} ${name} P${i + 1}`, email: `${TAG}-${name}-p${i + 1}@example.invalid`, seed: i + 1, status: "confirmed", handicap: 0 },
      select: { id: true },
    });
    players.push(p.id);
  }
  const email = `${TAG}-${name}-admin@example.invalid`;
  const user = await prisma.user.create({ data: { email, name: `${TAG} ${name} Admin`, password: "x:unusable" }, select: { id: true } });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
  await prisma.account.create({ data: { eventId: event.id, name: `${TAG} ${name} Admin`, email, role: "admin" } });
  return { org: org.id, event: event.id, stage: stage.id, admin: user.id, players };
}

beforeAll(async () => {
  const h = await club("home", "Bracket Stage");
  Object.assign(home, h);
  const a = await club("away", "Round Robin");
  Object.assign(away, a);
  const group = await prisma.group.create({ data: { eventId: away.event, name: `${TAG} g`, position: 0 }, select: { id: true } });
  const match = await prisma.match.create({
    data: { eventId: away.event, stageId: a.stage, groupId: group.id, round: 1, playerAId: a.players[0], playerBId: a.players[1] },
    select: { id: true },
  });
  away.match = match.id;
  const ann = await prisma.user.create({ data: { email: ANN, name: "Ann Fairweather", password: "x:unusable" }, select: { id: true } });
  annId = ann.id;
});

afterAll(async () => {
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("inviting somebody to a club's staff", () => {
  it("does not rename a person who already has an account", async () => {
    await as(away.admin, away.event);
    const result = await addOrganizationMember(ANN, "Renamed By A Stranger", "member");
    expect(result.ok).toBe(true);
    const ann = await prisma.user.findUnique({ where: { id: annId }, select: { name: true } });
    expect(ann?.name, "a club that invited her changed what her own account is called").toBe("Ann Fairweather");
    // The invitation itself still lands: she is on that club's staff.
    expect(await prisma.organizationMember.count({ where: { organizationId: away.org, userId: annId } })).toBe(1);
  });

  it("CONTROL: somebody new is called what the inviter typed", async () => {
    await as(away.admin, away.event);
    const email = `${TAG}-newcomer@example.invalid`;
    expect((await addOrganizationMember(email, "Bea Newcomer", "member")).ok).toBe(true);
    expect((await prisma.user.findUnique({ where: { email }, select: { name: true } }))?.name).toBe("Bea Newcomer");
  });

  it("CONTROL: an account with no name yet takes the one typed", async () => {
    // Somebody entered in a tournament by email alone has an account and no
    // name on it. A name is better than none; it is a name being REPLACED
    // that is the defect.
    const email = `${TAG}-nameless@example.invalid`;
    await prisma.user.create({ data: { email, name: "", password: "" } });
    await as(away.admin, away.event);
    expect((await addOrganizationMember(email, "Cy Nameless", "member")).ok).toBe(true);
    expect((await prisma.user.findUnique({ where: { email }, select: { name: true } }))?.name).toBe("Cy Nameless");
  });
});

describe("recording who won a tie", () => {
  let key = "";
  let inTie: string[] = [];
  let notInTie = "";

  beforeAll(async () => {
    const state = await loadEventState(home.event);
    const ties = bracketDraws(state!.brackets).flatMap((d) => d.view.rounds.flatMap((r) => r.matches));
    const drawn = ties.find((m) => m.a.playerId && m.b.playerId)!;
    key = drawn.key;
    inTie = [drawn.a.playerId!, drawn.b.playerId!];
    notInTie = home.players.find((p) => !inTie.includes(p))!;
  });

  const rows = () => prisma.bracketWinner.count({ where: { eventId: home.event } });

  it("CONTROL: the fixture has a tie with two players in it, and somebody who is not", () => {
    expect(key).not.toBe("");
    expect(inTie).toHaveLength(2);
    expect(notInTie).toBeTruthy();
  });

  it("refuses a player from another club's tournament", async () => {
    await as(home.admin, home.event);
    const result = await setBracketWinner(key, away.players[0]);
    expect(result).toEqual({ ok: false, error: "The winner of a tie is one of the two players in it." });
    expect(await rows()).toBe(0);
  });

  it("refuses a player of this tournament who is not in that tie", async () => {
    await as(home.admin, home.event);
    expect((await setBracketWinner(key, notInTie)).ok).toBe(false);
    expect(await rows()).toBe(0);
  });

  it("refuses a tie the draw does not have", async () => {
    await as(home.admin, home.event);
    expect(await setBracketWinner("w-9-9", inTie[0])).toEqual({ ok: false, error: "That tie isn't in the draw." });
    expect(await rows()).toBe(0);
  });

  it("CONTROL: records one of the two players in the tie, and takes it back on a second press", async () => {
    await as(home.admin, home.event);
    expect(await setBracketWinner(key, inTie[0])).toEqual({ ok: true });
    expect((await prisma.bracketWinner.findFirst({ where: { eventId: home.event, key } }))?.winnerId).toBe(inTie[0]);
    expect(await setBracketWinner(key, inTie[0])).toEqual({ ok: true });
    expect(await rows()).toBe(0);
  });
});

describe("disputing or reopening a match", () => {
  const lines = (eventId: string) => prisma.auditLog.count({ where: { eventId, action: { in: ["dispute", "reopen"] } } });

  it("writes nothing when the match is not in the caller's tournament", async () => {
    // The home club's Commissioner, pointing at the away club's match.
    await as(home.admin, home.event);
    await disputeMatch(away.match);
    await reopenMatch(away.match);
    expect(await lines(home.event), "the audit log records a dispute of a match this tournament does not have").toBe(0);
    expect(await lines(away.event)).toBe(0);
    const match = await prisma.match.findUnique({ where: { id: away.match }, select: { scoreStatus: true } });
    expect(match?.scoreStatus).toBe("pending");
  });

  it("CONTROL: the match's own organizer disputes it, and it is on the record", async () => {
    await as(away.admin, away.event);
    await disputeMatch(away.match);
    expect((await prisma.match.findUnique({ where: { id: away.match }, select: { scoreStatus: true } }))?.scoreStatus).toBe("disputed");
    expect(await prisma.auditLog.count({ where: { eventId: away.event, action: "dispute", matchId: away.match } })).toBe(1);
    await reopenMatch(away.match);
    expect((await prisma.match.findUnique({ where: { id: away.match }, select: { scoreStatus: true } }))?.scoreStatus).toBe("pending");
    expect(await prisma.auditLog.count({ where: { eventId: away.event, action: "reopen", matchId: away.match } })).toBe(1);
  });
});

/**
 * THE SAME DOOR, ONE ROOM ALONG. Awarding a prize has the shape recording a
 * tie had: any id was stored as the winner, an audit line was written whether
 * or not a prize of this tournament was touched, and the line named the winner
 * by their row id ("Awarded to player cmx…") — which no committee can read.
 * Not reached by the sweep, whose stranger has no prize to award; found by
 * reading for the class once the bracket had shown it.
 */
describe("awarding a prize", () => {
  let prizeId = "";
  let awayPrizeId = "";

  beforeAll(async () => {
    prizeId = (await prisma.prize.create({ data: { eventId: home.event, category: `${TAG} winner`, amount: 50 }, select: { id: true } })).id;
    awayPrizeId = (await prisma.prize.create({ data: { eventId: away.event, category: `${TAG} away winner`, amount: 50 }, select: { id: true } })).id;
  });

  const winner = async (id: string) => (await prisma.prize.findUnique({ where: { id }, select: { winnerId: true } }))?.winnerId ?? null;
  const lines = () => prisma.auditLog.findMany({ where: { eventId: home.event, action: "prize.winner" }, select: { detail: true } });

  it("refuses a winner who is not in this tournament's field", async () => {
    await as(home.admin, home.event);
    const result = await setPrizeWinner(prizeId, away.players[0]);
    expect(result).toEqual({ ok: false, error: "A prize goes to somebody in this tournament's field." });
    expect(await winner(prizeId)).toBeNull();
    expect(await lines()).toEqual([]);
  });

  it("writes nothing for a prize that is not this tournament's", async () => {
    await as(home.admin, home.event);
    expect((await setPrizeWinner(awayPrizeId, home.players[0])).ok).toBe(false);
    expect(await winner(awayPrizeId)).toBeNull();
    expect(await lines(), "the audit log records an award this tournament did not make").toEqual([]);
  });

  it("CONTROL: awards it to a player in the field, and the record names them", async () => {
    await as(home.admin, home.event);
    expect(await setPrizeWinner(prizeId, home.players[0])).toEqual({ ok: true });
    expect(await winner(prizeId)).toBe(home.players[0]);
    const said = (await lines()).map((l) => l.detail);
    expect(said).toHaveLength(1);
    expect(said[0], "the audit line names the winner by a row id").toContain(`${TAG} home P1`);
    expect(said[0]).not.toContain(home.players[0]);
  });

  it("CONTROL: and takes it back", async () => {
    await as(home.admin, home.event);
    expect(await setPrizeWinner(prizeId, "")).toEqual({ ok: true });
    expect(await winner(prizeId)).toBeNull();
  });
});

/**
 * FOUND BY THE MEMBER'S PASS, once it was signed in to a tournament that HAS
 * matches: any entrant could mark any match's result as disputed — a pair two
 * groups away, a final they were not in — and a disputed result holds up the
 * whole tournament's finish. The screen has only ever offered Dispute on a
 * player's own match, before it is confirmed; the action asked for nothing
 * but being signed in.
 *
 * RULING (2026-10-11, as the Rules treat match play — Rule 20.1b): a match's
 * result is disputed by the players in it, or by the committee. Anybody else
 * who knows something tells the committee. And once the committee has
 * confirmed a result, a player asks them to reopen it.
 */
describe("who may dispute a match", () => {
  let users: { inIt: string; outsider: string };

  beforeAll(async () => {
    // Two entrants of the away tournament who can sign in: one playing in the
    // match (P1), one not (P3).
    const emails = { inIt: `${TAG}-away-p1@example.invalid`, outsider: `${TAG}-away-p3@example.invalid` };
    const made = { inIt: "", outsider: "" };
    for (const [who, email] of Object.entries(emails) as ["inIt" | "outsider", string][]) {
      made[who] = (await prisma.user.create({ data: { email, name: `${TAG} ${who}`, password: "x:unusable" }, select: { id: true } })).id;
      await prisma.account.create({ data: { eventId: away.event, name: `${TAG} ${who}`, email, role: "player" } });
    }
    users = made;
  });

  const status = async () => (await prisma.match.findUnique({ where: { id: away.match }, select: { scoreStatus: true } }))?.scoreStatus;
  const set = (scoreStatus: string) => prisma.match.update({ where: { id: away.match }, data: { scoreStatus } });

  it("refuses an entrant who is not in the match", async () => {
    await set("pending");
    await as(users.outsider, away.event);
    const result = await disputeMatch(away.match);
    expect(result).toEqual({ ok: false, error: "Only the players in a match, or the committee, can dispute its result." });
    expect(await status(), "somebody outside the match changed its result's standing").toBe("pending");
  });

  it("CONTROL: a player in the match disputes it", async () => {
    await set("pending");
    await as(users.inIt, away.event);
    expect(await disputeMatch(away.match)).toEqual({ ok: true });
    expect(await status()).toBe("disputed");
  });

  it("a player does not un-confirm a result the committee has confirmed", async () => {
    await set("confirmed");
    await as(users.inIt, away.event);
    const result = await disputeMatch(away.match);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/has been confirmed/);
    expect(await status()).toBe("confirmed");
  });

  it("CONTROL: the committee may dispute any match of its tournament", async () => {
    await set("pending");
    await as(away.admin, away.event);
    expect(await disputeMatch(away.match)).toEqual({ ok: true });
    expect(await status()).toBe("disputed");
    await set("pending");
  });
});
