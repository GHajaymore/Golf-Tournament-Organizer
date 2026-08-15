import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { moneyFor } from "@/lib/services/expenses";
import { MoneyClient } from "@/components/MoneyClient";

/**
 * The outing's money.
 *
 * One ledger for the whole tournament — expenses and side games together —
 * because the point of building this rather than pointing people at Splitwise
 * is that it can answer with a single number. What varies is who shares each
 * LINE, not who settles with whom at the end.
 */
export default async function MoneyPage() {
  const session = await requireSession();
  const view = await moneyFor(session.eventId, session.email);
  if (!view.playerId && !view.used) redirect("/me");

  return <MoneyClient view={view} />;
}
