import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND'S MATCHES ARE KEPT ONE WAY, AND THE SERVER HOLDS IT (2026-10-19).
 *
 * Ajay: "provide both options for organizer to decide while setting up the
 * tournament" — tap who won each hole, or stroke cards. Both on one match is
 * the fault: a stroke card rebuilds the match from strokes, over holes somebody
 * tapped. No screen offers the other kind on a round that has chosen, so this
 * sends it the way a hand-made request would:
 *
 *   kept by tapping    a stroke card is refused, in words; a tap is stored
 *   kept on cards      a tap and a player's phoned-in result are refused; a
 *                      card is stored; the committee may still record a result
 *   nobody has said    both are taken, as they always were — the CONTROL that
 *                      the refusals come from the choice and not from the round
 *
 * Gross four-balls in a cup, announced, everybody off 0.
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
import { addCupMatch } from "@/app/actions/cup";
import { saveTeamScorecard, keepMyMatchHoles, keepMyMatchResult, keepMyMatchCard } from "@/app/actions/tournament";
import { KEPT_BY_HOLES, KEPT_ON_CARDS } from "@/lib/domain/match-kept-by";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-KEPTBY";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
const PARS = new Array(18).fill(4);

let eventId = "";
const stages = { holes: "", cards: "", open: "" };
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
  const stage = (position: number, matchKeptBy: string) =>
    prisma.stage.create({
      data: { eventId, position, type: "Team Session", format: "Four-Ball", holes: 18, scoringBasis: "gross", courseId: course.id, lineupPublished: true, matchKeptBy },
    });
  stages.holes = (await stage(0, "holes")).id;
  stages.cards = (await stage(1, "cards")).id;
  stages.open = (await stage(2, "")).id;

  const blues = await prisma.group.create({ data: { eventId, name: `${TAG} Blues`, position: 0 } });
  const whites = await prisma.group.create({ data: { eventId, name: `${TAG} Whites`, position: 1 } });
  let seed = 0;
  for (const [who, flight] of [["a1", blues.id], ["a2", blues.id], ["b1", whites.id], ["b2", whites.id]] as const) {
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
  for (const s of Object.values(stages)) expect(await addCupMatch(s, [p.a1, p.a2], [p.b1, p.b2])).toEqual({ ok: true });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const matchIn = (stageId: string) => prisma.match.findFirstOrThrow({ where: { eventId, stageId } });
const holesOf = async (stageId: string) => JSON.parse((await matchIn(stageId)).holes || "[]") as (string | null)[];
const card = (holes: Record<number, number>) => PARS.map((_, h) => holes[h] ?? null);
const tapped = (first: "A" | "B" | "H") => PARS.map((_, h) => (h === 0 ? first : null));

describe("a round kept by tapping", () => {
  it("refuses a stroke card, in words, and stores nothing", async () => {
    const m = await matchIn(stages.holes);
    await signIn("a1");
    expect(await saveTeamScorecard(m.teamAId, p.a1, m.id, card({ 0: 3 }))).toEqual({ ok: false, error: KEPT_BY_HOLES });
    expect(await keepMyMatchCard(m.id, card({ 0: 3 }))).toEqual({ ok: false, error: KEPT_BY_HOLES });
    expect(await prisma.teamScorecard.count({ where: { matchId: m.id } })).toBe(0);
  });

  it("takes a tap", async () => {
    const m = await matchIn(stages.holes);
    await signIn("a1");
    expect(await keepMyMatchHoles(m.id, tapped("A"))).toEqual({ ok: true });
    expect((await holesOf(stages.holes))[0]).toBe("A");
  });
});

describe("a round kept on stroke cards", () => {
  it("refuses a tap and a player's phoned-in result, in words", async () => {
    const m = await matchIn(stages.cards);
    await signIn("a1");
    expect(await keepMyMatchHoles(m.id, tapped("A"))).toEqual({ ok: false, error: KEPT_ON_CARDS });
    expect(await keepMyMatchResult(m.id, "A", "3&2")).toEqual({ ok: false, error: KEPT_ON_CARDS });
    expect((await holesOf(stages.cards)).filter((h) => h !== null)).toEqual([]);
  });

  it("works the hole out from the cards: a 3 beats a 4", async () => {
    const m = await matchIn(stages.cards);
    await signIn("a1");
    expect(await keepMyMatchCard(m.id, card({ 0: 4 }))).toEqual({ ok: true });
    await signIn("b1");
    expect(await keepMyMatchCard(m.id, card({ 0: 3 }))).toEqual({ ok: true });
    expect((await holesOf(stages.cards))[0]).toBe("B");
  });

  it("the committee may still record a result — a walkover, a decision", async () => {
    const m = await matchIn(stages.cards);
    await signIn("org");
    expect(await keepMyMatchResult(m.id, "A", "3&2")).toEqual({ ok: true });
  });
});

describe("CONTROL: a round nobody has decided takes both, as it always did", () => {
  it("a card and then a tap are both stored", async () => {
    const m = await matchIn(stages.open);
    await signIn("a1");
    expect(await saveTeamScorecard(m.teamAId, p.a1, m.id, card({ 0: 4 }))).toEqual({ ok: true });
    expect(await keepMyMatchHoles(m.id, tapped("H"))).toEqual({ ok: true });
    expect((await holesOf(stages.open))[0]).toBe("H");
  });
});
