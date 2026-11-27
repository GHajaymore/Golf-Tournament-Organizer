import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CLOSED ROUND TAKES NO MATCH WRITE FROM A PLAYER, AND A SIGNED-OFF RESULT TAKES NONE EITHER (B128, 27 Nov 2026).
 *
 * `a-closed-round-is-closed.audit.test.ts` held ONE door (an individual stroke card). A closed round refused three
 * callers (`savePlayCard`, `savePlayMatchCard`, `saveScorecard`) and took every other player write of a match: the round
 * code's tapped hole and phoned-in result, the signed-in player's tap, result, stroke card and clear, a team medal
 * card, and the offline replay of any of them. The close now lives at the sink they all ask, `mayWriteMatch`
 * (`services/match-membership.ts`), and a player's team medal card asks `roundClosedRefusal` itself (no match to ask about).
 *
 * For each path: the CONTROL first (an open round takes the write and the row changes), then the round is closed and the
 * same press is refused with the ONE sentence and the `Match` row is byte for byte what it was (holes, status, who
 * confirmed, signatures, author) with no audit line written; staff on the closed round still write (the committee
 * corrects, or reopens); and once reopened the player's tap lands again. A signed-off result is refused the same way.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-closed-round-takes-no-taps.audit.test.ts
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

/** The round code's session, set per test; null leaves the real one (never read here). */
let play: { eventId: string; stageId: string; playerId: string; playerName: string; roundLabel: string } | null = null;
vi.mock("@/lib/play-auth", () => ({
  getPlaySession: async () => play,
  createPlaySession: async () => {},
  destroyPlaySession: async () => {},
}));

import { createSession, setActiveEvent } from "@/lib/auth";
import { addCupMatch } from "@/app/actions/cup";
import { savePlayMatchHoles, savePlayMatchResult, savePlayMatchCard } from "@/app/actions/play";
import { keepMyMatchHoles, keepMyMatchResult, keepMyMatchCard, clearMatch, saveTeamScorecard } from "@/app/actions/tournament";
import { ROUND_CLOSED_REFUSAL } from "@/lib/services/scorecard-write";
import { SIGNED_OFF_MATCH_REFUSAL } from "@/lib/domain/pending-card";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CLOSED-TAPS";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
const PARS = new Array(18).fill(4);

