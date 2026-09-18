import { configurationLocked } from "@/lib/domain/lifecycle-state";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireOrgScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadRoster } from "@/lib/services/roster";
import { handicapReadable } from "@/lib/services/integrations";
import { RosterClient } from "@/components/RosterClient";
import { unlinkedPlayers, memberEntryFor, fieldSizeOf } from "@/lib/domain/roster-link";

// /roster used to be the per-event player list, which now lives inside
// Registration & field. The path now means what it says: the club's standing
// member roster, which every tournament draws from.
export const metadata = screenMetadata("/roster");

/**
 * THE MEMBER LIST OUTLIVES ANY ONE TOURNAMENT, SO IT NO LONGER NEEDS ONE.
 *
 * This screen resolved its organization through `organizationIdForEvent`, so a
 * club with no tournament yet could not open its own roster — and "Add your
 * members" on the setup checklist said so out loud: "Opens once you have a
 * tournament — your society's own screens live inside one."
 *
 * That made the club's one-time setup depend on the tournament it is supposed
 * to precede, which is the relationship upside down. It is also why the
 * club-first gate could not ask for members: requiring a screen that cannot
 * open is a deadlock dressed as a checklist.
 *
 * `requireOrgScreen` is the same door `/organization` uses — it prefers the
 * open tournament's club so nothing changes for an organizer who has one, and
 * falls back to the club this person actually owns or administers when there
 * is none. Membership of that club IS the authorization, which is narrower
 * than the role check, not looser.
 *
 * WHAT IS ABSENT WITHOUT A TOURNAMENT is the half of this screen that talks
 * about one: the field count, the entry filter, "add these to the tournament".
 * Those are passed as an empty `eventName` rather than removed, and the client
 * hides them — see the prop. The roster itself, which is the reason somebody
 * came here before their first tournament, is all there.
 */
export default async function RosterPage() {
  const { session, organizationId } = await requireOrgScreen("roster");

  const [org, members, event] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      // `handicapPolicy` comes too: this screen shows indexes, and whether a
      // blank one is an unfinished row or an ordinary club-handicap member is
      // a question only the policy answers.
      select: { name: true, shortName: true, kind: true, handicapPolicy: true },
    }),
    loadRoster(organizationId),
    session.eventId
      ? prisma.event.findUnique({
          where: { id: session.eventId },
          select: { name: true, status: true, configUnlocked: true },
        })
      : null,
  ]);
  if (!org) redirect("/dashboard");

  // Who's already in the current field, so the roster shows it inline and
  // "add to this tournament" can never create a duplicate entry. Nobody is,
  // when there is no tournament — and every count below falls out of that
  // rather than being special-cased.
  const entered = event
    ? await prisma.player.findMany({
        where: { eventId: session.eventId },
        select: { id: true, name: true, memberId: true, email: true, status: true },
      })
    : [];
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

  /**
   * The same "locked" the roster ACTION enforces, from the same function.
   *
   * This screen and `addMembersToEvent` each spelled out `live-or-completed
   * and not unlocked` by hand, which is a screen and the server it calls
   * holding separate copies of one rule — and a screen offering a control the
   * server refuses is a bug report filed against the wrong thing.
   */
  const fieldLocked = !!event && configurationLocked(event);

  return (
    <RosterClient
      clubName={org.shortName || org.name}
      /**
       * WHETHER THIS CLUB CAN READ INDEXES AT ALL.
       *
       * `handicapReadable` was written for exactly this screen — its comment
       * says so — and nothing called it until now, which is why a club on GHIN
       * with no working integration could sit a whole season with every member
       * at zero and nothing on any screen saying why.
       *
       * Asked only when the policy actually depends on an association: a club
       * keeping its own handicaps has nothing to fetch and must not be shown a
       * warning about a service it does not use.
       */
      handicapPolicy={org.handicapPolicy}
      indexesReadable={org.handicapPolicy === "club" ? true : await handicapReadable(organizationId)}
      eventName={event?.name ?? ""}
      fieldLocked={fieldLocked}
      fieldSize={fieldSizeOf(entered)}
      unlinkedCount={unlinked.length}
      members={members.map((m) => {
        const entry = memberEntryFor(m, entered);
        return { ...m, entered: entry.live, entryStatus: entry.status };
      })}
    />
  );
}
