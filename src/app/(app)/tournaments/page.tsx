import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { accessibleEvents } from "@/lib/services/access";
import { organizationsForOrganizer } from "@/lib/services/organization";
import { EventSwitcher } from "@/components/EventSwitcher";
import { isMatch } from "@/lib/tournament-shape";

export const metadata = screenMetadata("/tournaments");

/**
 * Every tournament this person can reach, and the acts that are about the SET
 * of them rather than about any one.
 *
 * It lived on `/event` — 440px of a 6,330px screen whose other 83% configures
 * the ONE tournament currently open, under a heading reading "Tournament
 * details" and a subtitle admitting the split: "Manage your tournaments, or
 * configure the one you're running."
 *
 * It was there because it had to be somewhere. `EventContextBar` is on every
 * authenticated screen and its "Switch event" link needed a destination, and
 * there was no route for one. So the screen named for configuring a
 * tournament also carried creating, copying, deleting and switching between
 * them — which are club-level acts, about the set.
 *
 * WHICH IS WHY IT SITS IN THE "CLUB" GROUP, whose own comment already drew
 * this line: "Club-level, shared by every tournament this organization runs —
 * as opposed to 'Set up', which only describes the event currently open." The
 * group was right; the switcher was on the wrong side of it.
 *
 * NOT MERGED WITH `/choose`, deliberately. That screen answers "which
 * tournament do I enter?" from outside the app shell, before there is an
 * active event, and its rows carry the things that question needs: your role,
 * and whether you reach a tournament through the organization rather than by
 * name. This one answers "what am I running?" and carries status and the
 * organizer's actions. Sharing a row renderer would make each carry the
 * other's concerns — and the "Start from" dropdown in
 * `CreateFirstTournament` records what happens when two screens answer one
 * question separately: seventeen options for eleven starting points.
 */
export default async function TournamentsPage() {
  const session = await requireScreen("tournaments");

  /**
   * Both answers this screen needs, together.
   *
   * `accessibleEvents` has to land before the event query can be scoped by
   * it, so this is two waves rather than one — the same shape `/event` uses,
   * and for the same reason.
   */
  const [accessList, organizations] = await Promise.all([
    accessibleEvents(session.email),
    organizationsForOrganizer(session.email),
  ]);

  /**
   * THE ACCESS LIST IS THE ONLY SOURCE OF WHAT APPEARS.
   *
   * Carried over from `/event` with the reasoning intact, because it is the
   * half of this screen that matters most. This used to be an unscoped
   * `findMany` over every organization's tournaments: any signed-in user saw
   * every club's event names, dates, venues and field sizes, and the switcher
   * offered rows the actions then refused — which is how "why can't I delete
   * this tournament?" turned out to mean "why can I see it at all?".
   */
  const allEvents = await prisma.event.findMany({
    where: { id: { in: accessList.map((a) => a.eventId) } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { players: true } },
      // The venues, for a tournament that names its course only as one — the
      // dashboard header's fallback, so the list and the header agree.
      courses: { select: { course: { select: { name: true } } } },
    },
  });
  const accessible = new Map(accessList.map((a) => [a.eventId, a.role]));

  const events = allEvents.map((ev) => ({
    id: ev.id,
    name: ev.name,
    status: ev.status,
    dates: ev.dates,
    course: ev.course || ev.courses.map((c) => c.course.name).join(" · "),
    players: ev._count.players,
    isActive: ev.id === session.eventId,
    hasAccess: accessible.has(ev.id),
    // Copying and deleting are organizer acts — a copy is created inside this
    // tournament's organization, so offering either to a player would show
    // controls the actions reject anyway.
    isOrganizer: accessible.get(ev.id) === "admin",
    /**
     * A quick round rather than a tournament.
     *
     * Read through `isMatch` rather than compared here, for the reason this
     * codebase keeps relearning: two copies of one rule is how one of them
     * ends up wrong. The switcher listed these as tournaments, counted them in
     * "N total", and offered them in "Start from" as something to build a
     * championship out of.
     */
    isCasual: isMatch(ev.shape),
  }));

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Club</div>
        <h1 className="page-title">Tournaments</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Every tournament you can reach. Switch between them, start a new one, or copy one you
          have run before.
        </p>
      </div>
      <EventSwitcher events={events} organizations={organizations} />
    </>
  );
}
