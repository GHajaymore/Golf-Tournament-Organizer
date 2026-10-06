import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THREE RULES OF A TEAM CUP, decided by Ajay on 2026-10-06 and driven here
 * through the real actions, signed in as the real roles:
 *
 *   1. A session's lineup is hidden until the organizer ANNOUNCES it — and a
 *      hidden match is nobody's to score.
 *   2. Conceding a match is the ORGANIZER's call, pairs matches included, and
 *      the players' cards saved afterwards do not undo it.
 *   3. A side that has PICKED UP on a hole has conceded it (Rule 3.2b(1)).
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { addCupMatch, publishCupLineup, hideCupLineup } from "@/app/actions/cup";
import { saveTeamScorecard, forfeitMatch } from "@/app/actions/tournament";
import { cupBoard } from "@/lib/services/cup";
import { LINEUP_HIDDEN } from "@/lib/domain/cup-lineup";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CUPRULES";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
const PARS = new Array(18).fill(4);

let eventId = "";
let fourball = "";
let foursomes = "";
let medal = "";
const userIds: Record<string, string> = {};
const p: Record<string, string> = {};

async function signIn(who: string) {
  jar.clear();
  await createSession(userIds[who]);
  await setActiveEvent(eventId);
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "society" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} cup`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      status: "live",
      shareToken: `${TAG}-${Date.now()}`,
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
    },
  });
  eventId = event.id;
  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(PARS),
      yards: "[]",
      strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
  });
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });

  const stage = (position: number, type: string, format: string) =>
    prisma.stage.create({ data: { eventId, position, type, format, holes: 18, scoringBasis: "gross", courseId: course.id } });
  fourball = (await stage(0, "Team Session", "Four-Ball")).id;
  foursomes = (await stage(1, "Team Session", "Foursomes")).id;
  medal = (await stage(2, "Stroke Play Round", "Four-Ball")).id;

  const blues = await prisma.group.create({ data: { eventId, name: `${TAG} Blues`, position: 0 } });
  const whites = await prisma.group.create({ data: { eventId, name: `${TAG} Whites`, position: 1 } });
  let seed = 0;
  for (const [who, flight] of [
    ["a1", blues.id], ["a2", blues.id], ["a3", blues.id], ["a4", blues.id],
    ["b1", whites.id], ["b2", whites.id], ["b3", whites.id], ["b4", whites.id],
  ] as const) {
    const row = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: ++seed, status: "confirmed", handicap: 0, groupId: flight },
    });
    p[who] = row.id;
    userIds[who] = (await prisma.user.create({ data: { email: at(who), name: who, password: "x" } })).id;
    await prisma.account.create({ data: { eventId, email: at(who), name: who, role: "player" } });
  }
  userIds.org = (await prisma.user.create({ data: { email: at("org"), name: "org", password: "x" } })).id;
  await prisma.account.create({ data: { eventId, email: at("org"), name: "org", role: "admin" } });

  await signIn("org");
  expect(await addCupMatch(fourball, [p.a1, p.a2], [p.b1, p.b2])).toEqual({ ok: true });
  expect(await addCupMatch(foursomes, [p.a3, p.a4], [p.b3, p.b4])).toEqual({ ok: true });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const matchIn = (stageId: string) => prisma.match.findFirstOrThrow({ where: { eventId, stageId } });
const card = (holes: Record<number, number>) => PARS.map((_, h) => holes[h] ?? null);
const picked = (...holes: number[]) => PARS.map((_, h) => holes.includes(h));

describe("a lineup is hidden until it is announced", () => {
  it("a player cannot score it before; can after", async () => {
    const m = await matchIn(fourball);
    await signIn("a1");
    expect(await saveTeamScorecard(m.teamAId, p.a1, m.id, card({ 0: 4 }))).toEqual({ ok: false, error: LINEUP_HIDDEN });
    // Nor see it: the board everybody reads has no match in a draft session.
    const before = await cupBoard(eventId);
    expect(before.ok && before.board.sessions[0].matches).toEqual([]);

    await signIn("org");
    expect(await publishCupLineup(fourball)).toEqual({ ok: true });
    await signIn("a1");
    expect(await saveTeamScorecard(m.teamAId, p.a1, m.id, card({ 0: 4 }))).toEqual({ ok: true });
    const after = await cupBoard(eventId);
    expect(after.ok && after.board.sessions[0].matches.length).toBe(1);
  });

  it("CONTROL: staff may score a draft — entering the committee's cards is the job", async () => {
    const m = await matchIn(foursomes);
    await signIn("org");
    expect(await saveTeamScorecard(m.teamAId, "", m.id, card({}))).toEqual({ ok: true });
  });

  it("announcing needs a lineup; taking it back is refused once the session is under way", async () => {
    await signIn("org");
    expect((await publishCupLineup(medal)).ok, "not a cup session").toBe(false);
    // The four-ball has a card in it now, so it stays announced.
    expect(await hideCupLineup(fourball)).toMatchObject({ ok: false });
    // The foursomes has an empty card only: announce and take back is allowed.
    expect(await publishCupLineup(foursomes)).toEqual({ ok: true });
    expect(await hideCupLineup(foursomes)).toEqual({ ok: true });
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: foursomes } })).lineupPublished).toBe(false);
    expect(await publishCupLineup(foursomes)).toEqual({ ok: true });
  });
});

describe("a side that picks up has conceded the hole", () => {
  it("both partners out on the 2nd gives it to the other side, with nothing entered there", async () => {
    const m = await matchIn(fourball);
    await signIn("a1");
    expect(await saveTeamScorecard(m.teamAId, p.a1, m.id, card({ 0: 4 }), picked(1))).toEqual({ ok: true });
    // One partner out is not the side out: still undecided.
    expect(JSON.parse((await matchIn(fourball)).holes)[1]).toBeNull();
    await signIn("a2");
    expect(await saveTeamScorecard(m.teamAId, p.a2, m.id, card({}), picked(1))).toEqual({ ok: true });
    expect(JSON.parse((await matchIn(fourball)).holes)[1]).toBe("B");
  });

  it("a score typed on a picked-up hole is not stored — out of the hole has no score", async () => {
    const m = await matchIn(fourball);
    await signIn("a1");
    expect(await saveTeamScorecard(m.teamAId, p.a1, m.id, card({ 0: 4, 1: 3 }), picked(1))).toEqual({ ok: true });
    const row = await prisma.teamScorecard.findFirstOrThrow({ where: { matchId: m.id, playerId: p.a1 } });
    expect(JSON.parse(row.strokes)[1]).toBeNull();
    expect(JSON.parse(row.pickedUp)[1]).toBe(true);
  });

  it("a save from a screen that sends no pick-ups keeps the ones on record", async () => {
    const m = await matchIn(fourball);
    await signIn("a1");
    expect(await saveTeamScorecard(m.teamAId, p.a1, m.id, card({ 0: 4 }))).toEqual({ ok: true });
    const row = await prisma.teamScorecard.findFirstOrThrow({ where: { matchId: m.id, playerId: p.a1 } });
    expect(JSON.parse(row.pickedUp)[1]).toBe(true);
  });

  it("CONTROL: a medal refuses a pick-up — every hole is holed out", async () => {
    await signIn("org");
    const side = await prisma.team.create({
      data: { eventId, stageId: medal, name: `${TAG} medal side`, members: { create: [{ playerId: p.a1, position: 0 }] } },
    });
    const r = await saveTeamScorecard(side.id, p.a1, "", card({ 0: 4 }), picked(3));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/match play/);
  });
});

describe("a pairs concession is the organizer's, and the cards do not undo it", () => {
  it("is recorded in a cup, scores a full point, and survives a player's save", async () => {
    const m = await matchIn(foursomes);
    await signIn("org");
    expect(await forfeitMatch(m.id, m.teamAId)).toEqual({ ok: true });
    const b = await cupBoard(eventId);
    const row = b.ok ? b.board.sessions[1].matches[0] : null;
    expect(row?.conceded).toBe("A");
    expect(row?.state.points).toEqual([0, 1]);

    // A Blues player goes on saving their side's card, as decided.
    await signIn("a3");
    expect(await saveTeamScorecard(m.teamAId, "", m.id, card({ 0: 4, 1: 4 }))).toEqual({ ok: true });
    expect((await matchIn(foursomes)).forfeitedBy).toBe(m.teamAId);
  });

  it("a player cannot record one", async () => {
    const m = await matchIn(fourball);
    await signIn("b1");
    await expect(forfeitMatch(m.id, m.teamAId)).rejects.toThrow();
  });

  it("CONTROL: outside a cup a team concession is still refused — nothing there would count it", async () => {
    await signIn("org");
    const rr = await prisma.stage.create({ data: { eventId, position: 3, type: "Round Robin", format: "Four-Ball", holes: 18 } });
    const carrier = await prisma.group.create({ data: { eventId, name: `${TAG} rr carrier`, position: 9, stageId: rr.id, isCarrier: true } });
    const ta = await prisma.team.create({ data: { eventId, stageId: rr.id, name: `${TAG} rr a` } });
    const tb = await prisma.team.create({ data: { eventId, stageId: rr.id, name: `${TAG} rr b` } });
    const m = await prisma.match.create({
      data: { eventId, stageId: rr.id, groupId: carrier.id, round: 1, playerAId: "", playerBId: "", teamAId: ta.id, teamBId: tb.id, holes: "[]" },
    });
    const r = await forfeitMatch(m.id, ta.id);
    expect(r.ok).toBe(false);
  });
});
