import "server-only";
import { prisma } from "../db";
import {
  balances,
  canChangeExpense,
  combinedBalances,
  positionFor,
  shareOf,
  type Expense as DomainExpense,
  type Net,
} from "../domain/expenses";
import { settle, type Transfer } from "../domain/money";
import { parseTeeSheet, groupForPlayer } from "../domain/tee-sheet";
import { isPlayingRound } from "../stage-types";
import { resolveMoneyMode, sharedCostsApply, moneyScreenApplies } from "../domain/money-mode";
import { roundMoneyIsFinal } from "../domain/money-layout";
import { potMembership, isPotEntryMode } from "../domain/pot-entry";
import { potAudience } from "../domain/pot-audience";
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
import { isSkinsScope, skinsGameLabel } from "@/lib/domain/skins-pot";
import { loadEventState, matchSettled, type HoleResultArr } from "./tournament";
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
  /**
   * Everyone who actually paid, when more than one person did. Empty means
   * `paidBy` covered the whole bill, which is the ordinary case.
   */
  payers: Array<{ playerId: string; name: string; amountCents: number }>;
  createdBy: string;
  /**
   * Whether the person looking at this may change or remove it.
   *
   * Answered here, from the same rule the action enforces, so the screen never
   * offers an Edit that the server refuses.
   */
  canEdit: boolean;
  /** Who shares it, with what each of them owes for this line. */
  shares: Array<{
    playerId: string;
    name: string;
    weight: number;
    /** The exact amount typed for this person, or null when split by weight. */
    exactCents: number | null;
    cents: number;
  }>;
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
    /**
     * Present when this row is a SKINS pot rather than a derived game.
     *
     * A skins pot is not identified by an id the way a side game is — it is
     * named by (round, gross-or-net, which holes, whose). So a join request
     * has to carry all four, and the client dispatches on this being here.
     * Threading a fake id instead would mean inventing an identity the store
     * does not have.
     */
    skins?: { stageId: string; net: boolean; scope: string; groupKey: string };
  }>;
  /**
   * The signed-in player’s side-game money, itemised.
   *
   * What the “rest of your side bets” lump used to be. A player can now see
   * WHICH game and WHICH holes produced it — the thing a general expense
   * splitter can never show, because it never scored the round.
   */
  gameLines: Array<{ label: string; detail: string; cents: number }>;
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
/** One game, and what it did for one player. */
export interface GameLine {
  playerId: string;
  label: string;
  detail: string;
  cents: number;
}

