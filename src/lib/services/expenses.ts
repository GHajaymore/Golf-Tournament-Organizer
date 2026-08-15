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
import { contestLedger, contestNets, isContestKind, isDecided, potOf } from "../domain/contests";
import { derivedNets, nassauLedger, isDerivedKind } from "../domain/derived-games";
import { skinsPotFor } from "./skins-pot";
import { loadEventState, type HoleResultArr } from "./tournament";
import { resolveCourse } from "../courses";
import { holeStrokesReceived, allocationHoles } from "../domain";

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
  /**
   * The side bets, so the games figure can be broken open.
   *
   * A total labelled "side games" that a player cannot expand is a number
   * they have to take on trust, and the one thing an outing's money screen
   * cannot afford is a figure nobody can check.
   */
  contests: Array<{
    id: string;
    name: string;
    kind: string;
    hole: number;
    buyInCents: number;
    potCents: number;
    entrants: number;
    winners: string[];
    decided: boolean;
    /** What this contest did to the signed-in player, in cents. */
    yourCents: number;
  }>;
  /** True when this tournament has any money recorded at all. */
  used: boolean;
}

/**
 * Side-game money, as nets: the skins pots and the contests.
 *
 * The skins figures come from `skinsPotFor` — the pot's OWN service, which
 * already resolves the week's winners, the carries and the handicap strokes.
 * Calling it rather than recomputing here is the whole point: a second
 * implementation of the skins arithmetic living inside a money screen is
 * exactly the drift this app has been burned by, and this one would drift
 * about what somebody owes.
 *
 * Contests (closest to the pin, long drive) come from domain/contests, which
 * splits a tied pot to the cent by the same rule everything else uses.
 *
 * Nassau is played inside a match and has no stored stake, so it contributes
 * nothing — better for the screen to be honest about what it knows than to
 * invent a number for a bet the app never recorded.
 */
async function gameNets(eventId: string): Promise<Net[]> {
  const totals = new Map<string, number>();
  const add = (playerId: string, cents: number) => {
    if (!playerId || cents === 0) return;
    totals.set(playerId, (totals.get(playerId) ?? 0) + cents);
  };

  // ── Skins, through the pot's own service ────────────────────────────────
  const pots = await prisma.skinsPot.findMany({
    where: { eventId },
    select: { stageId: true, net: true },
  });
  for (const pot of pots) {
    const view = await skinsPotFor(eventId, pot.stageId, pot.net);
    // A pot with nobody in it has no result and no money — `result` is null
    // until somebody is entered, which is not the same as everyone at zero.
    for (const share of view?.result?.shares ?? []) add(share.playerId, share.netCents);
  }

  // ── Derived pots: low gross, low net, birdies, eagles, Nassau ───────────
  //
  // Worked out from the cards, never from a typed result. The prices come
  // from loadEventState's own resolver, so a net pot and the leaderboard
  // cannot disagree about how many strokes somebody receives.
  const sideGames = await prisma.sideGame.findMany({
    where: { eventId },
    include: { entrants: true },
  });
  if (sideGames.length > 0) {
    const state = await loadEventState(eventId);
    if (state) {
      const stageById = new Map(state.stages.map((s) => [s.id, s]));
      const cards = await prisma.scorecard.findMany({ where: { eventId } });

      for (const game of sideGames) {
        const stage = stageById.get(game.stageId);
        if (!stage) continue;
        const holes = stage.holes === 9 ? 9 : 18;
        const course = resolveCourse(state.event);
        const pars = course.pars.slice(0, holes);

        if (game.kind === "nassau") {
          // Every match in the round, at the same stake — how a club calls one.
          const bets = state.matches
            .filter((m) => m.stageId === game.stageId && m.playerAId && m.playerBId)
            .map((m) => {
              let parsed: HoleResultArr = [];
              try {
                parsed = JSON.parse(m.holes) as HoleResultArr;
              } catch {
                parsed = [];
              }
              return {
                matchId: m.id,
                playerAId: m.playerAId,
                playerBId: m.playerBId,
                holes: parsed,
                stakeCents: game.buyInCents,
              };
            });
          for (const n of nassauLedger(bets)) add(n.playerId, n.netCents);
          continue;
        }

        if (!isDerivedKind(game.kind)) continue;
        const entrantIds = game.entrants.map((e) => e.playerId);
        const potCards = cards
          .filter((c) => c.stageId === game.stageId && entrantIds.includes(c.playerId))
          .map((c) => {
            let strokes: (number | null)[] = [];
            try {
              strokes = JSON.parse(c.strokes) as (number | null)[];
            } catch {
              strokes = [];
            }
            // Strokes received over the holes actually played, from the same
            // resolver the board totals with.
            const playing = state.strokeHandicapFor(c.playerId, c.stageId);
            const alloc = allocationHoles(holes);
            let received = 0;
            for (let i = 0; i < holes; i += 1) {
              const s = strokes[i];
              if (typeof s !== "number" || s <= 0) continue;
              received += holeStrokesReceived(playing, course.strokeIndex[i] ?? 18, alloc);
            }
            return { playerId: c.playerId, strokes, strokesReceived: received };
          });

        for (const n of derivedNets({
          kind: game.kind,
          buyInCents: game.buyInCents,
          entrantIds,
          cards: potCards,
          pars,
        })) {
          add(n.playerId, n.netCents);
        }
      }
    }
  }

  // ── Contests ────────────────────────────────────────────────────────────
  const contests = await prisma.contest.findMany({
    where: { eventId },
    include: { entrants: true },
  });
  for (const n of contestLedger(
    contests.map((c) => ({
      id: c.id,
      kind: isContestKind(c.kind) ? c.kind : "other",
      name: c.name,
      buyInCents: c.buyInCents,
      entrantIds: c.entrants.map((e) => e.playerId),
      winnerIds: c.entrants.filter((e) => e.won).map((e) => e.playerId),
    })),
  )) {
    add(n.playerId, n.netCents);
  }

  return [...totals.entries()].map(([playerId, netCents]) => ({ playerId, netCents }));
}

export async function moneyFor(eventId: string, email: string): Promise<MoneyView> {
  const [rows, settlements, players, stages, contestRows] = await Promise.all([
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
    prisma.contest.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }],
      include: { entrants: true },
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
    contests: contestRows.map((c) => {
      const shaped = {
        id: c.id,
        kind: isContestKind(c.kind) ? c.kind : ("other" as const),
        name: c.name,
        buyInCents: c.buyInCents,
        entrantIds: c.entrants.map((e) => e.playerId),
        winnerIds: c.entrants.filter((e) => e.won).map((e) => e.playerId),
      };
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        hole: c.hole,
        buyInCents: c.buyInCents,
        potCents: potOf(shaped),
        entrants: shaped.entrantIds.length,
        winners: shaped.winnerIds.map((id) => nameOf.get(id) ?? "Unknown"),
        decided: isDecided(shaped),
        yourCents: me ? contestNets(shaped).find((n) => n.playerId === me.id)?.netCents ?? 0 : 0,
      };
    }),
    used: rows.length > 0 || settlements.length > 0 || contestRows.length > 0,
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