let eventId = "";
const stages = { holes: "", cards: "", medal: "" };
const userIds: Record<string, string> = {};
const p: Record<string, string> = {};
let medalTeam = "";

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
  const cup = (position: number, matchKeptBy: string) =>
    prisma.stage.create({
      data: { eventId, position, type: "Team Session", format: "Four-Ball", holes: 18, scoringBasis: "gross", courseId: course.id, lineupPublished: true, matchKeptBy },
    });
  stages.holes = (await cup(0, "holes")).id;
  stages.cards = (await cup(1, "cards")).id;
  // A team stroke round (a four-ball medal): its cards have NO match.
  stages.medal = (
    await prisma.stage.create({
      data: { eventId, position: 2, type: "Stroke Play Round", format: "Four-Ball", holes: 18, scoringBasis: "net", courseId: course.id },
    })
  ).id;

  const blues = await prisma.group.create({ data: { eventId, name: `${TAG} Blues`, position: 0 } });
  const whites = await prisma.group.create({ data: { eventId, name: `${TAG} Whites`, position: 1 } });
  let seed = 0;
  for (const [who, flight] of [["a1", blues.id], ["a2", blues.id], ["b1", whites.id], ["b2", whites.id]] as const) {
    const row = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: ++seed, status: "confirmed", handicap: 10, groupId: flight },
    });
    p[who] = row.id;
    userIds[who] = (await prisma.user.create({ data: { email: at(who), name: who, password: "x", emailVerifiedAt: new Date() } })).id;
    await prisma.account.create({ data: { eventId, email: at(who), name: who, role: "player" } });
  }
  userIds.org = (await prisma.user.create({ data: { email: at("org"), name: "org", password: "x", emailVerifiedAt: new Date() } })).id;
  await prisma.account.create({ data: { eventId, email: at("org"), name: "org", role: "admin" } });

  await signIn("org");
  for (const s of [stages.holes, stages.cards]) expect(await addCupMatch(s, [p.a1, p.a2], [p.b1, p.b2])).toEqual({ ok: true });
  medalTeam = (
    await prisma.team.create({
      data: { eventId, stageId: stages.medal, name: `${TAG} side A`, members: { create: [{ playerId: p.a1 }, { playerId: p.a2 }] } },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const matchIn = (stageId: string) => prisma.match.findFirstOrThrow({ where: { eventId, stageId } });
const card = (holes: Record<number, number>) => PARS.map((_, h) => holes[h] ?? null);
const tapped = (first: "A" | "B" | "H") => PARS.map((_, h) => (h === 0 ? first : null));
const closeRound = (stageId: string) => prisma.stage.update({ where: { id: stageId }, data: { closedAt: new Date() } });
const openRound = (stageId: string) => prisma.stage.update({ where: { id: stageId }, data: { closedAt: null } });
const audits = () => prisma.auditLog.count({ where: { eventId } });

/** Every column a write to a match touches, as the row holds it. */
const snapshot = async (matchId: string) => {
  const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  return { holes: m.holes, scoreStatus: m.scoreStatus, confirmedById: m.confirmedById, attestedBy: m.attestedBy, enteredBy: m.enteredBy, enteredById: m.enteredById, scoredAt: m.scoredAt };
};

const asCode = async (who: string, stageId: string) => {
  play = { eventId, stageId, playerId: p[who], playerName: `${TAG} ${who}`, roundLabel: "Round 1" };
};

beforeEach(async () => {
  for (const s of Object.values(stages)) await openRound(s);
  for (const s of [stages.holes, stages.cards]) {
    await prisma.match.updateMany({
      where: { eventId, stageId: s },
      data: { holes: JSON.stringify(PARS.map(() => null)), scoreStatus: "pending", scoredAt: null, confirmedById: null, confirmedBy: "", attestedBy: "[]", enteredBy: "", enteredById: "" },
    });
  }
  await prisma.teamScorecard.deleteMany({ where: { stageId: stages.medal } });
  await prisma.teamScorecard.deleteMany({ where: { eventId } });
  await prisma.scorecard.deleteMany({ where: { eventId } });
  await prisma.matchScorecard.deleteMany({ where: { match: { eventId } } });
  play = null;
});

/** One refused path: a control on the open round, the refusal on the closed one, the row untouched, and the reopen. */
type Door = {
  name: string;
  stage: "holes" | "cards";
  who: "a1";
  /** Makes the press as the player; the answer's refusal, or null when the write was taken. */
  press: (matchId: string) => Promise<string | null>;
};

const refusalOf = (r: { ok?: boolean; error?: string } | void) => (r && r.ok === false ? (r.error ?? "") : null);

const doors: Door[] = [
  {
    name: "the round code's tapped hole (savePlayMatchHoles)",
    stage: "holes",
    who: "a1",
    press: async (id) => {
      await asCode("a1", stages.holes);
      return refusalOf(await savePlayMatchHoles(id, tapped("A")));
    },
  },
  {
    name: "the round code's phoned-in result (savePlayMatchResult)",
    stage: "holes",
    who: "a1",
    press: async (id) => {
      await asCode("a1", stages.holes);
      return refusalOf(await savePlayMatchResult(id, "A", "3&2"));
    },
  },
  {
    name: "the round code's stroke card for a match (savePlayMatchCard)",
    stage: "cards",
    who: "a1",
    press: async (id) => {
      await asCode("a1", stages.cards);
      return refusalOf(await savePlayMatchCard(id, card({ 0: 4 })));
    },
  },
  {
    name: "the signed-in player's tapped hole (keepMyMatchHoles)",
    stage: "holes",
    who: "a1",
    press: async (id) => {
      await signIn("a1");
      return refusalOf(await keepMyMatchHoles(id, tapped("A")));
    },
  },
  {
    name: "the signed-in player's result (keepMyMatchResult)",
    stage: "holes",
    who: "a1",
    press: async (id) => {
      await signIn("a1");
      return refusalOf(await keepMyMatchResult(id, "A", "3&2"));
    },
  },
  {
    name: "the signed-in player's stroke card for a match (keepMyMatchCard)",
    stage: "cards",
    who: "a1",
    press: async (id) => {
      await signIn("a1");
      return refusalOf(await keepMyMatchCard(id, card({ 0: 4 })));
    },
  },
];

describe("every player's match write, closed round", () => {
  for (const door of doors) {
    it(`${door.name}: taken while the round is open, refused once it is closed, the row unchanged, taken again once reopened`, async () => {
      const stageId = stages[door.stage];
      const m = await matchIn(stageId);
      const before = await snapshot(m.id);

      // CONTROL: an open round takes it, and the row changes.
      expect(await door.press(m.id), "CONTROL: the open round refused the player").toBeNull();
      const taken = await snapshot(m.id);
      expect(taken, "CONTROL: the write did not change the row").not.toEqual(before);

      // Put the row back, then close.
      await prisma.match.update({ where: { id: m.id }, data: { holes: before.holes, scoreStatus: "pending", scoredAt: null, confirmedById: null, attestedBy: "[]", enteredBy: "", enteredById: "" } });
      await prisma.teamScorecard.deleteMany({ where: { matchId: m.id } });
      await prisma.matchScorecard.deleteMany({ where: { matchId: m.id } });
      const still = await snapshot(m.id);
      const logged = await audits();
      await closeRound(stageId);

      expect(await door.press(m.id), "the closed round took the player's write").toBe(ROUND_CLOSED_REFUSAL);
      expect(await snapshot(m.id), "the closed round's match row changed").toEqual(still);
      expect(await prisma.teamScorecard.count({ where: { matchId: m.id } }), "a card row was written").toBe(0);
      expect(await prisma.matchScorecard.count({ where: { matchId: m.id } }), "a card row was written").toBe(0);
      expect(await audits(), "an audit line was written for a refused write").toBe(logged);

      // Reopened: the same press lands again.
      await openRound(stageId);
      expect(await door.press(m.id), "the reopened round refused the player").toBeNull();
      expect(await snapshot(m.id)).not.toEqual(still);
    });
  }

  it("the signed-in player's clear (clearMatch) is refused on a closed round and the card is kept", async () => {
    const m = await matchIn(stages.holes);
    await signIn("a1");
    expect(refusalOf(await keepMyMatchHoles(m.id, tapped("A"))), "CONTROL: the tap").toBeNull();
    const kept = await snapshot(m.id);
    await closeRound(stages.holes);
    expect(await clearMatch(m.id)).toEqual({ ok: false, error: ROUND_CLOSED_REFUSAL });
    expect(await snapshot(m.id)).toEqual(kept);
    await openRound(stages.holes);
    expect(await clearMatch(m.id), "CONTROL: reopened, the clear is taken").toEqual({ ok: true });
  });

  it("a team medal card (no match) is refused on a closed round", async () => {
    await signIn("a1");
    const strokes = PARS.map((par, h) => (h % 3 === 0 ? par + 1 : par));
    expect(await saveTeamScorecard(medalTeam, p.a1, "", strokes), "CONTROL: the open round takes it").toEqual({ ok: true });
    await prisma.teamScorecard.deleteMany({ where: { stageId: stages.medal } });
    await closeRound(stages.medal);
    expect(await saveTeamScorecard(medalTeam, p.a1, "", strokes)).toEqual({ ok: false, error: ROUND_CLOSED_REFUSAL });
    expect(await prisma.teamScorecard.count({ where: { stageId: stages.medal } })).toBe(0);
    // Staff exemption: the committee writes on a closed round.
    await signIn("org");
    expect(await saveTeamScorecard(medalTeam, p.a1, "", strokes), "staff are exempt: the committee corrects").toEqual({ ok: true });
  });
});

describe("staff are exempt on a closed round (the committee corrects, or reopens)", () => {
  it("the secretary's tap and result are taken", async () => {
    const m = await matchIn(stages.holes);
    await closeRound(stages.holes);
    await signIn("org");
    expect(await keepMyMatchHoles(m.id, tapped("B"))).toMatchObject({ ok: true });
    expect(await keepMyMatchResult(m.id, "A", "2&1")).toEqual({ ok: true });
    expect(await clearMatch(m.id)).toEqual({ ok: true });
  });
});

describe("a result the committee signed off takes no player's write", () => {
  const signedOff = async (m: { id: string }) => {
    await prisma.match.update({
      where: { id: m.id },
      data: { holes: JSON.stringify(PARS.map((_, h) => (h < 5 ? "A" : null))), scoreStatus: "confirmed", scoredAt: new Date(), confirmedById: userIds.org, attestedBy: "[]" },
    });
    return snapshot(m.id);
  };

  it("the round code cannot send it back to pending (hole by hole, or as a result)", async () => {
    const m = await matchIn(stages.holes);
    const fixed = await signedOff(m);
    await asCode("a1", stages.holes);
    expect(await savePlayMatchHoles(m.id, tapped("B"))).toMatchObject({ ok: false, error: SIGNED_OFF_MATCH_REFUSAL });
    expect(await savePlayMatchResult(m.id, "B", "3&2")).toMatchObject({ ok: false, error: SIGNED_OFF_MATCH_REFUSAL });
    expect(await snapshot(m.id)).toEqual(fixed);
  });

  it("the signed-in player cannot write a result over it", async () => {
    const m = await matchIn(stages.holes);
    const fixed = await signedOff(m);
    await signIn("a1");
    expect(await keepMyMatchResult(m.id, "B", "3&2")).toEqual({ ok: false, error: SIGNED_OFF_MATCH_REFUSAL });
    expect(await snapshot(m.id)).toEqual(fixed);
  });

  it("CONTROL: staff still correct it (Reopen is the committee's way, and a correction goes back through approval)", async () => {
    const m = await matchIn(stages.holes);
    await signedOff(m);
    await signIn("org");
    expect(await keepMyMatchResult(m.id, "B", "3&2")).toEqual({ ok: true });
    expect((await snapshot(m.id)).scoreStatus).toBe("pending");
  });
});
