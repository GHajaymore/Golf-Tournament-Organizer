import "server-only";
import { prisma } from "@/lib/db";
import type { MoneyMode } from "@/lib/domain/money-mode";
import { moneyFor } from "@/lib/services/expenses";
import { skinsSeasonFor } from "@/lib/services/skins-pot";
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
 * How far the field's contests and pots have got, as COUNTS OF STORED ROWS (`pot-status.ts`): no amount is worked out, so it is
 * safe to read mid-round. The field's games only (an empty group key); a group's own games are drawn with their section.
 */
export async function potStatusFor(eventId: string): Promise<PotStatus> {
  const [contests, wonContests, contestStakes, contestPaid, gameStakes, gamePaid, skinStakes, skinPaid] = await Promise.all([
    prisma.contest.count({ where: { eventId } }),
    prisma.contest.count({ where: { eventId, entrants: { some: { won: true } } } }),
    prisma.contestEntry.count({ where: { contest: { eventId }, excluded: false } }),
    prisma.contestEntry.count({ where: { contest: { eventId }, excluded: false, confirmed: true } }),
    prisma.sideGameEntry.count({ where: { sideGame: { eventId, groupKey: "" }, excluded: false } }),
    prisma.sideGameEntry.count({ where: { sideGame: { eventId, groupKey: "" }, excluded: false, confirmed: true } }),
    prisma.skinsEntry.count({ where: { pot: { eventId, groupKey: "" } } }),
    prisma.skinsEntry.count({ where: { pot: { eventId, groupKey: "" }, confirmed: true } }),
  ]);
  return {
    contests,
    contestsWithWinner: wonContests,
    stakes: contestStakes + gameStakes + skinStakes,
    stakesPaid: contestPaid + gamePaid + skinPaid,
  };
}

export type SettleHalf =Awaited<ReturnType<typeof settleHalfFor>>;
