import Link from "next/link";
import { redirect } from "next/navigation";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireOrgScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { screenName } from "@/lib/nav";
import { orgProfile } from "@/lib/domain/org-profile";
import { cameFromPath } from "@/lib/domain/came-from";
import { COURSE_KEEPER_WORDS } from "@/lib/domain/course-words";
import { screensShownFor } from "@/lib/services/screens-shown";
import { courseLibraryFor } from "@/lib/services/course-library-view";
import { organizationAccessFor } from "@/lib/services/org-access";
import { CourseLibrary } from "@/components/CourseLibrary";

/**
 * THE CLUB'S COURSES: the library, its cards and its tees (R2, the redesign's Club → Courses).
 *
 * Drawn only while its screen is shown (`screensShownFor`, `?stepper=1&build=1` today and never in
 * production); otherwise the address sends a person to where the library has always been, Tournament
 * details, so the address is harmless while the redesign is switched off.
 *
 * It needs a club, not a tournament (`requireOrgScreen`, held to the Event screen's rule): a secretary
 * with no event yet keeps the club's courses here, which `requireCourseKeeper` allows. It picks no
 * event's course (`eventPick` is false); that is Event's job.
 *
 * The browser-tab title is the menu's word for the door (`nav-lifecycle.ts`, "Courses"): `nav.ts`
 * holds no row for a screen that is not in the menu yet.
 */
export const generateMetadata = () => ({ ...screenMetadata("/courses"), title: "Courses" });

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; from?: string }>;
}) {
  const { session, organizationId } = await requireOrgScreen("event");
  const shown = await screensShownFor(session);
  if (!shown.has("courses")) redirect("/event#courses");

  const params = await searchParams;
  const eventId = session.eventId || null;
  const [library, access, org] = await Promise.all([
    courseLibraryFor(organizationId, eventId, params.course ?? ""),
    // The very question the course actions ask (`requireCourseKeeper`), so a control is drawn only
    // for somebody the press would not refuse.
    organizationAccessFor(session.email, organizationId, session.role),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { kind: true, country: true, communityNoun: true } }),
  ]);
  const section = orgProfile(org?.kind, org?.country, org?.communityNoun).groupLabel;

  // Where this person was sent from: a screen of the console named by its own address, never a URL
  // taken from the link. A screen with no name in the menu draws no way back.
  const back = cameFromPath(params.from, "/courses");
  const backName = back ? screenName(back) : null;

  return (
    <>
      <p className="page-kicker">{section}</p>
      <h1 className="page-title">Courses</h1>
      {back && backName && backName !== back && (
        <p style={{ margin: "0 0 12px" }}>
          <Link href={back} className="btn btn-ghost">
            Back to {backName}
          </Link>
        </p>
      )}
      {!access.canEdit && (
        <p className="text-muted" role="status" style={{ fontSize: 14, margin: "0 0 12px" }}>
          {COURSE_KEEPER_WORDS} You can look at the courses, their cards and their tees.
        </p>
      )}
      <CourseLibrary
        courses={library.courses}
        canEdit={access.canEdit}
        cardScanAvailable={library.cardScanAvailable}
        homeCourse={library.homeCourseId}
        openCourseId={library.openCourseId}
        eventPick={false}
      />
    </>
  );
}
