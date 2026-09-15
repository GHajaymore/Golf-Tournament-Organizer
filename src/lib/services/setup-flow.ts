import "server-only";
import { prisma } from "../db";
import { screenName } from "../nav";
import { setupFlow, roundIsScheduled, type SetupFlow, type SetupFacts } from "../domain/setup-flow";
import { isMatch } from "../tournament-shape";
import { generatesPairings } from "../stage-types";
import { roundLabel } from "../domain/round-label";
import { PRE_LAUNCH_STATUSES } from "../domain/lifecycle-state";
import { isMoneyMode } from "../domain/money-mode";

/**
 * The setup flow for one tournament, read once per screen.
 *
 * One query rather than four counts: the rail appears on every Set-up screen,
 * and a screen that already loads the whole event state should not pay for a
 * second round trip to draw a progress bar.
 *
 * Returns NULL for a match. Two people playing each other have no tournament
 * to set up — the match screen created the whole thing in one step — so
 * putting a progress rail over it would invent work that does not
 * exist. Answered from the event's shape, so it cannot drift from the sidebar,
 * which hides the same screens for the same reason.
 */
export async function setupFlowFor(eventId: string): Promise<SetupFlow | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      name: true,
      dates: true,
      course: true,
      shape: true,
      status: true,
      moneyMode: true,
      organizationId: true,
    },
  });
  if (!event) return null;
  if (isMatch(event.shape)) return null;

  const [confirmed, stageRows, groups, venues, org] = await Promise.all([
    prisma.player.count({ where: { eventId, status: "confirmed" } }),
    /**
     * THE ROUNDS THEMSELVES, not a count of them.
     *
     * Two steps now ask a question of each round — "when is it?" and, where
     * the scheduler draws them, "has it got fixtures?" — and neither can be
     * answered by a number. It was `select: { type: true }` and a separate
     * `match.count` across the whole event, which is how a round with no day
     * and no draw sat inside a step reading DONE. See `SetupRound`.
     *
     * Ordered, because `roundLabel` numbers a round by where it sits among
     * the others and an unordered list would number them by whatever the
     * database happened to return.
     */
    prisma.stage.findMany({
      where: { eventId },
      select: {
        id: true,
        type: true,
        playedOn: true,
        deadline: true,
        cutEnabled: true,
        _count: { select: { matches: true } },
      },
      orderBy: { position: "asc" },
    }),
    prisma.group.count({ where: { eventId } }),
    prisma.eventCourse.count({ where: { eventId } }),
    // The club's default, which the tournament inherits unless it says
    // otherwise. Read so the guide does not ask a question the club has
    // already answered — see `moneyAnswered`.
    prisma.organization.findUnique({
      where: { id: event.organizationId },
      select: { moneyMode: true },
    }),
  ]);
  const facts: SetupFacts = {
    confirmed,
    groups,
    rounds: stageRows.map((s) => ({
      // The whole list, so the number is the one every other screen shows —
      // see `round-number-source.test.ts` for what counting it here costs.
      label: roundLabel(stageRows, s.id),
      drawsPairings: generatesPairings(s.type),
      scheduled: roundIsScheduled(s.playedOn, s.deadline),
      cutFed: s.cutEnabled,
      matches: s._count.matches,
    })),
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
     * Answered here, or answered by the club and inherited.
     *
     * `isMoneyMode` rather than a truthiness test, for the reason the money
     * screens already give of a stored mode: it is free text in the database,
     * and a value nothing recognises is not an answer — it resolves through
     * the same fallback an empty string does. Treating it as one would tick
     * the step off on a typo.
     */
    moneyAnswered: isMoneyMode(event.moneyMode.trim()) || isMoneyMode((org?.moneyMode ?? "").trim()),
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
