import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A STROKE-PLAY CUT IS APPLIED WHEN THE ROUND BEFORE IT CLOSES — Ajay's
 * decisions of 2026-09-26: automatically, and "top N and ties".
 *
 * Found walking the seeded Club Championship as a player cut after round 1:
 * Today offered "Start my card" for round 2, and a card saved there would have
 * put her straight back on the board. The cut was configurable on a stroke
 * round and printed on the rules sheet, and nothing ever applied it.
 *
 * Real rows, real actions, both roles: the organizer closes round 1, the
 * player the cut left out tries to keep a round 2 card.
 *
 * The field is built so the tie rule is visible: cut to TWO, with B and C level
 * on the second place on identical cards (no countback can split them) — so
 * "top 2 and ties" is three players, and plain "top 2" would be two.
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
import { setRoundClosed, saveScorecard } from "@/app/actions/tournament";
import { strokeCutField } from "@/lib/services/stroke-cut";
import { loadEventState } from "@/lib/services/tournament";
import { meFor } from "@/lib/services/me";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-STROKE-CUT";
const lower = TAG.toLowerCase();
const PARS = new Array(18).fill(4);
const card = (total: number) => {
  // 72 is all fours; each stroke under par comes off the first holes, over par
  // goes on the last ones — the shape does not matter to a gross total.
  const c = [...PARS];
  let diff = total - 72;
  for (let i = 0; diff < 0; i += 1, diff += 1) c[i] = 3;
  for (let i = 17; diff > 0; i -= 1, diff -= 1) c[i] = 5;
  return c;
};

let eventId = "";
let r1 = "";
let r2 = "";
const id: Record<string, string> = {};
let adminUser = "";
let dUser = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: lower } } });
}

async function as(userId: string) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
}

const r2Holders = async () =>
  (await prisma.scorecard.findMany({ where: { stageId: r2 }, select: { playerId: true } }))
    .map((c) => Object.keys(id).find((k) => id[k] === c.playerId))
    .sort();

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} championship`,
      organizationId: org.id,
      status: "live",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  eventId = ev.id;
  const base = { eventId, type: "Stroke Play Round", format: "Individual Stroke Play", holes: 18, scoringBasis: "gross" };
  r1 = (await prisma.stage.create({ data: { ...base, position: 0, description: "Round 1" }, select: { id: true } })).id;
  r2 = (
    await prisma.stage.create({
      data: { ...base, position: 1, description: "Round 2", cutEnabled: true, cutScope: "overall", cutMode: "count", cutCount: 2 },
      select: { id: true },
    })
  ).id;

  const totals: Record<string, number> = { a: 70, b: 72, c: 72, d: 80 };
  for (const [i, who] of Object.keys(totals).entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: `${lower}-${who}@example.invalid`, seed: i + 1, status: "confirmed", handicap: 0 },
      select: { id: true },
    });
    id[who] = p.id;
    await prisma.scorecard.create({ data: { eventId, stageId: r1, playerId: p.id, strokes: JSON.stringify(card(totals[who])) } });
  }

  adminUser = (await prisma.user.create({ data: { email: `${lower}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable" }, select: { id: true } })).id;
  await prisma.account.create({ data: { eventId, name: `${TAG} Admin`, email: `${lower}-admin@example.invalid`, role: "admin" } });
  dUser = (await prisma.user.create({ data: { email: `${lower}-d@example.invalid`, name: `${TAG} d`, password: "x:unusable" }, select: { id: true } })).id;
  await prisma.account.create({ data: { eventId, name: `${TAG} d`, email: `${lower}-d@example.invalid`, role: "player" } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a stroke-play cut", () => {
  it("THE PRECONDITION: before round 1 closes, round 2 is open to everybody", async () => {
    expect(await strokeCutField(eventId, r2)).toBeNull();
    // And B and C really are level — otherwise the tie rule is untested.
    const state = await loadEventState(eventId);
    const rank = (who: string) => state!.strokeStandings.find((s) => s.player.id === id[who])!.rank;
    expect(rank("b")).toBe(rank("c"));
  });

  it("is made when round 1 closes: top 2 and ties get round 2 cards, nobody else", async () => {
    await as(adminUser);
    expect(await setRoundClosed(r1, true)).toEqual({ ok: true });
    expect(await r2Holders()).toEqual(["a", "b", "c"]);
    const field = await strokeCutField(eventId, r2);
    expect(field && [...field].length).toBe(3);
    const log = await prisma.auditLog.findFirst({ where: { eventId, action: "cut-applied" } });
    expect(log?.detail ?? "").toMatch(/top 2 and ties go through — 3 into Round 2/);
  });

  it("tells the player it left out, and offers them no card", async () => {
    // The player app follows the round the BOARD is on, which moves to round 2
    // once somebody scores in it — so A tees off first, as on the day.
    await prisma.scorecard.updateMany({
      where: { stageId: r2, playerId: id.a },
      data: { strokes: JSON.stringify([4, ...new Array(17).fill(null)]) },
    });
    const state = await loadEventState(eventId);
    expect(state!.boardStage?.id, "the board has moved to round 2").toBe(r2);
    const d = await meFor(state!, `${lower}-d@example.invalid`);
    expect(d.round?.cutOut).toBe("Round 1");
    expect(d.round?.ownCard).toBe(false);
    // The control: a player who made it has their card.
    const a = await meFor(state!, `${lower}-a@example.invalid`);
    expect(a.round?.cutOut).toBe("");
  });

  it("refuses a round 2 card from that player, on the server", async () => {
    await as(dUser);
    await expect(saveScorecard(r2, id.d, card(72))).rejects.toThrow(/made the cut/);
    expect(await r2Holders()).toEqual(["a", "b", "c"]);
  });

  it("is re-made on the corrected standings when round 1 closes again", async () => {
    await as(adminUser);
    // B has started round 2; C has not. D's round 1 was mis-entered: 68, not 80.
    await prisma.scorecard.updateMany({
      where: { stageId: r2, playerId: id.b },
      data: { strokes: JSON.stringify([4, ...new Array(17).fill(null)]) },
    });
    await prisma.scorecard.updateMany({ where: { stageId: r1, playerId: id.d }, data: { strokes: JSON.stringify(card(68)) } });
    expect(await setRoundClosed(r1, false)).toEqual({ ok: true });
    expect(await setRoundClosed(r1, true)).toEqual({ ok: true });
    // Now D (68) and A (70) are the top 2. C's EMPTY card goes; B's card has a
    // score on it and is never removed — that is golf somebody played.
    expect(await r2Holders()).toEqual(["a", "b", "d"]);
  });
});