async function gameNets(
  eventId: string,
  onlyStageId?: string,
): Promise<{ nets: Net[]; lines: GameLine[] }> {
  // The field an opt-out pot draws its members from. Confirmed entries only:
  // "everyone in the field" means everyone PLAYING.
  const fieldRows = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { id: true },
  });
  const fieldIds = fieldRows.map((r) => r.id);
  // Scoped to one round when asked. Every pot type here is already per-stage,
  // so this is a filter rather than a second implementation — the player round
  // view and the outing ledger read the same arithmetic.
  const stageWhere = onlyStageId ? { stageId: onlyStageId } : {};
  const totals = new Map<string, number>();
  /**
   * The itemised half.
   *
   * A player saw their skins money as one lump captioned “the rest of your
   * side bets” — money in their own total that the screen could not account
   * for, which is the fastest way to make a correct number look wrong. The
   * pot service already knows which holes somebody won; it was thrown away
   * one line later.
   */
  const lines: GameLine[] = [];
  const add = (playerId: string, cents: number) => {
    if (!playerId || cents === 0) return;
    totals.set(playerId, (totals.get(playerId) ?? 0) + cents);
  };

  // ── Skins, through the pot's own service ────────────────────────────────
  const pots = await prisma.skinsPot.findMany({
    where: { eventId, ...stageWhere },
    // The SCOPE too, since a league night runs four pots on one round and
    // (stageId, net) no longer names one of them. Reading without it asked
    // for the same pot four times and missed three lots of money.
    //
    // AND THE GROUP, for exactly the same reason one scope wider. Without it
    // this enumerated every pot on the round and then re-read the FIELD's one
    // each time: a club running its own skins beside two fourballs had its
    // pot counted three times in the settle-up, and neither fourball's money
    // appeared at all. Four independent passes of the 2026-08-25 audit found
    // this, which is what a rule with many readers looks like from outside.
    select: { stageId: true, net: true, scope: true, groupKey: true },
  });
  for (const pot of pots) {
    const view = await skinsPotFor(
      eventId,
      pot.stageId,
      pot.net,
      isSkinsScope(pot.scope) ? pot.scope : "full",
      pot.groupKey,
    );
    // A pot with nobody in it has no result and no money — `result` is null
    // until somebody is entered, which is not the same as everyone at zero.
    for (const share of view?.result?.shares ?? []) {
      add(share.playerId, share.netCents);
      if (!view) continue;
      // Which holes this player actually took, so the figure can be checked
      // against what they remember of the round rather than believed.
      const won = view.holes.filter((h) => h.playerId === share.playerId).map((h) => h.hole);
      lines.push({
        playerId: share.playerId,
        // The group leads when there is one. Without it a player in both the
        // club's pot and their fourball's sees two identical lines called
        // "Skins (Net)" and cannot tell which money is which — the same
        // failure as the unexplained lump this itemisation replaced.
        label: pot.groupKey
          ? `${pot.groupKey} — ${skinsGameLabel(pot.net, isSkinsScope(pot.scope) ? pot.scope : "full")}`
          : skinsGameLabel(pot.net, isSkinsScope(pot.scope) ? pot.scope : "full"),
        detail: won.length
          ? `won ${won.length === 1 ? "the" : ""} ${won.length === 1 ? "" : won.length + " holes: "}${won.join(", ")}`.replace(/s+/g, " ").trim()
          : "no skins won",
        cents: share.netCents,
      });
    }
  }

  // ── Derived pots: low gross, low net, birdies, eagles, Nassau ───────────
  //
  // Worked out from the cards, never from a typed result. The prices come
  // from loadEventState's own resolver, so a net pot and the leaderboard
  // cannot disagree about how many strokes somebody receives.
  const sideGames = await prisma.sideGame.findMany({
    // Every game, the club's and each fourball's, WITH its group — the same
    // shape the skins pots read in. This filtered to the field's games and
    // `saveSideGame` refused to create any other, because settling a group's
    // game meant charging the whole field for a fourball's private bet. What
    // was missing was never the arithmetic: it was knowing WHO the pot's
    // audience is, which is resolved per game below.
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
          /**
           * Every match in the round, at the same stake — how a club calls one.
           *
           * A GROUP's Nassau is the matches inside that fourball, which needs
           * no audience calculation: a Nassau is settled between the two
           * players in a match, so restricting to matches whose BOTH players
           * are in the group is the whole of it. A match spanning two groups
           * belongs to neither's private bet.
           */
          const nassauGroup = game.groupKey
            ? parseTeeSheet(stage.teeSheet ?? "")?.groups.find((g) => g.name === game.groupKey)
            : null;
          const inNassau = nassauGroup ? new Set(nassauGroup.playerIds) : null;
          const bets = state.matches
            .filter(
              (m) =>
                m.stageId === game.stageId &&
                m.playerAId &&
                m.playerBId &&
                (!inNassau || (inNassau.has(m.playerAId) && inNassau.has(m.playerBId))),
            )
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
        // Through potMembership, the same as the contests below. Opt-in still
        // means confirmed stakes only — a name put down in the app is an
        // intention and the stake is the cash the organizer took — and opt-out
        // means the field, which carries no rows for the people who never had
        // to say anything.
        // Who this pot is OFFERED to: the field for the club's game, the
        // fourball for a group's. One reader, in domain/pot-audience.ts, and
        // tested there — the rule matters most in opt-out mode, where the
        // audience IS the membership.
        const audience = potAudience(game.groupKey, stage.teeSheet ?? "", fieldIds);

        const entrantIds = potMembership(
          isPotEntryMode(game.entryMode) ? game.entryMode : "opt-in",
          audience,
          game.entrants,
        ).entrants;
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
      /**
       * Through potMembership, so an opt-out pot means what it says here too.
       *
       * This read the entry rows directly, which is right for opt-in and
       * silently wrong for opt-out: an everyone-in contest carries no rows for
       * the people who never had to say anything, so the pot came out as the
       * handful who did — and the ledger disagreed with the prizes screen next
       * door about the same contest. One rule, read in both places.
       *
       * A WINNER is still not filtered: somebody put down for the long drive
       * without paying in still won it, and the money still balances.
       */
      entrantIds: potMembership(
        isPotEntryMode(c.entryMode) ? c.entryMode : "opt-in",
        fieldIds,
        c.entrants,
      ).entrants,
      winnerIds: c.entrants.filter((e) => e.won).map((e) => e.playerId),
    })),
  )) {
    add(n.playerId, n.netCents);
  }

  return {
    nets: [...totals.entries()].map(([playerId, netCents]) => ({ playerId, netCents })),
    lines,
  };
}

