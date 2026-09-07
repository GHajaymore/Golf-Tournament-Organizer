import "server-only";
import { prisma } from "../db";
import { screenName } from "../nav";
import { setupFlow, type SetupFlow, type SetupFacts } from "../domain/setup-flow";
import { isMatch } from "../tournament-shape";

/**
 * The setup flow for one tournament, read once per screen.
 *
 * One query rather than four counts: the rail appears on every Set-up screen,
 * and a screen that already loads the whole event state should not pay for a
 * second round trip to draw a progress bar.
 *
 * Returns NULL for a match. Two people playing each other have no tournament
 * to set up — the match screen created the whole thing in one step — so
 * putting a four-step progress rail over it would invent work that does not
 * exist. Answered from the event's shape, so it cannot drift from the sidebar,
 * which hides the same screens for the same reason.
 */
export async function setupFlowFor(eventId: string): Promise<SetupFlow | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { name: true, dates: true, course: true, shape: true },
  });
  if (!event) return null;
  if (isMatch(event.shape)) return null;

  const [confirmed, stages, groups, matches, venues] = await Promise.all([
    prisma.player.count({ where: { eventId, status: "confirmed" } }),
    prisma.stage.count({ where: { eventId } }),
    prisma.group.count({ where: { eventId } }),
    prisma.match.count({ where: { eventId } }),
    prisma.eventCourse.count({ where: { eventId } }),
  ]);

  const facts: SetupFacts = {
    confirmed,
    stages,
    groups,
    matches,
    /**
     * "New Tournament" is what `createEvent` falls back to when the name field
     * is submitted blank, so it is the one string that means "not named yet"
     * rather than a name somebody chose. Compared case-insensitively and
     * trimmed, because it is a placeholder being recognised, not a value being
     * validated.
     */
    named: !!event.name.trim() && event.name.trim().toLowerCase() !== "new tournament",
    dated: !!event.dates.trim(),
    // Either the event's own course or a venue attached to it. A tournament
    // that rotates venues names none on the event itself and is not therefore
    // venue-less.
    venued: !!event.course.trim() || venues > 0,
  };

  return setupFlow(facts, screenName);
}
