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
import { resolveMoneyMode, moneyScreenApplies } from "../domain/money-mode";
import { roundMoneyIsFinal } from "../domain/money-layout";
import { contestLedger, contestNets, isContestKind, isDecided, potOf } from "../domain/contests";
import {
  derivedNets,
  nassauLedger,
  isDerivedKind,
  DERIVED_LABEL,
  DERIVED_HELP,
  type DerivedKind,
} from "../domain/derived-games";
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
    /**
     * Whether they have put their name down, and whether the organizer has
     * taken their money. The two are separate on purpose: a name in the app is
     * an intention, and only cash is a stake.
     */
    youIn: boolean;
    youConfirmed: boolean;
  }>;
  /**
   * The pots the cards settle, for the player screen.
   *
   * Listed so somebody can put their own name down for the birdie pot without
   * finding the organizer first — and so the "side games" figure above can be
   * broken open into the bets that produced it. A Nassau is excluded: it
   * applies to the match rather than being a pot to join.
   */
  sideGames: Array<{
    id: string;
    kind: string;
    label: string;
    help: string;
    buyInCents: number;
    potCents: number;
    entrants: number;
    youIn: boolean;
    youConfirmed: boolean;
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
async function gameNets(eventId: string, onlyStageId?: string): Promise<Net[]> {
  // Scoped to one round when asked. Every pot type here is already per-stage,
  // so this is a filter rather than a second implementation — the player round
  // view and the outing ledger read the same arithmetic.
  const stageWhere = onlyStageId ? { stageId: onlyStageId } : {};
  const totals = new Map<string, number>();
  const add = (playerId: string, cents: number) => {
    if (!playerId || cents === 0) return;
    totals.set(playerId, (totals.get(playerId) ?? 0) + cents);
  };

  // ── Skins, through the pot's own service ────────────────────────────────
  const pots = await prisma.skinsPot.findMany({
    where: { eventId, ...stageWhere },
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
    where: { eventId, ...stageWhere },
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
        // CONFIRMED only. A player who put their own name down in the app has
        // stated an intention; the stake is the cash the organizer took, and
        // counting the rest would put money in the pot that nobody handed over.
        const entrantIds = game.entrants.filter((e) => e.confirmed).map((e) => e.playerId);
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
    where: { eventId, ...stageWhere },
    include: { entrants: true },
  });
  for (const n of contestLedger(
    contests.map((c) => ({
      id: c.id,
      kind: isContestKind(c.kind) ? c.kind : "other",
      name: c.name,
      buyInCents: c.buyInCents,
      // Confirmed stakes only — see the note on the derived pots above. A
      // WINNER is not filtered: somebody put down for the long drive without
      // paying in still won it, and the money still balances.
      entrantIds: c.entrants.filter((e) => e.confirmed).map((e) => e.playerId),
      winnerIds: c.entrants.filter((e) => e.won).map((e) => e.playerId),
    })),
  )) {
    add(n.playerId, n.netCents);
  }

  return [...totals.entries()].map(([playerId, netCents]) => ({ playerId, netCents }));
}

export async function moneyFor(eventId: string, email: string): Promise<MoneyView> {
  const [rows, settlements, players, stages, contestRows, sideGameRows] = await Promise.all([
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
    prisma.sideGame.findMany({
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
        // The pot shown is the money actually collected, so a screen never
        // prints a figure larger than the cash on the table.
        entrantIds: c.entrants.filter((e) => e.confirmed).map((e) => e.playerId),
        winnerIds: c.entrants.filter((e) => e.won).map((e) => e.playerId),
      };
      const mine = me ? c.entrants.find((e) => e.playerId === me.id) : undefined;
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
        /** Whether the signed-in player is in, and whether their money is in. */
        youIn: !!mine,
        youConfirmed: !!mine?.confirmed,
      };
    }),
    // Nassau is left out: it applies to a match rather than being a pot with
    // a door to join, and offering one would promise something to tap that
    // cannot do anything.
    sideGames: sideGameRows
      .filter((g) => g.kind !== "nassau" && g.buyInCents > 0 && isDerivedKind(g.kind))
      .map((g) => {
        const confirmed = g.entrants.filter((e) => e.confirmed);
        const mine = me ? g.entrants.find((e) => e.playerId === me.id) : undefined;
        const kind = g.kind as DerivedKind;
        return {
          id: g.id,
          kind: g.kind,
          label: DERIVED_LABEL[kind],
          help: DERIVED_HELP[kind],
          buyInCents: g.buyInCents,
          // The cash collected, never the number of names.
          potCents: g.buyInCents * confirmed.length,
          entrants: confirmed.length,
          youIn: !!mine,
          youConfirmed: !!mine?.confirmed,
        };
      }),
    used:
      rows.length > 0 ||
      settlements.length > 0 ||
      contestRows.length > 0 ||
      sideGameRows.length > 0,
  };
}

