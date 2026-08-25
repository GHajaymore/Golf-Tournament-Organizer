"use server";
import { isExpenseCategory } from "@/lib/domain/expense-categories";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { isIsoDate } from "@/lib/deadline";
import { isValidAmount, MAX_EXPENSE_CENTS } from "@/lib/domain/expenses";

/**
 * Shared-expense actions.
 *
 * Every export here is a public HTTP endpoint that writes about MONEY between
 * friends, which is the highest bar in this app. The rules, stated once:
 *
 *  - Every id is scoped to `session.eventId`. A caller-supplied id is an
 *    attacker-chosen row until something narrows it to this tournament.
 *  - The shares are re-queried against THIS event's field rather than trusted
 *    from the client, the way `setSkinsEntrants` does it. A weight against a
 *    stranger's player id would put a stranger in a settle-up.
 *  - Anyone in the outing may add what they paid for; only the person who
 *    entered a line, or staff, may change or delete it. Somebody else editing
 *    the amount you are owed is the failure this feature cannot have.
 *  - EVERY WRITE IS AUDITED. Money actions in this app did not log, and the
 *    2026-08-12 audit called that out. A number that changed with nobody's
 *    name against it is a number a group cannot resolve an argument about.
 *
 * The app records money. It never moves it — a settlement row says a payment
 * happened, and nothing here has ever touched a payment rail.
 */

export interface ExpenseResult {
  ok: boolean;
  error?: string;
  id?: string;
}

export interface ExpenseInput {
  description: string;
  amountCents: number;
  paidBy: string;
  /** Player ids sharing the cost, with their weights. Empty means everyone. */
  shares?: Array<{ playerId: string; weight: number }>;
  stageId?: string;
  category?: string;
  spentOn?: string;
}

const DESCRIPTION_MAX = 80;
// CATEGORY_MAX went with the free-text category. The value is now checked
// against the offered list instead of being truncated, which is a stronger
// guarantee than a length: a 24-character category nobody offers still could
// not be grouped.

/** Who is signed in, and whether they run this tournament. */
async function requireEventSession() {
  const session = await getSession();
  if (!session?.eventId) throw new Error("Not authenticated");
  const isStaff = session.role === "admin" || session.role === "assistant";
  return { session, isStaff, eventId: session.eventId };
}

async function logMoney(eventId: string, action: string, detail: string) {
  const session = await getSession();
  await prisma.auditLog.create({
    data: { eventId, matchId: null, actor: session?.name ?? "system", action, detail },
  });
}

