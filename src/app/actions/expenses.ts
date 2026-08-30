"use server";
import { isExpenseCategory } from "@/lib/domain/expense-categories";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { isIsoDate } from "@/lib/deadline";
import { isValidAmount, MAX_EXPENSE_CENTS, canChangeExpense } from "@/lib/domain/expenses";
import { money as fmtMoney } from "@/lib/domain/money-format";
import { currencyForEvent } from "@/lib/services/organization";
import { moneyFor } from "@/lib/services/expenses";
import { moneyRulesVersion } from "@/lib/domain/money-rules-version";

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
  /**
   * Who actually put money down, when it was more than one person.
   *
   * Omitted means `paidBy` paid the whole bill. When given, the amounts must
   * total `amountCents` exactly — a credit that does not total the bill puts
   * money into existence and unbalances everybody else's number.
   */
  payers?: Array<{ playerId: string; amountCents: number }>;
  /**
   * Player ids sharing the cost. Omitted means everyone, split evenly.
   *
   * `weight` is the usual case: 1 each is even, 2 is a double share, 0 is on
   * the trip but not on this bill. `amountCents` overrides it for a bill whose
   * amounts do not reduce to a ratio — and if any share sets one, they all
   * must, because the line is then split by exact amounts.
   */
  shares?: Array<{ playerId: string; weight: number; amountCents?: number }>;
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

/**
 * Which player the signed-in person IS, in this tournament.
 *
 * Resolved from the session's email against this event's field — never from a
 * playerId the caller sent, which would be the caller choosing who they are.
 * Returns null for somebody signed in but not entered, which is a real state:
 * an organizer who is not playing.
 */
async function callerPlayer(eventId: string, email: string) {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return null;
  return prisma.player.findFirst({
    where: { eventId, email: { equals: clean, mode: "insensitive" } },
    select: { id: true },
  });
}

async function logMoney(eventId: string, action: string, detail: string) {
  const session = await getSession();
  await prisma.auditLog.create({
    data: { eventId, matchId: null, actor: session?.name ?? "system", action, detail },
  });
}

/**
 * An amount, in the CLUB'S currency.
 *
 * This divided by a hundred and named no currency, which is wrong twice over
 * for a club outside the dollar. The error telling somebody their split is
 * short quoted a figure in the wrong money — and worse, every audit row, which
 * is the record a committee settles an argument from, recorded a bare number
 * that means one amount in London and a hundred times that in Tokyo.
 *
 * Takes the currency rather than reaching for it, so a caller cannot format an
 * amount without having established which money it is in.
 */
const money = (cents: number, currency: string) => fmtMoney(cents, currency);

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
      shares: Array<{ playerId: string; weight: number; amountCents: number | null }>;
      payers: Array<{ playerId: string; amountCents: number }>;
      /**
       * The club's currency, resolved once here and handed back.
       *
       * Returned rather than re-resolved by the caller so the audit row cannot
       * be written in a different money than the one the amount was just
       * validated against.
       */
      currency: string;
    }
