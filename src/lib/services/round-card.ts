import "server-only";
import { prisma } from "../db";
import { resolveCourse, hasCourseData } from "../courses";
import { courseForRound, applyNine, cleanNine } from "./course-resolution";
import type { EventState } from "./tournament";
import { resolveDistanceUnit, type DistanceUnit } from "../domain/distance-unit";

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
  /**
   * NARROWED EITHER WAY. The fallback — a tournament's own hand-entered card,
   * with no course row — used to be handed on whole, so a nine-hole round read
   * its first nine pars whatever nine it was played on, and the stroke dots
   * came off an eighteen-hole index sliced to nine (1,3,5,…,17) — the fault
   * `cardForStage` exists to prevent, and which every other reader of a round's
   * card already avoids by narrowing both paths (2026-09-29).
   */
  const card = applyNine(resolved ?? resolveCourse(state.event), cleanNine(stage?.nine), holes);
  const unit = await distanceUnitFor(resolved, state.event.organizationId);
  return { venue, known, card, unit };
}

/**
 * What a resolved card's distances are in — its course row's own unit, else
 * the rule in domain/distance-unit.ts, reading the club's country.
 *
 * Takes the RESOLVED card, which carries the chosen row's unit and provenance,
 * so every screen asks the walk that already chose the card rather than walking
 * round → tournament → venue a second time. `null` (no card) answers for the
 * club.
 */
export async function distanceUnitFor(
  resolved: { distanceUnit?: string; sourceUrl?: string } | null | undefined,
  organizationId: string,
): Promise<DistanceUnit> {
  const club = await prisma.organization.findUnique({ where: { id: organizationId }, select: { country: true } });
  return resolveDistanceUnit({
    stored: resolved?.distanceUnit,
    sourceUrl: resolved?.sourceUrl,
    country: club?.country,
  });
}