export async function moneyFor(
  eventId: string,
  email: string,
  /**
   * Who is looking, so each row can say whether THEY may change it. Omitted
   * behaves as a plain player, which is the safe direction: a button that is
   * missing is a smaller failure than one that is refused.
   */
  viewer: { name?: string; isStaff?: boolean } = {},
): Promise<MoneyView> {
  // The field an opt-out pot draws on. Confirmed only — "everyone in the
  // field" means everyone PLAYING, and a withdrawn player is not.
  const confirmedField = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { id: true },
  });
  const moneyFieldIds = confirmedField.map((p) => p.id);

  const [rows, settlements, players, stages, contestRows, sideGameRows, skinsRows] = await Promise.all([
    prisma.expense.findMany({
      where: { eventId },
      orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }],
      include: { shares: true, payments: true },
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
      // Every game, the club's and each group's. The label below says which,
      // because a player in both otherwise sees two rows called "Birdie pot"
      // and cannot tell which money is which.
      where: { eventId },
      orderBy: [{ createdAt: "asc" }],
      include: { entrants: true },
    }),
    /**
     * The skins pots, so a player can ask into one from their own screen.
     *
     * They were absent, which made "can I join your skins?" unanswerable in
     * the app: the pots existed, the player could not see them, and the only
     * way in was to find somebody already in it and ask them to tick you.
     * Skins is the commonest casual bet there is, so that was the commonest
     * thing the app could not do.
     *
     * `groupKey` is selected — via `include` — because it decides both the
     * label and which pot a join request names. Reading these without it is
     * the fault the 2026-08-25 audit found four times over.
     */
    prisma.skinsPot.findMany({
      where: { eventId },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        stageId: true,
        net: true,
        scope: true,
        groupKey: true,
        buyInCents: true,
        entrants: { select: { playerId: true, confirmed: true } },
      },
    }),
  ]);

  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  /**
   * Email to display name, for the "entered by" line.
   *
   * `Expense.createdBy` holds an EMAIL now — a display name is something a
   * self-registering player chooses, and it was being used to decide who may
   * edit a line. The screen still wants a name, so it is resolved here rather
   * than stored twice. A row from before the change holds a name already and
   * falls through unchanged.
   */
  const byEmail = new Map(
    players.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p.name]),
  );
  const enteredBy = (who: string) => byEmail.get((who ?? "").toLowerCase()) ?? who;
  const me = players.find((p) => p.email.toLowerCase() === email.trim().toLowerCase());

  const domain: DomainExpense[] = rows.map((r) => ({
    id: r.id,
    description: r.description,
    amountCents: r.amountCents,
    paidBy: r.paidBy,
    shares: r.shares.map((s) => ({ playerId: s.playerId, weight: s.weight, amountCents: s.amountCents ?? undefined })),
    payments: r.payments.map((p) => ({ playerId: p.playerId, amountCents: p.amountCents })),
  }));

  const expenseNets = balances(domain, players.map((p) => p.id));
  const gamesResult = await gameNets(eventId);

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

  const { nets: games, lines: gameLines } = gamesResult;
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
      shares: r.shares.map((s) => ({
        playerId: s.playerId,
        weight: s.weight,
        amountCents: s.amountCents ?? undefined,
      })),
      payments: r.payments.map((p) => ({ playerId: p.playerId, amountCents: p.amountCents })),
    });
    return {
      id: r.id,
      description: r.description,
      amountCents: r.amountCents,
      category: r.category,
      spentOn: r.spentOn,
      paidBy: r.paidBy,
      paidByName: nameOf.get(r.paidBy) ?? "",
      /**
       * Everyone who actually put money down.
       *
       * The screen said "Paid by {paidByName}" — ONE name — from the moment a
       * bill could have several payers, so a dinner split across two cards
       * credited both in the arithmetic and named one of them on screen. The
       * number was right and the sentence was wrong, which is the version of
       * this that nobody reports and everybody distrusts.
       *
       * Empty when nobody itemised, which still means `paidBy` covered it.
       */
      payers: r.payments
        .map((p) => ({
          playerId: p.playerId,
          name: nameOf.get(p.playerId) ?? "Not in the field",
          amountCents: p.amountCents,
        }))
        .sort((a, b) => b.amountCents - a.amountCents),
      createdBy: enteredBy(r.createdBy),
      // The same rule the action enforces, asked once here so the screen
      // cannot offer an Edit the server will refuse.
      canEdit: canChangeExpense(r.createdBy, { name: viewer.name, email, isStaff: viewer.isStaff }),
      unknownPayer: !nameOf.has(r.paidBy),
      shares: r.shares.map((s) => ({
        playerId: s.playerId,
        name: nameOf.get(s.playerId) ?? "Not in the field",
        weight: s.weight,
        // The exact amount somebody typed, when this line was split that way.
        // Carried so an edit can reopen the form in the mode it was saved in.
        exactCents: s.amountCents ?? null,
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
        /**
         * Through potMembership, like the ledger arithmetic above.
         *
         * The DISPLAY read the rows directly while the settlement had already
         * been taught opt-out, so the same contest read "$5.00 pot, 1 in" in
         * the side-bets list and settled for $165 three inches below it. The
         * pot shown is still only money actually collected — that is what
         * potMembership returns as entrants — so no screen prints a figure
         * larger than the cash on the table.
         */
        entrantIds: potMembership(
          isPotEntryMode(c.entryMode) ? c.entryMode : "opt-in",
          moneyFieldIds,
          c.entrants,
        ).entrants,
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
          // The group leads when there is one, the way the skins lines read.
          label: g.groupKey ? `${g.groupKey} — ${DERIVED_LABEL[kind]}` : DERIVED_LABEL[kind],
          help: DERIVED_HELP[kind],
          buyInCents: g.buyInCents,
          // The cash collected, never the number of names.
          potCents: g.buyInCents * confirmed.length,
          entrants: confirmed.length,
          youIn: !!mine,
          youConfirmed: !!mine?.confirmed,
        };
      })
      /**
       * And the skins pots, in the same list and on the same terms.
       *
       * One list rather than two, because to a player they are the same
       * question — what is running, am I in it, what does it cost. Splitting
       * them by which table they live in would be the app explaining its own
       * schema to somebody standing on a tee.
       *
       * A pot with no buy-in is not offered: there is nothing to join.
       */
      .concat(
        skinsRows
          .filter((p) => p.buyInCents > 0)
          .map((p) => {
            const confirmed = p.entrants.filter((e) => e.confirmed);
            const mine = me ? p.entrants.find((e) => e.playerId === me.id) : undefined;
            const holes =
              p.scope === "front" ? " front 9" : p.scope === "back" ? " back 9" : "";
            const what = `Skins — ${p.net ? "net" : "gross"}${holes}`;
            return {
              id: p.id,
              kind: "skins",
              // The group leads when there is one, the way the derived rows do.
              label: p.groupKey ? `${p.groupKey} — ${what}` : what,
              help: "Low score wins the hole. Ties carry to the next one.",
              buyInCents: p.buyInCents,
              // The cash collected, never the number of names.
              potCents: p.buyInCents * confirmed.length,
              entrants: confirmed.length,
              youIn: !!mine,
              youConfirmed: !!mine?.confirmed,
              skins: {
                stageId: p.stageId,
                net: p.net,
                scope: p.scope,
                groupKey: p.groupKey,
              },
            };
          }),
      ),
    // Only the signed-in player’s. Somebody else’s itemised winnings are
    // not this screen’s to hand out.
    gameLines: me
      ? gameLines.filter((l) => l.playerId === me.id).map(({ label, detail, cents }) => ({ label, detail, cents }))
      : [],
    used:
      rows.length > 0 ||
      settlements.length > 0 ||
      contestRows.length > 0 ||
      sideGameRows.length > 0,
  };
}

