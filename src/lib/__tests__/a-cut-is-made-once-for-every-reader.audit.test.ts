import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * WHETHER A CUT HAS BEEN MADE IS ONE QUESTION, AND EVERY READER GETS ONE ANSWER.
 *
 * Step 2 of the bottom-up work (docs/one-rule-one-place.md): who is in a
 * round. A round after a stroke cut belongs to the players who made it, and the
 * app keeps that as "who holds a card for it" — `applyStrokeCut` gives every
 * survivor one when the round before closes. Until 2026-10-14 four readers
 * decided for themselves whether that had happened yet:
 *
 *   strokeCutField   the cut is made once the round before is CLOSED      the player app, the tee
 *                    and the round holds cards                            sheet, the card guard
 *   roundProgress    the cut is made once the round holds ANY card        the dashboard's "cards in",
 *                                                                         every round-field size
 *   the dashboard's no-card list, and the shared costs' field            the same as roundProgress
 *
 * They agree on every cut round the development database holds (18, measured:
 * the round before closed, nobody withdrawn, nobody out that week). They part
 * the moment somebody keeps score in round 2 before round 1 is closed — an
 * organizer who forgets to close it the night before, and a field that tees
 * off anyway. The card guard lets them, rightly: no cut has been made, so the
 * round is everybody's. The dashboard then counted the cut as made, with one
 * survivor: round 2 "1 of 1 in", and the shared costs expected one card.
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
import { roundMoneyFor } from "@/lib/services/expenses";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CUT-ONCE";
const lower = TAG.toLowerCase();
const PARS = new Array(18).fill(4);
const card = (total: number) => {
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
const user: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: lower } } });
}

async function as(who: string) {
  jar.clear();
  await createSession(user[who]);
  await setActiveEvent(eventId);
}

/** Round 2's field, as each reader that decides it says it. */
async function round2() {
  const state = (await loadEventState(eventId))!;
  const field = await strokeCutField(eventId, r2);
  return {
    size: state.roundFieldSize(r2),
    cutField: field ? [...field].sort() : null,
    // The leaderboard's "missed the cut", by player.
    missedCut: state.strokeStandings.filter((s) => s.missedCut).map((s) => s.player.id).sort(),
  };
}

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

  // Six entrants, every round 1 card in and approved. Cut to two: A and B go
  // through on 70 and 71; C, D, E and F do not.
  const totals: Record<string, number> = { a: 70, b: 71, c: 74, d: 75, e: 78, f: 80 };
  for (const [i, who] of Object.keys(totals).entries()) {
    const email = `${lower}-${who}@example.invalid`;
    id[who] = (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${who}`, email, seed: i + 1, status: "confirmed", handicap: 0 },
        select: { id: true },
      })
    ).id;
    await prisma.scorecard.create({
      data: { eventId, stageId: r1, playerId: id[who], strokes: JSON.stringify(card(totals[who])), status: "approved" },
    });
    user[who] = (await prisma.user.create({ data: { email, name: `${TAG} ${who}`, password: "x:unusable" }, select: { id: true } })).id;
    await prisma.account.create({ data: { eventId, name: `${TAG} ${who}`, email, role: "player" } });
  }
  const adminEmail = `${lower}-admin@example.invalid`;
  user.admin = (await prisma.user.create({ data: { email: adminEmail, name: `${TAG} Admin`, password: "x:unusable" }, select: { id: true } })).id;
  await prisma.account.create({ data: { eventId, name: `${TAG} Admin`, email: adminEmail, role: "admin" } });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("whether a cut has been made", () => {
  let before: Awaited<ReturnType<typeof round2>>;

  it("CONTROL: before round 1 closes and before anybody starts round 2, nobody has made or missed a cut", async () => {
    before = await round2();
    expect(before.cutField, "the round is everybody's").toBeNull();
    // Not one: the rule's arithmetic, two through and nobody known yet.
    expect(before.size).toBe(2);
    expect(before.missedCut, "nobody has missed a cut that has not been made").toEqual([]);
  });

  it("does not change because somebody started round 2 before round 1 was closed", async () => {
    await as("a");
    // All eighteen holes: a whole card, which is what a pot waits for.
    const res = await saveScorecard(r2, id.a, new Array(18).fill(4));
    expect(res.ok, "the card guard lets them: no cut has been made").toBe(true);

    const now = await round2();
    expect(now.cutField, "control: the player app still says the round is everybody's").toBeNull();
    expect(now, "one card started early is not a cut with one survivor").toEqual(before);
    // And the money: the round's pots wait for the field, not for one card.
    const money = await roundMoneyFor(eventId, `${lower}-a@example.invalid`);
    const row = money.rounds.find((r) => r.stageId === r2);
    expect(row, "round 2 has a money row").toBeDefined();
    expect(row!.final, "round 2's money was called final on one early card").toBe(false);
  });

  it("is made when round 1 closes, and every reader then says the same field", async () => {
    await as("admin");
    expect(await setRoundClosed(r1, true)).toEqual({ ok: true });
    const after = await round2();
    expect(after.cutField).toEqual([id.a, id.b].sort());
    expect(after.size, "the dashboard's field of round 2 is the field the cut made").toBe(2);
    // CONTROL for the board half: once it is made, the four it left out say so.
    expect(after.missedCut).toEqual([id.c, id.d, id.e, id.f].sort());
  });
});
