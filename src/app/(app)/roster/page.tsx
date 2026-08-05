import { requireScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadRoster, organizationIdForEvent } from "@/lib/services/roster";
import { RosterClient } from "@/components/RosterClient";

// /roster used to be the per-event player list, which now lives inside
// Registration & field. The path now means what it says: the club's standing
// member roster, which every tournament draws from.
export default async function RosterPage() {
  const session = await requireScreen("roster");

  const organizationId = await organizationIdForEvent(session.eventId);
  if (!organizationId) redirect("/dashboard");

  const [org, members, event] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, shortName: true, kind: true },
    }),
    loadRoster(organizationId),
    prisma.event.findUnique({
      where: { id: session.eventId },
      select: { name: true, status: true, configUnlocked: true },
    }),
  ]);
  if (!org || !event) redirect("/dashboard");

  // Who's already in the current field, so the roster shows it inline and
  // "add to this tournament" can never create a duplicate entry.
  const entered = await prisma.player.findMany({
    where: { eventId: session.eventId },
    select: { memberId: true, email: true },
  });
  const enteredIds = new Set(entered.map((p) => p.memberId).filter(Boolean) as string[]);
  const enteredEmails = new Set(entered.map((p) => p.email.trim().toLowerCase()).filter(Boolean));

  return (
    <RosterClient
      clubName={org.shortName || org.name}
      isClub={org.kind === "club"}
      eventName={event.name}
      fieldLocked={(event.status === "live" || event.status === "completed") && !event.configUnlocked}
      members={members.map((m) => ({
        ...m,
        entered: enteredIds.has(m.id) || (!!m.email && enteredEmails.has(m.email.toLowerCase())),
      }))}
    />
  );
}
