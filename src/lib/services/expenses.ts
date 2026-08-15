import "server-only";
import { prisma } from "../db";
import {
  balances,
  combinedBalances,
  positionFor,
  shareOf,
  type Expense as DomainExpense,
  type Net,
} from "../domain/expenses";
import { settle, type Transfer } from "../domain/money";
import { parseTeeSheet, groupForPlayer } from "../domain/tee-sheet";
import { isPlayingRound } from "../stage-types";

/**
 * The outing's money, gathered in the order somebody actually asks for it.
 *
 * "What do I owe" first, then "what is it made of", then "who do I hand it
 * to". The one number comes from the expense ledger AND the side games
 * together, because that is the only thing this app can do that a general
 * expense splitter cannot.
 *
 * Nothing here re-implements settlement or the split — both come from
 * domain/, which is tested to the cent. This layer is Prisma and names.
 */

export interface ExpenseRow {
  id: string;
  description: string;
  amountCents: number;
  category: string;
  spentOn: string;
  paidBy: string;
  /** The payer's name, or "" when they are no longer in the field. */
  paidByName: string;
  createdBy: string;
  /** Who shares it, with what each of them owes for this line. */
  shares: Array<{ playerId: string; name: string; weight: number; cents: number }>;
  /** True when this line's payer is a player id nobody in the field matches. */
  unknownPayer: boolean;
}

export interface SettlementRow {
  id: string;
  fromPlayerId: string;
  fromName: string;
  toPlayerId: string;
  toName: string;
  cents: number;
  recordedBy: string;
  settledAt: string;
}

export interface MoneyView {
  /** The signed-in player, when they are in this tournament's field. */
  playerId: string;
  /** Their one number: expenses plus side games, less anything settled. */
  netCents: number;
  /** The parts of it, so the total never has to be taken on faith. */
  expensesCents: number;
  gamesCents: number;
  settledCents: number;
  expenses: ExpenseRow[];
  settlements: SettlementRow[];
  /** Everyone's standing position, biggest creditor first. */
  standing: Array<{ playerId: string; name: string; netCents: number }>;
  /** Who hands what to whom to make everyone square. */
  transfers: Array<Transfer & { fromName: string; toName: string }>;
  /** The field, for the split picker. */
  field: Array<{ id: string; name: string }>;
  /**
   * The rounds a line can be tagged to, and who the signed-in player was out
   * with in each.
   *
   * The ledger stays at OUTING level — one number per person, one settle-up,
   * which is the entire point and is undone the moment money settles per
   * round. What varies is who shares a LINE: a cart fee belongs to the
   * foursome that rode in it, green fees to the round's field, dinner to
   * everybody. Splitting a cart across a 24-player outing is wrong, and
   * making the payer un-tick twenty people is how a feature stops being used.
   */
  rounds: Array<{
    stageId: string;
    label: string;
    /** The signed-in player's tee group in that round, empty when undrawn. */
    groupName: string;
    groupPlayerIds: string[];
  }>;
  /** True when this tournament has any money recorded at all. */
  used: boolean;
}

/**
 * Side-game money, as nets.
 *
 * Skins pots already settle per week in cents; this sums a player's position
 * across every pot in the tournament. Nassau is played inside a match and has
 * no stored stake yet, so it contributes nothing until it does — and it is
 * better for the screen to say the games total is skins-only than to invent a
 * number for a bet the app never recorded.
 */
async function gameNets(eventId: string): Promise<Net[]> {
  const pots = await prisma.skinsPot.findMany({
    where: { eventId },
    select: { id: true, buyInCents: true, entrants: { select: { playerId: true } } },
  });
  if (pots.length === 0) return [];

  // Deliberately NOT recomputing each pot's winners here. The pot's own
  // service owns that arithmetic, and a second implementation of it in a
  // money screen is exactly the drift this app has been burned by. Until that
  // is wired through, the stake is what is known to have changed hands.
  const totals = new Map<string, number>();
  for (const pot of pots) {
    for (const e of pot.entrants) {
      totals.set(e.playerId, (totals.get(e.playerId) ?? 0) - pot.buyInCents);
    }
    // The pot pays back out in full, so the stakes net to zero across its own
    // entrants until the week is scored.
    const stake = pot.buyInCents * pot.entrants.length;
    if (pot.entrants.length > 0 && stake !== 0) {
      const share = Math.floor(stake / pot.entrants.length);
      let left = stake - share * pot.entrants.length;
      for (const e of pot.entrants) {
        const extra = left > 0 ? 1 : 0;
        left -= extra;
        totals.set(e.playerId, (totals.get(e.playerId) ?? 0) + share + extra);
      }
    }
  }
  return [...totals.entries()].map(([playerId, netCents]) => ({ playerId, netCents }));
}