/**
 * Whether this tournament has any money game at all — a skins pot, a side
 * game, or a contest.
 *
 * The three pot tables `gameNets` settles from, asked as one question. A
 * fourth pot table added without being added here will make the money tab
 * disappear for the players who staked in it, which is the same shape of bug
 * as reading pot membership three ways.
 */
export async function hasMoneyGames(eventId: string): Promise<boolean> {
  const [skins, side, contest] = await Promise.all([
    prisma.skinsPot.findFirst({ where: { eventId }, select: { id: true } }),
    prisma.sideGame.findFirst({ where: { eventId }, select: { id: true } }),
    prisma.contest.findFirst({ where: { eventId }, select: { id: true } }),
  ]);
  return !!(skins || side || contest);
}

/**
 * Whether this tournament shows the money tab at all.
 *
 * TWO questions, and they were being answered as one.
 *
 * "Does this tournament share costs?" is the MODE — the ledger and the kitty,
 * which is what `none` is really turning off. It used to guess from whether
 * anything had been entered yet, and that guess was wrong in both directions:
 * a tournament handling its money outside the app got a settle-up as soon as
 * somebody added one line, and a tournament that intended to use it showed
 * nothing until the first line existed.
 *
 * "Did anyone win the skins?" is a different question, and the answer does not
 * depend on who is running the golf. A club is `none` by default — correctly,
 * the shop takes the entry fee and pays the winner — but a club runs skins and
 * a 2s pot every Saturday, and the app is the thing that works out who won
 * them. That is a RESULT, not a cash book — a stake settled at the bar the same
 * evening, as against a share of the minibus somebody fronted, which is the
 * distinction org-profile draws in `ledger`.
 *
 * Under `none` the whole tab was hidden, so the organizer settled the skins on
 * the prizes screen (which is gated on the round, not the mode, so it always
 * worked) and every player was redirected away from the answer. The money-game
 * calculation was running and nobody it belonged to could see it.
 */
