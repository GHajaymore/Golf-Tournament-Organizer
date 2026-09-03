import { requireScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadRoster, organizationIdForEvent } from "@/lib/services/roster";
import { RosterClient } from "@/components/RosterClient";
import { unlinkedPlayers, memberEntryFor, fieldSizeOf } from "@/lib/domain/roster-link";

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
  /**
   * Where each member stands, and whether they may be added again.
   *
   * Both decided in the domain — see `memberEntryFor`, which explains why "is
   * there a Player row" was the wrong question for three of the four statuses.
   */

  // The other half of the count. Without it the card reports how many MEMBERS
  // are playing while reading as how many PEOPLE are — which is how a club
  // with 32 confirmed entries and an empty roster saw "0 entered in the open
  // tournament" on one screen and "32 confirmed" on the next.
  // The same subset the count above uses, because the caption subtracts one
  // from the other — "N more in the field aren't on the roster yet". Measuring
  // the two against different populations makes that sentence arithmetic
  // nobody can reproduce.
  const unlinked = unlinkedPlayers(
    entered.filter((p) => p.status === "confirmed"),
    members.map((m) => ({ id: m.id, email: m.email })),
  );

  return (
    <RosterClient
      clubName={org.shortName || org.name}
      orgKind={org.kind}
      eventName={event.name}
      fieldLocked={(event.status === "live" || event.status === "completed") && !event.configUnlocked}
      fieldSize={fieldSizeOf(entered)}
      unlinkedCount={unlinked.length}
      members={members.map((m) => {
        const entry = memberEntryFor(m, entered);
        return { ...m, entered: entry.live, entryStatus: entry.status };
      })}
    />
  );
}
