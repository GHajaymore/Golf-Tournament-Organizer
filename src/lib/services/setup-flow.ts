import "server-only";
import { prisma } from "../db";
import { screenName } from "../nav";
import { setupFlow, type SetupFlow, type SetupFacts } from "../domain/setup-flow";
import { isMatch } from "../tournament-shape";
import { generatesPairings } from "../stage-types";
import { PRE_LAUNCH_STATUSES } from "../domain/lifecycle-state";

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
    select: { name: true, dates: true, course: true, shape: true, status: true },
  });
  if (!event) return null;
  if (isMatch(event.shape)) return null;

  const [confirmed, stageRows, groups, matches, venues] = await Promise.all([
    prisma.player.count({ where: { eventId, status: "confirmed" } }),
    // The TYPES, not just how many. The last step of setup asks for fixtures,
    // and only some kinds of round have any — see `drawsPairings`.
    prisma.stage.findMany({ where: { eventId }, select: { type: true } }),
    prisma.group.count({ where: { eventId } }),
    prisma.match.count({ where: { eventId } }),
    prisma.eventCourse.count({ where: { eventId } }),
  ]);
  const stages = stageRows.length;

  const facts: SetupFacts = {
    confirmed,
    stages,
    groups,
    matches,
    drawsPairings: stageRows.some((s) => generatesPairings(s.type)),
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
    /**
     * Launched, read through the same list `lifecycleMismatch` uses rather
     * than by comparing to "live" here.
     *
     * That list is the definition of "the field can see this" — draft,
     * registration and ready all mean they cannot — and writing a second
     * version of it is how the guide would come to disagree with the warning
     * that fires a day later about the very same thing.
     */
    launched: !PRE_LAUNCH_STATUSES.includes(event.status),
  };

  return setupFlow(facts, screenName);
}