export async function usesExpenses(eventId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { moneyMode: true, organization: { select: { moneyMode: true, kind: true } } },
  });
  if (!event) return false;

  const mode = resolveMoneyMode({
    eventMode: event.moneyMode,
    orgMode: event.organization?.moneyMode,
    orgKind: event.organization?.kind,
  });
  /**
   * The pot query is skipped when the mode alone settles it, which cannot
   * change the answer: `moneyScreenApplies` is an OR, so a true left-hand side
   * makes the right irrelevant. The RULE still lives in one place — this
   * function gathers facts and does not decide.
   *
   * Under a mode that has a ledger or a kitty the tab is offered as soon as the
   * tournament is set up, rather than once somebody has used it, or the first
   * person to need it cannot find it. Under `none` there is nothing standing
   * until a pot exists — no pots, no tab, and no empty screen implying
   * something is missing.
   */
  const hasPots = sharedCostsApply(mode) ? false : await hasMoneyGames(eventId);
  return moneyScreenApplies({ mode, hasPots });
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
  /**
   * What the signed-in player has riding on rounds that are still in play.
   *
   * A player can be in five games at once — the club's pot, their fourball's
   * skins, a birdie pot, a two-man bet and a closest-to-the-pin — and until
   * this the screen showed five separate rows and no total. The one number
   * somebody wants before they tee off is what it costs if it all goes wrong,
   * and adding up five stakes in your head on the first tee is exactly the
   * sort of arithmetic this app exists to stop doing.
   *
   * Stakes, NOT a running position. See `roundMoneyIsFinal`: a half-played
   * skins pot has a standing that looks like an answer and is not one. This
   * number is knowable the moment the bets are agreed and does not change as
   * holes come in, which is what makes it safe to show while a round is live.
   */
  stake: {
    /** How many games they are in, across every round still in play. */
    games: number;
    /** What those stakes come to, in cents. */
    cents: number;
  };
}

/**
 * What one player has riding on one round.
 *
 * Deliberately reads MEMBERSHIP and nothing else — no scorecard, no match, no
 * winner. It cannot leak a half-played result because it never computes one,
 * which is what lets it run on a round that `roundMoneyIsFinal` says is not
 * ready to report.
 *
 * Who is in comes from `potMembership` and `potAudience`, the same two readers
 * the settlement uses. A second opinion about who is in a pot is how a screen
 * ends up printing "1 in" above a pot that settles for four.
 *
 * `entrants` are stakes already collected and `pending` are people who are in
 * and still owe it. Both count here: what a player is exposed to is what they
 * will owe, not what the organizer has already taken off them.
 */