/** Whether this tournament shows the money tab at all. */
export async function usesExpenses(eventId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { moneyMode: true, organization: { select: { moneyMode: true, kind: true } } },
  });
  if (!event) return false;

  /**
   * The mode decides, where this used to guess from whether anything had been
   * entered yet. That guess was wrong in both directions: a tournament that
   * handles its money outside the app got a settle-up as soon as somebody
   * added one line, and a tournament that intends to use it showed nothing
   * until the first line existed, so there was no way to tell the feature was
   * there.
   */
  const mode = resolveMoneyMode({
    eventMode: event.moneyMode,
    orgMode: event.organization?.moneyMode,
    orgKind: event.organization?.kind,
  });
  if (!moneyScreenApplies(mode)) return false;

  // Under a mode that HAS a money screen, it is offered as soon as the
  // tournament is set up rather than only once somebody has used it —
  // otherwise the first person to need it cannot find it.
  return true;
}

export interface RoundMoneyRow {
  stageId: string;
  label: string;
  /** Whether the round's money can be reported yet. */
  final: boolean;
  /** Holes returned against holes to play, for the "still playing" line. */
  holesReturned: number;
  holeCount: number;
  /** The signed-in player's net for this round, in cents. */
  yourCents: number;
  /** Everyone's, biggest winner first — the round's own payout sheet. */
  standing: Array<{ playerId: string; name: string; netCents: number }>;
}

export interface RoundMoneyView {
  playerId: string;
  rounds: RoundMoneyRow[];
  /** The outing total: every round added up. */
  yourTotalCents: number;
  outingStanding: Array<{ playerId: string; name: string; netCents: number }>;
  /** True when at least one round has finished and has money in it. */
  anyFinal: boolean;
}

/**
 * The player's money, round by round, with the outing underneath.
 *
 * Both, because they answer different questions and one cannot stand in for
 * the other. "Did I win the skins on Thursday?" is a round; "what am I owed at
 * the end?" is the outing. A league settles every week and a running season
 * total is meaningless to it; a member-guest settles once and three separate
 * sheets are a nuisance.
 *
 * Final only. A round still being played reports nothing but the fact that it
 * is unfinished — see roundMoneyIsFinal for why a running skins position is
 * not an early view of the answer but a different number that looks like one.
 */
export async function roundMoneyFor(eventId: string, email: string): Promise<RoundMoneyView> {
  const state = await loadEventState(eventId);
  const me = state?.confirmed.find((p) => p.email?.toLowerCase() === email.trim().toLowerCase());
  const nameOf = new Map((state?.confirmed ?? []).map((p) => [p.id, p.name]));

  const stages = (state?.stages ?? []).filter((s) => isPlayingRound(s.type));
  const cards = await prisma.scorecard.findMany({ where: { eventId }, select: { stageId: true, strokes: true } });

  const rounds: RoundMoneyRow[] = [];
  const outingTotals = new Map<string, number>();

  for (const [i, stage] of stages.entries()) {
    const holeCount = stage.holes === 9 ? 9 : 18;
    // How much of the round is in. A hole counts as returned once anybody has
    // posted it — the pot is decided by the field, not by one card.
    const forStage = cards.filter((c) => c.stageId === stage.id);
    let holesReturned = 0;
    for (let h = 0; h < holeCount; h += 1) {
      const played = forStage.some((c) => {
        try {
          const arr = JSON.parse(c.strokes) as (number | null)[];
          return arr[h] != null;
        } catch {
          return false;
        }
      });
      if (played) holesReturned += 1;
    }

    const final = roundMoneyIsFinal({
      holesReturned,
      holeCount,
      roundComplete: state?.event.status === "completed",
    });

    // Nothing is computed for a round in progress. Not hidden after the fact —
    // not worked out at all, so there is no half-answer to leak.
    const nets = final ? await gameNets(eventId, stage.id) : [];
    for (const n of nets) outingTotals.set(n.playerId, (outingTotals.get(n.playerId) ?? 0) + n.netCents);

    rounds.push({
      stageId: stage.id,
      label: `Round ${i + 1}`,
      final,
      holesReturned,
      holeCount,
      yourCents: me ? nets.find((n) => n.playerId === me.id)?.netCents ?? 0 : 0,
      standing: nets
        .filter((n) => n.netCents !== 0)
        .map((n) => ({ playerId: n.playerId, name: nameOf.get(n.playerId) ?? "Unknown", netCents: n.netCents }))
        .sort((a, b) => b.netCents - a.netCents),
    });
  }

  return {
    playerId: me?.id ?? "",
    rounds,
    yourTotalCents: me ? outingTotals.get(me.id) ?? 0 : 0,
    outingStanding: [...outingTotals.entries()]
      .filter(([, cents]) => cents !== 0)
      .map(([playerId, netCents]) => ({ playerId, name: nameOf.get(playerId) ?? "Unknown", netCents }))
      .sort((a, b) => b.netCents - a.netCents),
    anyFinal: rounds.some((r) => r.final && r.standing.length > 0),
  };
}