> {
  // Established before any amount reaches a message, so no error can quote a
  // figure without saying which money it is in.
  const currency = await currencyForEvent(eventId);

  const description = (input.description ?? "").trim().slice(0, DESCRIPTION_MAX);
  if (!description) return { ok: false, error: "What was it for?" };

  const amountCents = Math.round(Number(input.amountCents));
  if (!isValidAmount(amountCents)) {
    return {
      ok: false,
      error: `Enter an amount up to ${money(MAX_EXPENSE_CENTS, currency)} — a refund can be negative.`,
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

  // OMITTED and EMPTY are not the same request.
  //
  // `undefined` means "no opinion" — the common case, and the default the
  // screen offers: everyone in the field, split evenly. An empty ARRAY is an
  // opinion, and the opinion is "nobody", which must fail rather than quietly
  // becoming its opposite.
  //
  // Written as `input.shares?.length ? ... : everyone` these collapsed, so a
  // caller that sent `shares: []` — a client bug, a stale picker, anyone
  // posting to this endpoint by hand — had the bill split across the WHOLE
  // FIELD instead of being refused. That is the worst available outcome: it
  // charges people who were not on the bill, and it looks deliberate in the
  // ledger afterwards.
  const requested: Array<{ playerId: string; weight: number; amountCents?: number }> =
    input.shares === undefined
      ? field.map((p) => ({ playerId: p.id, weight: 1 }))
      : input.shares;

  // Any share naming an amount switches the line to exact amounts. Mixing is
  // refused rather than resolved, because "half by weight, half by amount" has
  // no answer a person entering it could predict.
  const byAmount = requested.some((s) => s.amountCents !== undefined && s.amountCents !== null);

  /**
   * One row per player, whatever arrived.
   *
   * A repeated playerId passed every check here and then hit
   * `@@unique([expenseId, playerId])` on the way in, throwing out of the
   * action — a 500 to the browser rather than a message, on a screen about
   * money. The domain already collapses duplicates when it splits, so the two
   * agreed about the arithmetic and disagreed about whether the write was
   * even possible.
   *
   * Collapsed by SUMMING, which is what `shareOf` does with them: two rows of
   * weight 1 for one person is a double share, and dropping the second would
   * quietly halve what they owe.
   */
  const merged = new Map<string, { playerId: string; weight: number; amountCents: number | null }>();
  for (const s of requested) {
    if (!inField.has(s.playerId)) continue;
    const weight = Number.isFinite(s.weight) ? Math.max(0, Math.min(99, Math.round(s.weight))) : 0;
    const exact = byAmount ? Math.round(Number(s.amountCents ?? 0)) : null;
    const seen = merged.get(s.playerId);
    if (!seen) {
      merged.set(s.playerId, { playerId: s.playerId, weight, amountCents: exact });
      continue;
    }
    seen.weight = Math.min(99, seen.weight + weight);
    if (exact !== null) seen.amountCents = (seen.amountCents ?? 0) + exact;
  }
  const shares = [...merged.values()];

  if (shares.length === 0) return { ok: false, error: "Nobody to split this with." };

  if (byAmount) {
    if (shares.some((s) => !Number.isFinite(s.amountCents as number))) {
      return { ok: false, error: "Give everyone on this bill an amount, or split it by shares instead." };
    }
    /**
     * EACH share within the same bounds as the bill, not just their total.
     *
     * `isValidAmount` was checked on `amountCents` and on nothing else, and
     * the only other test here is that the parts add up to the whole. Two
     * parts can do that and still be absurd: a £10 round of drinks split as
     * `+£20,000,000` on one player and `-£19,999,990` on another sums to £10
     * exactly, passes every check, and fits the column.
     *
     * `addExpense` is a "use server" export, so any signed-in player of the
     * tournament can post that — and the target cannot take it off again,
     * because `canChangeExpense` gives that only to the line's creator or to
     * staff. It stands in their balance, in the standings and in the
     * settle-up's transfer sheet until an organizer removes it.
     */
    if (shares.some((s) => !isValidAmount(s.amountCents ?? 0))) {
      return {
        ok: false,
        error: `Each person's share has to be at most ${money(MAX_EXPENSE_CENTS, currency)}.`,
      };
    }
    const split = shares.reduce((sum, s) => sum + (s.amountCents ?? 0), 0);
    if (split !== amountCents) {
      const diff = amountCents - split;
      return {
        ok: false,
        error: `The amounts come to ${money(split, currency)}, not ${money(amountCents, currency)} — ${
          diff > 0 ? `${money(diff, currency)} short` : `${money(-diff, currency)} over`
        }.`,
      };
    }
  }

  /**
   * Who actually paid.
   *
   * Omitted is the common case and means the named payer covered it. When a
   * list IS given it has to total the bill exactly: `balances` credits payers
   * and debits sharers and is zero-sum only because those credits add up to
   * the amount. Letting $190 of payments stand against a $200 dinner would
   * invent $10 and shift every other player's number.
   */
  // Collapsed the same way as the shares, and for the same reason: a repeated
  // payer id met `@@unique([expenseId, playerId])` and threw. Two lines from
  // one person is one person paying twice, so the amounts add.
  const paid = new Map<string, number>();
  for (const p of input.payers ?? []) {
    if (!inField.has(p.playerId)) continue;
    const cents = Math.round(Number(p.amountCents));
    if (!Number.isFinite(cents)) continue;
    paid.set(p.playerId, (paid.get(p.playerId) ?? 0) + cents);
  }
  const payers = [...paid.entries()]
    .map(([playerId, amountCents]) => ({ playerId, amountCents }))
    .filter((p) => p.amountCents !== 0);

  if (input.payers?.length && payers.length === 0) {
    return { ok: false, error: "Whoever paid has to be in this tournament." };
  }
  if (payers.length > 0) {
    // The same bound, for the same reason: "they add up to the bill" is not
    // enough on its own, because a huge positive and a huge negative add up to
    // anything you like. A payer's credit lands in `balances` exactly as a
    // share's debit does.
    if (payers.some((p) => !isValidAmount(p.amountCents))) {
      return {
        ok: false,
        error: `What each person paid has to be at most ${money(MAX_EXPENSE_CENTS, currency)}.`,
      };
    }
    const laidOut = payers.reduce((sum, p) => sum + p.amountCents, 0);
    if (laidOut !== amountCents) {
      const diff = amountCents - laidOut;
      return {
        ok: false,
        error: `What everyone paid comes to ${money(laidOut, currency)}, not ${money(amountCents, currency)} — ${
          diff > 0 ? `${money(diff, currency)} unaccounted for` : `${money(-diff, currency)} too much`
        }.`,
      };
    }
  }

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
    payers,
    currency,
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
      /**
       * The EMAIL, not the display name.
       *
       * This is an identity — `canChangeExpense` decides who may edit a line
       * by comparing against it — and a display name is not one. A player who
       * self-registers picks their own name, so setting it to somebody else's
       * granted edit rights over that person's expenses. An email is unique
       * per account and nobody chooses another's.
       *
       * The screen shows a name rather than this: the service maps it back
       * through the field. Rows written before this hold a name and still
       * match on the name branch, which is the weaker check they were always
       * relying on.
       */
      createdBy: session.email || session.name,
      shares: { create: clean.shares },
      payments: { create: clean.payers },
    },
  });

  await logMoney(
    eventId,
    "expense.add",
    `${clean.data.description} ${money(clean.data.amountCents, clean.currency)} paid by ${clean.data.paidBy}, split ${clean.shares.length} ways`,
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

  // The shared rule, so the screen's Edit button and this check cannot
  // disagree — an offered button the server then refuses reads as a broken
  // app rather than as a rule.
  if (!canChangeExpense(existing.createdBy, { name: session.name, email: session.email, isStaff })) {
    return { ok: false, error: "Only whoever entered this, or an organizer, can change it." };
  }

  const clean = await cleanInput(eventId, input);
  if (!clean.ok) return { ok: false, error: clean.error };

  // Shares are replaced wholesale rather than merged: a diff would have to
  // decide what an absent id means, and "removed from the split" and "not
  // sent this time" are not the same thing.
  await prisma.$transaction([
    prisma.expenseShare.deleteMany({ where: { expenseId } }),
    // Payments go the same way as shares, and for the same reason: a diff
    // would have to decide what an absent id means, and "no longer paid
    // anything" and "not sent this time" are different facts. Leaving them
    // behind would also collide with the (expenseId, playerId) unique key on
    // the way back in.
    prisma.expensePayment.deleteMany({ where: { expenseId } }),
    prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...clean.data,
        shares: { create: clean.shares },
        payments: { create: clean.payers },
      },
    }),
  ]);

  await logMoney(
    eventId,
    "expense.update",
    `${existing.description} ${money(existing.amountCents, clean.currency)} → ${clean.data.description} ${money(clean.data.amountCents, clean.currency)}`,
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

  if (!canChangeExpense(existing.createdBy, { name: session.name, email: session.email, isStaff })) {
    return { ok: false, error: "Only whoever entered this, or an organizer, can remove it." };
  }

  // Shares cascade with the expense.
  const currency = await currencyForEvent(eventId);
  await prisma.expense.delete({ where: { id: expenseId } });
  await logMoney(
    eventId,
    "expense.remove",
    `Removed ${existing.description} ${money(existing.amountCents, currency)}`,
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
  const { session, isStaff, eventId } = await requireEventSession();

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

  /**
   * AND THE CALLER HAS TO BE ONE OF THEM.
   *
   * This checked only that both parties were in the tournament, so any
   * signed-in player could record "Ann handed Bob £200" between two other
   * people — a payment that never happened, moving both their balances, with
   * somebody else's name on it. Being in the field is not standing to say
   * what changed hands between two other members of it.
   *
   * Staff keep the exception, because a treasurer who collected the cash IS
   * the person who knows, and often is not one of the two.
   */
  if (!isStaff) {
    const me = await callerPlayer(eventId, session.email);
    if (!me || (me.id !== fromPlayerId && me.id !== toPlayerId)) {
      return {
        ok: false,
        error: "Only the two people involved, or an organizer, can record a settle-up.",
      };
    }
  }

  const nameOf = (id: string) => both.find((p) => p.id === id)?.name ?? id;
  const currency = await currencyForEvent(eventId);

  /**
   * WHAT THIS PAYMENT IS PAYING, captured now rather than inferred later.
   *
   * The standing position is worked out live from the expenses, the skins and
   * the side games. So a settlement that exactly cleared a debt stops looking
   * like one the moment any of those move — an expense corrected next week, a
   * skins result adjusted, a money rule fixed — and the bare row cannot then
   * tell "they paid what they owed" from "they underpaid by six pounds".
   *
   * Read rather than trusted from the caller: the amount comes off a form, and
   * a client that sent its own idea of the debt could write a settlement that
   * claims to have cleared one that never existed.
   */
  const view = await moneyFor(eventId, session.email, { isStaff });
  const standing = view.transfers.find(
    (t) => t.fromPlayerId === fromPlayerId && t.toPlayerId === toPlayerId,
  );

  await prisma.settlement.create({
    data: {
      eventId,
      fromPlayerId,
      toPlayerId,
      cents: amount,
      recordedBy: session.name || session.email,
      // Absent when the ledger shows nothing outstanding between these two —
      // a real case (somebody settling ahead of an expense being entered), and
      // one where a zero would claim the debt was nil rather than unknown.
      owedCents: standing ? standing.cents : null,
      rulesVersion: moneyRulesVersion(),
    },
  });

  await logMoney(
    eventId,
    "expense.settle",
    `${nameOf(fromPlayerId)} → ${nameOf(toPlayerId)} ${money(amount, currency)}`,
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

  /**
   * Staff, whoever recorded it, or EITHER PARTY TO IT.
   *
   * The two people are the ones who know whether the money changed hands, and
   * leaving them out was the sharper half of the bug above: a settlement
   * recorded between two other people could not be undone by either of them.
   * A wrong entry nobody named in it can remove is worse than one anybody can
   * make.
   */
  const mine = existing.recordedBy === (session.name || session.email);
  let party = false;
  if (!isStaff && !mine) {
    const me = await callerPlayer(eventId, session.email);
    party = !!me && (me.id === existing.fromPlayerId || me.id === existing.toPlayerId);
  }
  if (!isStaff && !mine && !party) {
    return {
      ok: false,
      error: "Only the two people involved, whoever recorded it, or an organizer, can undo it.",
    };
  }

  const currency = await currencyForEvent(eventId);
  await prisma.settlement.delete({ where: { id: settlementId } });
  await logMoney(
    eventId,
    "expense.settle.undo",
    `Removed settlement ${money(existing.cents, currency)} (${existing.fromPlayerId} → ${existing.toPlayerId})`,
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