async function stakeFor(
  stageId: string,
  playerId: string,
  fieldIds: string[],
  teeSheetJson: string,
): Promise<{ games: number; cents: number }> {
  const [pots, games, contests] = await Promise.all([
    /**
     * The player's own ENTRY rows, not the round's pots.
     *
     * A skins pot has no entry mode — its membership IS its entrant rows — so
     * "which pots is this player staked in" is a question about entries, and
     * asking it that way round means never holding a pot without knowing whose
     * it is. Listing the round's pots and testing each one's entrants would be
     * the shape that lost every group's money in the 2026-08-25 audit, even
     * though it happens to be harmless here.
     */
    prisma.skinsEntry.findMany({
      where: { playerId, pot: { stageId, buyInCents: { gt: 0 } } },
      select: { pot: { select: { buyInCents: true } } },
    }),
    prisma.sideGame.findMany({
      where: { stageId, buyInCents: { gt: 0 } },
      select: {
        buyInCents: true,
        kind: true,
        entryMode: true,
        groupKey: true,
        entrants: { select: { playerId: true, confirmed: true, excluded: true } },
      },
    }),
    prisma.contest.findMany({
      where: { stageId, buyInCents: { gt: 0 } },
      select: {
        buyInCents: true,
        entryMode: true,
        entrants: { select: { playerId: true, confirmed: true, excluded: true } },
      },
    }),
  ]);

  let count = 0;
  let cents = 0;
  const add = (inIt: boolean, buyInCents: number) => {
    if (!inIt) return;
    count += 1;
    cents += buyInCents;
  };

  /**
   * Every row here is already this player's own, on a pot on this round.
   *
   * Confirmed AND pending, deliberately, exactly as the side games below.
   * `confirmed` is whether somebody has the cash; exposure is what the player
   * will owe. Counting only paid-up rows would show £0 to somebody who has
   * asked into four bets and not paid yet — precisely the person the figure is
   * for.
   */
  for (const p of pots) add(true, p.pot.buyInCents);

  for (const g of games) {
    // A Nassau is three bets inside a match rather than a pot with a door, so
    // it has no entrant list to read and its cost depends on who somebody is
    // drawn against. Counting it here would mean inventing a number.
    if (g.kind === "nassau") continue;
    const audience = potAudience(g.groupKey, teeSheetJson, fieldIds);
    const who = potMembership(isPotEntryMode(g.entryMode) ? g.entryMode : "opt-in", audience, g.entrants);
    add(who.entrants.includes(playerId) || who.pending.includes(playerId), g.buyInCents);
  }

  // Contests have no group key — a closest-to-the-pin is the field's.
  for (const c of contests) {
    const who = potMembership(isPotEntryMode(c.entryMode) ? c.entryMode : "opt-in", fieldIds, c.entrants);
    add(who.entrants.includes(playerId) || who.pending.includes(playerId), c.buyInCents);
  }

  return { games: count, cents };
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
  // Match play returns no scorecards, so a round of it would never look
  // finished on holes alone and its pots would never be reported. A match
  // round is done when every match in it is settled — the same reading
  // currentRoundIndex uses to decide which round a tournament is on.
  const matches = await prisma.match.findMany({
    where: { eventId },
    select: { stageId: true, holes: true, forfeitedBy: true },
  });

  const rounds: RoundMoneyRow[] = [];
  const outingTotals = new Map<string, number>();
  const fieldIds = (state?.confirmed ?? []).map((p) => p.id);
  let stakeGames = 0;
  let stakeCents = 0;

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

    const stageMatches = matches.filter((m) => m.stageId === stage.id);
    const matchesDone = stageMatches.length > 0 && stageMatches.every((m) => matchSettled(m));

    const final = roundMoneyIsFinal({
      holesReturned,
      holeCount,
      // Either measure can finish a round: every card in, every match
      // settled, or the organizer closing the tournament.
      roundComplete: matchesDone || state?.event.status === "completed",
    });

    // Nothing is computed for a round in progress. Not hidden after the fact —
    // not worked out at all, so there is no half-answer to leak.
    const nets = final ? (await gameNets(eventId, stage.id)).nets : [];

    // The other side of that rule: a round with no result yet is exactly the
    // round a player wants their exposure for. Stakes only — see `stakeFor`,
    // which reads membership and never touches a card.
    if (!final && me) {
      const s = await stakeFor(stage.id, me.id, fieldIds, stage.teeSheet ?? "");
      stakeGames += s.games;
      stakeCents += s.cents;
    }

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
    stake: { games: stakeGames, cents: stakeCents },
  };
}
