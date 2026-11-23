import "server-only";
import { prisma } from "@/lib/db";
import type { MoneyMode } from "@/lib/domain/money-mode";
import { moneyFor, playedOnceRoundIsOver } from "@/lib/services/expenses";
import { isPotEntryMode, potMembership } from "@/lib/domain/pot-entry";
import { isSkinsScope } from "@/lib/domain/skins-pot";
import { skinsPotFor, skinsSeasonFor } from "@/lib/services/skins-pot";
import type { PotStatus } from "@/lib/domain/pot-status";

/**
 * WHAT THE SETTLE HALF OF A TOURNAMENT'S MONEY READS (R8b): the season's skins table, the kitty's lines and the organizer's
 * ledger. ONE reader for both screens that can draw it (Prizes & payouts while Winners & money is not shown, Winners & money
 * when it is), so the two cannot read the money differently.
 *
 * FINAL ONLY, NEVER LIVE (`docs/claude/money.md`) is held where it always was, at the sinks this calls: `moneyFor` reads the
 * ledger through `gameNets`, which answers `[]` for a game that can still change, and `skinsSeasonFor` counts settled rounds.
 * Nothing here works out a figure of its own, so a screen written later cannot show an amount the sink would not.
 * TourneyHQ works money out and records it. It never moves it.
 */
export async function settleHalfFor(args: {
  eventId: string;
  email: string;
  name: string;
  isStaff: boolean;
  moneyMode: MoneyMode;
}) {
  const { eventId, email, name, isStaff, moneyMode } = args;
  const skinsSeason = await skinsSeasonFor(eventId);
  /**
   * The ledger for whoever is running it. Read with the organizer's own email, which is right even when they are not playing:
   * everything a treasurer needs (the standing, the transfers, the lines) is event-wide, and the "you" parts have nobody to match.
   */
  const ledger = moneyMode === "split" && isStaff ? await moneyFor(eventId, email, { name, isStaff }) : null;
  const fundLines =
    moneyMode === "float"
      ? await prisma.tournamentFund.findMany({ where: { eventId }, orderBy: { createdAt: "desc" } })
      : [];
  return { skinsSeason, ledger, fundLines };
}

/**
 * How far the field's contests and pots have got, as COUNTS (`pot-status.ts`): no amount is worked out, so it is safe to read
 * mid-round. The field's games only (an empty group key); a group's own games are drawn with their section.
 *
 * WHO IS IN IS ASKED OF THE FUNCTION THE CARDS ASK (`potMembership`, and `skinsPotFor`'s own entrants), never counted off the rows:
 * an opt-out contest has members with no row at all, a request to join is pending and not a stake, and a free contest has no
 * stake. Counting rows would contradict the card beside this line. A stake is counted only where the game has a buy-in.
 */
export async function potStatusFor(eventId: string): Promise<PotStatus> {
  const [players, contests, games, potRows] = await Promise.all([
    prisma.player.findMany({ where: { eventId }, select: { id: true, status: true } }),
    prisma.contest.findMany({ where: { eventId }, include: { entrants: true } }),
    prisma.sideGame.findMany({ where: { eventId, groupKey: "" }, include: { entrants: true } }),
    prisma.skinsPot.findMany({ where: { eventId, groupKey: "" }, select: { stageId: true, net: true, scope: true } }),
  ]);
  const fieldIds = players.filter((p) => p.status === "confirmed").map((p) => p.id);
  const stakeholderIds = players.map((p) => p.id);
  const playedOnceOver = await playedOnceRoundIsOver(eventId, [...contests, ...games]);
  const modeOf = (v: string) => (isPotEntryMode(v) ? v : "opt-in");
  let stakes = 0;
  let stakesPaid = 0;
  for (const g of [...contests, ...games]) {
    const m = potMembership(modeOf(g.entryMode), fieldIds, g.entrants, stakeholderIds, playedOnceOver(g.stageId));
    if (g.buyInCents > 0) {
      stakes += m.entrants.length + m.pending.length;
      stakesPaid += m.entrants.length;
    }
  }
  for (const row of potRows) {
    const view = await skinsPotFor(eventId, row.stageId, row.net, isSkinsScope(row.scope) ? row.scope : "full", "");
    if (view && view.buyInCents > 0) {
      stakes += view.entrantIds.length + view.pendingIds.length;
      stakesPaid += view.entrantIds.length;
    }
  }
  return {
    contests: contests.length,
    contestsWithWinner: contests.filter((c) => c.entrants.some((e) => e.won)).length,
    stakes,
    stakesPaid,
  };
}

export type SettleHalf =Awaited<ReturnType<typeof settleHalfFor>>;