export async function moneyFor(eventId: string, email: string): Promise<MoneyView> {
  const [rows, settlements, players, stages] = await Promise.all([
    prisma.expense.findMany({
      where: { eventId },
      orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
      include: { shares: true },
    }),
    prisma.settlement.findMany({ where: { eventId }, orderBy: { settledAt: "desc" } }),
    prisma.player.findMany({
      where: { eventId, status: { in: ["confirmed", "withdrawn"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.stage.findMany({
      where: { eventId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, type: true, teeSheet: true },
    }),
  ]);

  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const me = players.find((p) => p.email.toLowerCase() === email.trim().toLowerCase());

  const domain: DomainExpense[] = rows.map((r) => ({
    id: r.id,
    description: r.description,
    amountCents: r.amountCents,
    paidBy: r.paidBy,
    shares: r.shares.map((s) => ({ playerId: s.playerId, weight: s.weight })),
  }));

  const expenseNets = balances(domain, players.map((p) => p.id));
  const games = await gameNets(eventId);

  /**
   * What has already changed hands.
   *
   * A settlement is a payment that happened, so it reduces the debt in one
   * direction and the credit in the other. Folded in as a net rather than
   * hidden, so the standing position is always "what is left", which is the
   * only figure anybody wants to read twice.
   */
  const settledNets: Net[] = [];
  const settledTotals = new Map<string, number>();
  for (const s of settlements) {
    settledTotals.set(s.fromPlayerId, (settledTotals.get(s.fromPlayerId) ?? 0) + s.cents);
    settledTotals.set(s.toPlayerId, (settledTotals.get(s.toPlayerId) ?? 0) - s.cents);
  }
  for (const [playerId, netCents] of settledTotals) settledNets.push({ playerId, netCents });

  const standingNets = combinedBalances(combinedBalances(expenseNets, games), settledNets);
  const position = me
    ? positionFor(me.id, expenseNets, games)
    : { playerId: "", expensesCents: 0, gamesCents: 0, netCents: 0 };

  const transfers = settle(standingNets).map((t) => ({
    ...t,
    fromName: nameOf.get(t.fromPlayerId) ?? "Someone no longer in the field",
    toName: nameOf.get(t.toPlayerId) ?? "Someone no longer in the field",
  }));

  const expenses: ExpenseRow[] = rows.map((r) => {
    const cents = shareOf({
      id: r.id,
      description: r.description,
      amountCents: r.amountCents,
      paidBy: r.paidBy,
      shares: r.shares.map((s) => ({ playerId: s.playerId, weight: s.weight })),
    });
    return {
      id: r.id,
      description: r.description,
      amountCents: r.amountCents,
      category: r.category,
      spentOn: r.spentOn,
      paidBy: r.paidBy,
      paidByName: nameOf.get(r.paidBy) ?? "",
      createdBy: r.createdBy,
      unknownPayer: !nameOf.has(r.paidBy),
      shares: r.shares.map((s) => ({
        playerId: s.playerId,
        name: nameOf.get(s.playerId) ?? "Not in the field",
        weight: s.weight,
        cents: cents.get(s.playerId) ?? 0,
      })),
    };
  });

  return {
    playerId: me?.id ?? "",
    netCents: me ? standingNets.find((n) => n.playerId === me.id)?.netCents ?? 0 : 0,
    expensesCents: position.expensesCents,
    gamesCents: position.gamesCents,
    settledCents: me ? settledTotals.get(me.id) ?? 0 : 0,
    expenses,
    settlements: settlements.map((s) => ({
      id: s.id,
      fromPlayerId: s.fromPlayerId,
      fromName: nameOf.get(s.fromPlayerId) ?? "Unknown",
      toPlayerId: s.toPlayerId,
      toName: nameOf.get(s.toPlayerId) ?? "Unknown",
      cents: s.cents,
      recordedBy: s.recordedBy,
      settledAt: s.settledAt.toISOString().slice(0, 10),
    })),
    standing: standingNets
      .filter((n) => nameOf.has(n.playerId) || n.netCents !== 0)
      .map((n) => ({
        playerId: n.playerId,
        name: nameOf.get(n.playerId) ?? "No longer in the field",
        netCents: n.netCents,
      })),
    transfers,
    field: players.map((p) => ({ id: p.id, name: p.name })),
    // Only rounds the field actually plays, and only the signed-in player's
    // own group in each — a picker offering every group in the draw is a list
    // of strangers to scroll past.
    rounds: stages
      .filter((s) => isPlayingRound(s.type))
      .map((s, i) => {
        const sheet = parseTeeSheet(s.teeSheet);
        const group = sheet && me ? groupForPlayer(sheet, me.id) : null;
        return {
          stageId: s.id,
          label: `Round ${i + 1}`,
          groupName: group?.name ?? "",
          groupPlayerIds: group?.playerIds.filter((id) => nameOf.has(id)) ?? [],
        };
      }),
    used: rows.length > 0 || settlements.length > 0,
  };
}

/** Whether this tournament shows the money tab at all. */
export async function usesExpenses(eventId: string): Promise<boolean> {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.count({ where: { eventId } }),
    prisma.settlement.count({ where: { eventId } }),
  ]);
  return expenses > 0 || settlements > 0;
}
