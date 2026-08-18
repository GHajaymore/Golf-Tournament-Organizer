import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { moneyFor, roundMoneyFor } from "@/lib/services/expenses";
import { MoneyClient } from "@/components/MoneyClient";
import { RoundMoney } from "@/components/RoundMoney";
import { prisma } from "@/lib/db";
import { resolveMoneyMode } from "@/lib/domain/money-mode";

/**
 * The player's money.
 *
 * Two things, in the order a player asks for them: what the pots paid, round
 * by round with the outing underneath — and then, only where the tournament
 * shares costs, what everybody owes.
 *
 * The pots come first for every kind of organization, because that is what a
 * player played for. The ledger is the part that depends on who is running the
 * golf: at a club the shop takes the entry fee and pays the winner, and a
 * settle-up there would invite a member to think the club owes them for the
 * buggy. See money-mode and org-profile.
 */
export default async function MoneyPage() {
  const session = await requireSession();

  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: {
      moneyMode: true,
      organization: { select: { moneyMode: true, kind: true, currencySymbol: true } },
    },
  });
  if (!event) redirect("/me");

  const mode = resolveMoneyMode({
    eventMode: event.moneyMode,
    orgMode: event.organization?.moneyMode,
    orgKind: event.organization?.kind,
  });
  // `none` means the money is handled outside the app entirely — the tab is
  // hidden for it, and anyone arriving by URL is sent back rather than shown
  // an empty screen that implies something is missing.
  if (mode === "none") redirect("/me");

  const currency = event.organization?.currencySymbol || "$";

  const rounds = await roundMoneyFor(session.eventId, session.email);

  /**
   * The split ledger, whenever the tournament is on split. The MODE decides,
   * and nothing else.
   *
   * This also asked `layout.ledger`, which is the default for the kind of
   * outfit — and the kind has already had its say, as the fallback inside
   * resolveMoneyMode. Asking twice meant a club that deliberately set one
   * tournament to split got the tab (usesExpenses reads the mode) and then no
   * ledger on it: the override honoured in one place and overruled in the
   * other, which is worse than not offering it. A club running one society
   * day a year is exactly who needs this.
   */
  const ledger = mode === "split" ? await moneyFor(session.eventId, session.email) : null;
  if (!rounds.playerId && !ledger?.used) redirect("/me");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <RoundMoney view={rounds} currency={currency} />
      {ledger && <MoneyClient view={ledger} />}
    </div>
  );
}
