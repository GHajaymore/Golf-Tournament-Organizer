import "server-only";
import { prisma } from "../db";
import { clubCourses, type ClubCourse } from "./courses";
import { organizationAllows } from "./entitlements";

/**
 * WHAT THE COURSE LIBRARY NEEDS TO DRAW, for a club with or without an event open (R2).
 *
 * Tournament details computed this inline (`event/page.tsx`) and the club's own Courses screen needs
 * the same four answers, so they are read in ONE place: the club's courses, its home course, whether
 * its plan reads a photographed card, and which course a `?course=` link opens.
 *
 * `eventId` is REQUIRED and null means "no event is open": no course is then flagged as this event's
 * (`inEvent` is false for all). The card-reading entitlement is the CLUB's (`organizationAllows`), the
 * very answer `entitlementForEvent` gives for the club that owns the event, so the two screens agree.
 *
 * `requestedCourse` arrives off the query string and is checked against the club's own courses, never
 * trusted: opening an editor for a row that is not the club's would be the screen contradicting every
 * action behind it.
 */
export interface CourseLibraryData {
  courses: ClubCourse[];
  homeCourseId: string | null;
  cardScanAvailable: boolean;
  openCourseId: string | null;
}

export async function courseLibraryFor(
  organizationId: string,
  eventId: string | null,
  requestedCourse: string,
): Promise<CourseLibraryData> {
  const [courses, org, cardScanAvailable] = await Promise.all([
    clubCourses(organizationId, eventId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { defaultCourseId: true } }),
    organizationAllows(organizationId, "cardScan"),
  ]);
  return {
    courses,
    homeCourseId: org?.defaultCourseId ?? null,
    cardScanAvailable,
    openCourseId: courses.some((c) => c.id === requestedCourse) ? requestedCourse : null,
  };
}
