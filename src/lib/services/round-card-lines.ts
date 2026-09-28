import "server-only";
import { prisma } from "../db";
import { parseHoleArray } from "../courses";
import { roundCardStatus, type CardSource, type RoundCardStatus } from "../domain/round-card-status";
import { courseModeOf } from "../domain/venue";
import { isPlayingRound } from "../stage-types";
import { roundLabel } from "../domain/round-label";

/** One playing round's card, for Rounds & formats and for launch. */
export interface RoundCardLine {
  stageId: string;
  /** "Round 2", or the committee's own description when it gave one. */
  label: string;
  /** The course the card would come from, or "" when there is none. */
  course: string;
  status: RoundCardStatus;
}

/**
 * Every playing round's card status — see domain/round-card-status.ts.
 *
 * The facts are read the way score entry reads them — the round's own venue,
 * scoped to courses attached to THIS tournament; else the tournament's card,
 * its custom card or its sole venue — so launch cannot pass a round that entry
 * would then refuse, or refuse one entry would take.
 */
export async function roundCardLines(eventId: string): Promise<RoundCardLine[]> {
  const [event, stages, venues] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      select: {
        course: true, courseMode: true, customPars: true, customStrokeIndex: true,
        courseRef: { select: { name: true, pars: true, strokeIndex: true, source: true, verifiedAt: true } },
      },
    }),
    prisma.stage.findMany({
      where: { eventId },
      select: { id: true, type: true, position: true, format: true, scoringBasis: true, description: true, courseId: true },
      orderBy: { position: "asc" },
    }),
    prisma.course.findMany({
      where: { events: { some: { eventId } } },
      select: { id: true, name: true, pars: true, strokeIndex: true, source: true, verifiedAt: true },
    }),
  ]);
  if (!event) return [];

  const sourceOf = (c: { name: string; pars: string; strokeIndex: string; source: string; verifiedAt: Date | null }): CardSource => ({
    name: c.name,
    hasCard: parseHoleArray(c.pars) !== null && parseHoleArray(c.strokeIndex) !== null,
    unchecked: c.source === "imported" && c.verifiedAt === null,
  });
  const venueById = new Map(venues.map((v) => [v.id, sourceOf(v)]));
  const cardedVenues = [...venueById.values()].filter((v) => v.hasCard).length;

  // The tournament's own answer, in the order `fromEvent` walks it: the course
  // it points at, then a card typed onto it, then its only venue.
  const ref = event.courseRef ? sourceOf(event.courseRef) : null;
  const custom: CardSource | null =
    parseHoleArray(event.customPars) && parseHoleArray(event.customStrokeIndex)
      ? { name: event.course, hasCard: true, unchecked: false }
      : null;
  const sole = venues.length === 1 ? sourceOf(venues[0]) : null;
  const eventCard = ref?.hasCard ? ref : custom ?? (sole?.hasCard ? sole : ref ?? sole);

  const openCourse = courseModeOf(event.courseMode) === "open";
  return stages
    .filter((s) => isPlayingRound(s.type))
    .map((s) => {
      // A round naming a venue this tournament is not attached to names
      // nothing — the same scoping `roundCardFor` applies.
      const roundVenue = s.courseId ? venueById.get(s.courseId) ?? null : null;
      return {
        stageId: s.id,
        label: s.description.trim() || roundLabel(stages, s.id),
        course: (roundVenue ?? eventCard)?.name ?? "",
        status: roundCardStatus({ round: s, roundVenue, eventCard, cardedVenues, openCourse }),
      };
    });
}

/** The rounds that stop a launch — see `missingCardsRefusal`. */
export async function roundsMissingCards(eventId: string): Promise<{ label: string; course: string }[]> {
  return (await roundCardLines(eventId)).filter((l) => l.status === "missing").map(({ label, course }) => ({ label, course }));
}