/** Cents as a whole number, formatted the way an audit row should read it. */
const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}${Math.abs(cents / 100).toFixed(2)}`;

/**
 * Clean one submission.
 *
 * Returns the row's data plus the shares, or an error. Nothing here trusts a
 * number: `amountCents` is bounded and integral before it reaches any
 * arithmetic, because a NaN in a ledger is every number in it gone.
 */
async function cleanInput(
  eventId: string,
  input: ExpenseInput,
): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      data: {
        description: string;
        amountCents: number;
        paidBy: string;
        stageId: string;
        category: string;
        spentOn: string;
      };
      shares: Array<{ playerId: string; weight: number }>;
    }
> {
  const description = (input.description ?? "").trim().slice(0, DESCRIPTION_MAX);
  if (!description) return { ok: false, error: "What was it for?" };

  const amountCents = Math.round(Number(input.amountCents));
  if (!isValidAmount(amountCents)) {
    return {
      ok: false,
      error: `Enter an amount up to ${money(MAX_EXPENSE_CENTS)} — a refund can be negative.`,
    };
  }
  if (amountCents === 0) return { ok: false, error: "An amount of zero isn't an expense." };

  // The payer must be in THIS tournament's field. Without this, an expense
  // could credit somebody who is not on the trip — and every other player's
  // balance would move to pay them.
  const payer = await prisma.player.findFirst({
    where: { id: (input.paidBy ?? "").trim(), eventId },
    select: { id: true },
  });
  if (!payer) return { ok: false, error: "Whoever paid has to be in this tournament." };

  const stageId = (input.stageId ?? "").trim();
  if (stageId) {
    const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { id: true } });
    if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  }

  const spentOn = (input.spentOn ?? "").trim();
  if (spentOn && !isIsoDate(spentOn)) return { ok: false, error: "Pick a date, or leave it blank." };

  // The field this expense may be split across, from the database rather than
  // from the caller. An id the client invented simply is not in this set.
  const field = await prisma.player.findMany({
    where: { eventId, status: { in: ["confirmed", "withdrawn"] } },
    select: { id: true },
  });
  const inField = new Set(field.map((p) => p.id));

  const requested = input.shares?.length
    ? input.shares
    : // No shares given is the common case and means everyone in the field,
      // split evenly — the default the screen offers.
      field.map((p) => ({ playerId: p.id, weight: 1 }));

  const shares = requested
    .filter((s) => inField.has(s.playerId))
    .map((s) => ({
      playerId: s.playerId,
      weight: Number.isFinite(s.weight) ? Math.max(0, Math.min(99, Math.round(s.weight))) : 0,
    }));

  if (shares.length === 0) return { ok: false, error: "Nobody to split this with." };

  return {
    ok: true,
    data: {
      description,
      amountCents,
      paidBy: payer.id,
      stageId,
      /**
       * One of ours, or "other".
       *
       * A `"use server"` export is a public endpoint and will be called with
       * whatever the caller likes — free text here would let anybody write a
       * category the picker never offers and the totals cannot group, which
       * is a ledger that silently stops adding up by category.
       */
      category: isExpenseCategory((input.category ?? "").trim()) ? input.category!.trim() : "other",
      spentOn,
    },
    shares,
  };
}

export async function addExpense(input: ExpenseInput): Promise<ExpenseResult> {
  const { session, eventId } = await requireEventSession();
  const clean = await cleanInput(eventId, input);
  if (!clean.ok) return { ok: false, error: clean.error };

  const expense = await prisma.expense.create({
    data: {
      eventId,
      ...clean.data,
      createdBy: session.name || session.email,
      shares: { create: clean.shares },
    },
  });

  await logMoney(
    eventId,
    "expense.add",
    `${clean.data.description} ${money(clean.data.amountCents)} paid by ${clean.data.paidBy}, split ${clean.shares.length} ways`,
  );
  revalidatePath("/", "layout");
  return { ok: true, id: expense.id };
}

/**
 * Change a line.
 *
 * Staff, or whoever entered it. Not "anyone in the outing": the amount you
 * are owed being edited by somebody else, silently, is the one thing that
 * would make a group stop trusting the ledger.
 */
export async function updateExpense(expenseId: string, input: ExpenseInput): Promise<ExpenseResult> {
  const { session, isStaff, eventId } = await requireEventSession();

  const existing = await prisma.expense.findFirst({
    where: { id: expenseId, eventId },
    select: { id: true, createdBy: true, amountCents: true, description: true },
  });
  if (!existing) return { ok: false, error: "That expense isn't in this tournament." };

  const mine = existing.createdBy === (session.name || session.email);
  if (!isStaff && !mine) {
    return { ok: false, error: "Only whoever entered this, or an organizer, can change it." };
  }

  const clean = await cleanInput(eventId, input);
  if (!clean.ok) return { ok: false, error: clean.error };

  // Shares are replaced wholesale rather than merged: a diff would have to
  // decide what an absent id means, and "removed from the split" and "not
  // sent this time" are not the same thing.
  await prisma.$transaction([
    prisma.expenseShare.deleteMany({ where: { expenseId } }),
    prisma.expense.update({
      where: { id: expenseId },
      data: { ...clean.data, shares: { create: clean.shares } },
    }),
  ]);

  await logMoney(
    eventId,
    "expense.update",
    `${existing.description} ${money(existing.amountCents)} → ${clean.data.description} ${money(clean.data.amountCents)}`,
  );
  revalidatePath("/", "layout");
  return { ok: true, id: expenseId };
}

export async function removeExpense(expenseId: string): Promise<ExpenseResult> {
  const { session, isStaff, eventId } = await requireEventSession();

  const existing = await prisma.expense.findFirst({
    where: { id: expenseId, eventId },
    select: { id: true, createdBy: true, description: true, amountCents: true },
  });
  if (!existing) return { ok: false, error: "That expense isn't in this tournament." };

  const mine = existing.createdBy === (session.name || session.email);
  if (!isStaff && !mine) {
    return { ok: false, error: "Only whoever entered this, or an organizer, can remove it." };
  }

  // Shares cascade with the expense.
  await prisma.expense.delete({ where: { id: expenseId } });
  await logMoney(
    eventId,
    "expense.remove",
    `Removed ${existing.description} ${money(existing.amountCents)}`,
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Record that somebody actually settled up.
 *
 * A FACT, not a status. The app is not moving this money and the copy must
 * never imply otherwise — this row says "Dave handed Ann $40", and the ledger
 * from here on is the standing position minus what has already changed hands.
 *
 * Both sides must be in the field, the amount must be positive (a settlement
 * is a payment; a negative one would be the same payment the other way and is
 * recorded as such), and it is audited like every other money write.
 */
export async function recordSettlement(
  fromPlayerId: string,
  toPlayerId: string,
  cents: number,
): Promise<ExpenseResult> {
  const { session, eventId } = await requireEventSession();

  const amount = Math.round(Number(cents));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_EXPENSE_CENTS) {
    return { ok: false, error: "Enter what actually changed hands." };
  }
  if (fromPlayerId === toPlayerId) return { ok: false, error: "That's the same player." };

  const both = await prisma.player.findMany({
    where: { eventId, id: { in: [fromPlayerId, toPlayerId] } },
    select: { id: true, name: true },
  });
  if (both.length !== 2) return { ok: false, error: "Both players have to be in this tournament." };

  const nameOf = (id: string) => both.find((p) => p.id === id)?.name ?? id;

  await prisma.settlement.create({
    data: {
      eventId,
      fromPlayerId,
      toPlayerId,
      cents: amount,
      recordedBy: session.name || session.email,
    },
  });

  await logMoney(
    eventId,
    "expense.settle",
    `${nameOf(fromPlayerId)} → ${nameOf(toPlayerId)} ${money(amount)}`,
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Undo a settlement recorded by mistake. Staff, or whoever recorded it. */
export async function removeSettlement(settlementId: string): Promise<ExpenseResult> {
  const { session, isStaff, eventId } = await requireEventSession();

  const existing = await prisma.settlement.findFirst({
    where: { id: settlementId, eventId },
    select: { id: true, recordedBy: true, cents: true, fromPlayerId: true, toPlayerId: true },
  });
  if (!existing) return { ok: false, error: "That settlement isn't in this tournament." };

  const mine = existing.recordedBy === (session.name || session.email);
  if (!isStaff && !mine) {
    return { ok: false, error: "Only whoever recorded this, or an organizer, can undo it." };
  }

  await prisma.settlement.delete({ where: { id: settlementId } });
  await logMoney(
    eventId,
    "expense.settle.undo",
    `Removed settlement ${money(existing.cents)} (${existing.fromPlayerId} → ${existing.toPlayerId})`,
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
