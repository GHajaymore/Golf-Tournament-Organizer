import { requireScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadRoster, organizationIdForEvent } from "@/lib/services/roster";
import { RosterClient } from "@/components/RosterClient";
import { unlinkedPlayers } from "@/lib/domain/roster-link";

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
    select: { id: true, name: true, memberId: true, email: true, status: true },
  });
  const enteredIds = new Set(entered.map((p) => p.memberId).filter(Boolean) as string[]);
  const enteredEmails = new Set(entered.map((p) => p.email.trim().toLowerCase()).filter(Boolean));

  /**
   * In the field, waiting for a place in it, or not entered at all.
   *
   * `entered` is every Player row whatever its status, so a WAITLISTED member
   * was tagged "in field" on this screen. They are not in it, and the person
   * who most needs to know that is the organizer standing on this page working
   * out who else to add. It stays invisible until a club fills a tournament,
   * which is precisely the moment it starts mattering.
   */
  const waitlisted = entered.filter((p) => p.status === "waitlisted");
  const waitlistedIds = new Set(waitlisted.map((p) => p.memberId).filter(Boolean) as string[]);
  const waitlistedEmails = new Set(
    waitlisted.map((p) => p.email.trim().toLowerCase()).filter(Boolean),
  );
  const entryStatusOf = (m: { id: string; email: string }): "in" | "waitlisted" | "out" => {
    const email = m.email.trim().toLowerCase();
    if (waitlistedIds.has(m.id) || (email && waitlistedEmails.has(email))) return "waitlisted";
    if (enteredIds.has(m.id) || (email && enteredEmails.has(email))) return "in";
    return "out";
  };

  // The other half of the count. Without it the card reports how many MEMBERS
  // are playing while reading as how many PEOPLE are — which is how a club
  // with 32 confirmed entries and an empty roster saw "0 entered in the open
  // tournament" on one screen and "32 confirmed" on the next.
  const unlinked = unlinkedPlayers(entered, members.map((m) => ({ id: m.id, email: m.email })));

  return (
    <RosterClient
      clubName={org.shortName || org.name}
      orgKind={org.kind}
      eventName={event.name}
      fieldLocked={(event.status === "live" || event.status === "completed") && !event.configUnlocked}
      fieldSize={entered.length}
      unlinkedCount={unlinked.length}
      members={members.map((m) => ({
        ...m,
        entered: enteredIds.has(m.id) || (!!m.email && enteredEmails.has(m.email.toLowerCase())),
        entryStatus: entryStatusOf(m),
      }))}
    />
  );
}
