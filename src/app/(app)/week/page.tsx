import { requireScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { weekViewFor } from "@/lib/services/week-view";
import { WeekClient } from "@/components/WeekClient";

/**
 * The weekly league screen: results, standings and skins for one night.
 *
 * Deliberately read-only. Everything here is entered somewhere it belongs —
 * scores on Score entry, the pot on Prizes & payouts — and a screen that both
 * reports the week and edits it would give a member with a read-only role a
 * door that bounces them, or worse, a captain a control they should not have.
 */
export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string }>;
}) {
  const session = await requireScreen("week");
  const params = await searchParams;

  const view = await weekViewFor(session.eventId, params.round);
  if (!view) redirect("/dashboard");

  return (
    <WeekClient
      view={view}
      canManageMoney={session.viewRole === "admin" || session.viewRole === "assistant"}
    />
  );
}
