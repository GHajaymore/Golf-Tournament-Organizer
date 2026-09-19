import "server-only";
import { prisma } from "../db";
import { resolveCourse, hasCourseData } from "../courses";
import { courseForRound, applyNine, cleanNine } from "./course-resolution";
import type { EventState } from "./tournament";

/**
 * The course card ONE ROUND is played on, narrowed to the nine actually
 * played — for the player's screens.
 *
 * It lived inline in the card page. Today now draws the same round as a row of
 * hand-hung tiles, marked under and over par, and a second copy of this is how
 * the tiles would one day ring a birdie the card calls a par. So both read it
 * here.
 *
 * `known` is false when neither the round nor the tournament has a real card
 * — the pars returned are then placeholders, and a caller must not mark a
 * score against them.
 *
 * The venue lookup is scoped to courses attached to THIS event, so a stage
 * pointing at another club's course id resolves to nothing rather than to it.
 */
export async function roundCardFor(
  state: EventState,
  stage: { courseId?: string | null; nine?: string | null } | null,
  holes: number,
) {
  const venue = stage?.courseId
    ? await prisma.course.findFirst({ where: { id: stage.courseId, events: { some: { eventId: state.event.id } } } })
    : null;
  const resolved = courseForRound(venue, state.event);
  const known = !!resolved || hasCourseData(state.event);
  const card = resolved ? applyNine(resolved, cleanNine(stage?.nine), holes) : resolveCourse(state.event);
  return { venue, known, card };
}
