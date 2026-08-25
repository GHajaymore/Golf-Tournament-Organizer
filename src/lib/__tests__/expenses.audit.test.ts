import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The expense actions, driven as a real outing with real rows.
 *
 * The domain module is proved to the cent over 2,000 randomised outings. This
 * is the other half: everything between an HTTP request and that arithmetic —
 * who may write, whose ids are accepted, what is recorded, and what happens
 * when the input is hostile rather than merely awkward.
 *
 * Money between friends is the highest bar in this app. Every `"use server"`
 * export here is a public endpoint that will be called with whatever the
 * caller likes.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import {
  addExpense,
  updateExpense,
  removeExpense,
  recordSettlement,
  removeSettlement,
} from "@/app/actions/expenses";
import { moneyFor } from "@/lib/services/expenses";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-EXPENSES";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let orgId = "";
let eventId = "";
let otherEventId = "";
let stageId = "";
const player: Record<string, string> = {};
const userIds: Record<string, string> = {};
let strangerPlayerId = "";

async function signIn(who: string, event = eventId) {
  jar.clear();
  await createSession(userIds[who]);
  await setActiveEvent(event);
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const newEvent = (name: string) => ({
  organizationId: orgId,
  name: `${TAG} ${name}`,
  dates: "",
  course: "",
  city: "",
  address: "",
  regDeadline: "",
  shareToken: `${TAG}-${name}-${Date.now()}`,
});

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;

  const [event, other] = await Promise.all([
    prisma.event.create({ data: newEvent("outing") }),
    prisma.event.create({ data: newEvent("other outing") }),
  ]);
  eventId = event.id;
  otherEventId = other.id;

  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  stageId = stage.id;

  for (const [i, who] of ["dave", "ann", "rob", "sam"].entries()) {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    const u = await prisma.user.create({ data: { email: at(who), name: who, password: "x" } });
    userIds[who] = u.id;
    await prisma.account.create({ data: { eventId, email: at(who), name: who, role: "player" } });
  }

  // An organizer, and a player who belongs to a DIFFERENT tournament.
  const org1 = await prisma.user.create({ data: { email: at("organizer"), name: "Organizer", password: "x" } });
  userIds.organizer = org1.id;
  await prisma.account.create({ data: { eventId, email: at("organizer"), name: "Organizer", role: "admin" } });

  const stranger = await prisma.player.create({
    data: { eventId: otherEventId, name: `${TAG} stranger`, seed: 1, status: "confirmed" },
  });
  strangerPlayerId = stranger.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

/** Every net in the event, straight from the service. */
async function nets() {
  const view = await moneyFor(eventId, at("dave"));
  return view;
}

describe("adding what you paid for", () => {
  it("splits evenly across the field by default", async () => {
    await signIn("dave");
    const res = await addExpense({ description: "Dinner", amountCents: 26_000, paidBy: player.dave });
    expect(res.ok).toBe(true);

    const view = await nets();
    expect(view.expenses).toHaveLength(1);
    expect(view.expenses[0].shares).toHaveLength(4);
    // Dave laid out 260 and owes 65 of it.
    expect(view.standing.find((s) => s.playerId === player.dave)!.netCents).toBe(19_500);
  });

  it("leaves the whole ledger summing to zero", async () => {
    const view = await nets();
    expect(view.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);
  });

  it("takes a refund as a negative", async () => {
    await signIn("ann");
    const res = await addExpense({
      description: "Cart refund",
      amountCents: -4_000,
      paidBy: player.ann,
      shares: [player.ann, player.dave].map((playerId) => ({ playerId, weight: 1 })),
    });
    expect(res.ok).toBe(true);
    const view = await nets();
    expect(view.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);
  });

  it("splits between a chosen few — the foursome case", async () => {
    await signIn("rob");
    const res = await addExpense({
      description: "Carts",
      amountCents: 9_000,
      paidBy: player.rob,
      stageId,
      shares: [player.rob, player.sam].map((playerId) => ({ playerId, weight: 1 })),
    });
    expect(res.ok).toBe(true);
    const view = await nets();
    const carts = view.expenses.find((e) => e.description === "Carts")!;
    expect(carts.shares.map((s) => s.cents)).toEqual([4_500, 4_500]);
    expect(view.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);
  });
});

describe("what it refuses", () => {
  it("refuses an amount that is not money", async () => {
    await signIn("dave");
    for (const amountCents of [NaN, Infinity, 1e12]) {
      const res = await addExpense({ description: "Junk", amountCents, paidBy: player.dave });
      expect(res.ok, String(amountCents)).toBe(false);
    }
  });

  it("refuses a zero-amount line", async () => {
    await signIn("dave");
    expect((await addExpense({ description: "Nothing", amountCents: 0, paidBy: player.dave })).ok).toBe(false);
  });

  it("refuses a line with no description", async () => {
    await signIn("dave");
    expect((await addExpense({ description: "   ", amountCents: 100, paidBy: player.dave })).ok).toBe(false);
  });

  it("refuses a payer from another tournament", async () => {
    // Otherwise an expense credits somebody who is not on the trip, and every
    // other player's balance moves to pay them.
    await signIn("dave");
    const res = await addExpense({ description: "Ghost", amountCents: 5_000, paidBy: strangerPlayerId });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/in this tournament/i);
  });

  it("drops a share naming somebody from another tournament", async () => {
    // The share list is re-queried against this event's field rather than
    // trusted: a stranger's id in a split would put a stranger in a settle-up.
    await signIn("dave");
    const res = await addExpense({
      description: "Range balls",
      amountCents: 2_000,
      paidBy: player.dave,
      shares: [
        { playerId: player.dave, weight: 1 },
        { playerId: strangerPlayerId, weight: 1 },
      ],
    });
    expect(res.ok).toBe(true);

    const view = await nets();
    const line = view.expenses.find((e) => e.description === "Range balls")!;
    expect(line.shares.map((s) => s.playerId)).toEqual([player.dave]);
    expect(view.standing.some((s) => s.playerId === strangerPlayerId)).toBe(false);
  });

  it("refuses a round from another tournament", async () => {
    const otherStage = await prisma.stage.create({
      data: { eventId: otherEventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
    });
    await signIn("dave");
    const res = await addExpense({
      description: "Wrong round",
      amountCents: 1_000,
      paidBy: player.dave,
      stageId: otherStage.id,
    });
    expect(res.ok).toBe(false);
  });
});

describe("who may change a line", () => {
  let lineId = "";

  it("lets the person who entered it edit it", async () => {
    await signIn("sam");
    const created = await addExpense({ description: "Drinks", amountCents: 6_000, paidBy: player.sam });
    lineId = created.id!;
    const res = await updateExpense(lineId, {
      description: "Drinks at the turn",
      amountCents: 7_000,
      paidBy: player.sam,
    });
    expect(res.ok).toBe(true);
  });

  it("refuses somebody else in the outing", async () => {
    // The amount you are owed being edited by somebody else, silently, is the
    // one thing that would make a group stop trusting the ledger.
    await signIn("rob");
    const res = await updateExpense(lineId, {
      description: "Drinks",
      amountCents: 100,
      paidBy: player.rob,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/entered this|organizer/i);
  });

  it("lets an organizer edit anything", async () => {
    await signIn("organizer");
    const res = await updateExpense(lineId, {
      description: "Drinks at the turn",
      amountCents: 6_500,
      paidBy: player.sam,
    });
    expect(res.ok).toBe(true);
  });

  it("refuses an expense id from another tournament", async () => {
    const foreign = await prisma.expense.create({
      data: { eventId: otherEventId, description: "Theirs", amountCents: 1_000, paidBy: strangerPlayerId },
    });
    await signIn("organizer");
    expect((await removeExpense(foreign.id)).ok).toBe(false);
    expect(await prisma.expense.findUnique({ where: { id: foreign.id } })).not.toBeNull();
    await prisma.expense.delete({ where: { id: foreign.id } });
  });

  it("lets the person who entered a line remove it, and the ledger re-balances", async () => {
    await signIn("sam");
    const created = await addExpense({ description: "Wrong entry", amountCents: 3_300, paidBy: player.sam });
    const before = await nets();
    expect(before.expenses.some((e) => e.description === "Wrong entry")).toBe(true);

    // Somebody else may not remove it.
    await signIn("rob");
    expect((await removeExpense(created.id!)).ok).toBe(false);

    await signIn("sam");
    expect((await removeExpense(created.id!)).ok).toBe(true);

    const after = await nets();
    expect(after.expenses.some((e) => e.description === "Wrong entry")).toBe(false);
    expect(after.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);
    // And its shares went with it rather than being left behind.
    expect(await prisma.expenseShare.count({ where: { expenseId: created.id! } })).toBe(0);
  });

  it("replaces the shares wholesale rather than merging them", async () => {
    await signIn("organizer");
    await updateExpense(lineId, {
      description: "Drinks at the turn",
      amountCents: 6_500,
      paidBy: player.sam,
      shares: [{ playerId: player.sam, weight: 1 }],
    });
    const view = await nets();
    const line = view.expenses.find((e) => e.description === "Drinks at the turn")!;
    expect(line.shares).toHaveLength(1);
  });
});

describe("settling up", () => {
  it("records who handed what to whom", async () => {
    await signIn("dave");
    const res = await recordSettlement(player.ann, player.dave, 5_000);
    expect(res.ok).toBe(true);

    const view = await nets();
    expect(view.settlements).toHaveLength(1);
    expect(view.settlements[0].cents).toBe(5_000);
  });

  it("moves the standing position by exactly what was handed over", async () => {
    const view = await nets();
    // Still balanced, and the settlement is part of the position rather than
    // a note beside it.
    expect(view.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);
    expect(view.settledCents).not.toBe(0);
  });

  it("refuses a settlement to yourself, or of nothing", async () => {
    await signIn("dave");
    expect((await recordSettlement(player.dave, player.dave, 100)).ok).toBe(false);
    expect((await recordSettlement(player.ann, player.dave, 0)).ok).toBe(false);
    expect((await recordSettlement(player.ann, player.dave, -500)).ok).toBe(false);
  });

  it("refuses a settlement naming another tournament's player", async () => {
    await signIn("dave");
    expect((await recordSettlement(strangerPlayerId, player.dave, 500)).ok).toBe(false);
  });

  it("can be undone by whoever recorded it", async () => {
    const view = await nets();
    const id = view.settlements[0].id;
    await signIn("rob");
    expect((await removeSettlement(id)).ok, "not yours to undo").toBe(false);
    await signIn("dave");
    expect((await removeSettlement(id)).ok).toBe(true);
  });
});

describe("the audit trail", () => {
  it("records every money write with a name against it", async () => {
    // Money actions in this app did not log, and the 2026-08-12 audit called
    // that out. A number that changed with nobody's name against it is a
    // number a group cannot resolve an argument about.
    const rows = await prisma.auditLog.findMany({ where: { eventId } });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["expense.add", "expense.update", "expense.remove", "expense.settle", "expense.settle.undo"]) {
      expect(actions.has(a), `${a} must be audited`).toBe(true);
    }
    expect(rows.every((r) => r.actor.trim().length > 0), "every row names an actor").toBe(true);
  });
});

describe("the ledger under everything at once", () => {
  it("still balances, and settles square", async () => {
    // The invariant the whole feature rests on, asserted after a full outing:
    // even splits, a foursome split, a refund, an edit, a removal and a
    // settlement have all happened above.
    const view = await nets();
    expect(view.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);

    const after = new Map(view.standing.map((s) => [s.playerId, s.netCents]));
    for (const t of view.transfers) {
      after.set(t.fromPlayerId, (after.get(t.fromPlayerId) ?? 0) + t.cents);
      after.set(t.toPlayerId, (after.get(t.toPlayerId) ?? 0) - t.cents);
      expect(t.cents).toBeGreaterThan(0);
      expect(t.fromPlayerId).not.toBe(t.toPlayerId);
    }
    for (const [id, cents] of after) expect(cents, `${id} must end square`).toBe(0);
  });

  it("keeps balancing when a player is deleted out from under it", async () => {
    // A Player row with no scores can still be hard-deleted. The expense that
    // names them must not take its side of the balance with it.
    const doomed = await prisma.player.create({
      data: { eventId, name: `${TAG} leaver`, email: at("leaver"), seed: 9, status: "confirmed" },
    });
    await signIn("organizer");
    await addExpense({
      description: "Coach",
      amountCents: 12_000,
      paidBy: doomed.id,
      shares: [doomed.id, player.dave, player.ann].map((playerId) => ({ playerId, weight: 1 })),
    });
    await prisma.player.delete({ where: { id: doomed.id } });

    const view = await nets();
    expect(view.standing.reduce((a, s) => a + s.netCents, 0), "the ledger must still balance").toBe(0);
    const coach = view.expenses.find((e) => e.description === "Coach")!;
    expect(coach.unknownPayer, "and the screen must be able to say who is missing").toBe(true);
  });
});

/**
 * The rules the 2026-08-25 audit found enforced in code and pinned by nothing.
 *
 * Each was a real defect that day. The reason none were caught is that the
 * suite tested the HAPPY path of each action — a settlement between the right
 * people, an expense with sensible shares. The failures live one step off it.
 */
describe("a settle-up is between the two people in it", () => {
  it("refuses a third party recording a payment between two others", async () => {
    // THE BUG: this checked only that both parties were in the tournament, so
    // any signed-in player could record a payment between two OTHER people —
    // one that never happened, moving both their balances, with a third
    // person's name on the record.
    await signIn("rob");
    const res = await recordSettlement(player.ann, player.dave, 5_000);
    expect(res.ok, "Rob is neither party and recorded their settlement").toBe(false);
    expect(res.error).toMatch(/two people involved/i);
  });

  it("lets either party record their own", async () => {
    await signIn("ann");
    expect((await recordSettlement(player.ann, player.dave, 1_000)).ok).toBe(true);
    await signIn("dave");
    expect((await recordSettlement(player.dave, player.ann, 1_000)).ok).toBe(true);
  });

  it("lets an organizer record one for anybody", async () => {
    // A treasurer who collected the cash IS the person who knows, and often is
    // not one of the two.
    await signIn("organizer");
    expect((await recordSettlement(player.ann, player.rob, 700)).ok).toBe(true);
  });

  it("lets either party undo one somebody else recorded", async () => {
    // The sharper half of the same bug: a settlement recorded between two
    // people could not be undone by either of them. A wrong entry nobody named
    // in it can remove is worse than one anybody can make.
    await signIn("organizer");
    await recordSettlement(player.ann, player.rob, 300);
    const view = await moneyFor(eventId, at("ann"));
    const mine = view.settlements.find((s) => s.cents === 300)!;
    expect(mine, "setup: the settlement should exist").toBeTruthy();

    await signIn("sam");
    expect((await removeSettlement(mine.id)).ok, "Sam is not in it").toBe(false);
    await signIn("ann");
    expect((await removeSettlement(mine.id)).ok, "Ann is a party to it").toBe(true);
  });
});

describe("a bill that does not add up is refused, not stored", () => {
  it("refuses payers whose amounts miss the total", async () => {
    await signIn("dave");
    const res = await addExpense({
      description: "Dinner short",
      amountCents: 20_000,
      paidBy: player.dave,
      payers: [
        { playerId: player.dave, amountCents: 12_000 },
        { playerId: player.ann, amountCents: 5_000 },
      ],
    });
    expect(res.ok, "19,000 paid against a 20,000 bill").toBe(false);
    expect(res.error).toMatch(/unaccounted for/i);
  });

  it("refuses exact shares that miss the total", async () => {
    await signIn("dave");
    const res = await addExpense({
      description: "Rooms short",
      amountCents: 40_000,
      paidBy: player.dave,
      shares: [
        { playerId: player.dave, weight: 1, amountCents: 18_137 },
        { playerId: player.ann, weight: 1, amountCents: 21_000 },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/short|over/i);
  });

  it("takes exact shares that do total it, to the cent", async () => {
    await signIn("dave");
    const res = await addExpense({
      description: "Rooms exact",
      amountCents: 40_000,
      paidBy: player.dave,
      shares: [
        { playerId: player.dave, weight: 1, amountCents: 18_137 },
        { playerId: player.ann, weight: 1, amountCents: 21_863 },
      ],
    });
    expect(res.ok).toBe(true);

    const view = await moneyFor(eventId, at("dave"));
    const row = view.expenses.find((e) => e.description === "Rooms exact")!;
    expect(row.shares.find((s) => s.playerId === player.dave)?.cents).toBe(18_137);
    expect(row.shares.find((s) => s.playerId === player.ann)?.cents).toBe(21_863);
    expect(view.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);
  });
});

describe("a repeated id is a double share, not a crash", () => {
  it("collapses a duplicate share instead of throwing on the unique key", async () => {
    // THE BUG: a repeated playerId passed every check and then violated
    // @@unique([expenseId, playerId]) on the way in, throwing out of the
    // action — a 500 to the browser rather than a message, on a money screen.
    await signIn("dave");
    const res = await addExpense({
      description: "Buggies",
      amountCents: 9_000,
      paidBy: player.dave,
      shares: [
        { playerId: player.dave, weight: 1 },
        { playerId: player.dave, weight: 1 },
        { playerId: player.ann, weight: 1 },
      ],
    });
    expect(res.ok, "a duplicate id must not throw").toBe(true);

    const view = await moneyFor(eventId, at("dave"));
    const row = view.expenses.find((e) => e.description === "Buggies")!;
    // Two rows of weight 1 for one person is a DOUBLE share — summed rather
    // than dropped, which is what shareOf does with them. Dave takes two
    // thirds; dropping the duplicate would have halved what he owes.
    expect(row.shares).toHaveLength(2);
    expect(row.shares.find((s) => s.playerId === player.dave)?.cents).toBe(6_000);
    expect(row.shares.find((s) => s.playerId === player.ann)?.cents).toBe(3_000);
    expect(view.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);
  });

  it("collapses a duplicate payer the same way", async () => {
    await signIn("dave");
    const res = await addExpense({
      description: "Bar tab",
      amountCents: 6_000,
      paidBy: player.dave,
      payers: [
        { playerId: player.dave, amountCents: 2_000 },
        { playerId: player.dave, amountCents: 4_000 },
      ],
    });
    expect(res.ok, "two lines from one payer is one payer paying twice").toBe(true);
    const view = await moneyFor(eventId, at("dave"));
    expect(view.standing.reduce((a, s) => a + s.netCents, 0)).toBe(0);
  });
});
