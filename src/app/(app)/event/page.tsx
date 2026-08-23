import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { PlaySettings } from "@/components/PlaySettings";
import { CourseLibrary } from "@/components/CourseLibrary";
import { clubCourses } from "@/lib/services/courses";
import { accessibleEvents } from "@/lib/services/access";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { EventSetupClient } from "@/components/EventSetupClient";
import { EventSwitcher } from "@/components/EventSwitcher";
import { SetupLockBanner } from "@/components/SetupLockBanner";
import { SetupChecklist } from "@/components/SetupChecklist";
import { setupChecklist, clubBrandingState } from "@/lib/services/checklist";
import { entitlementForEvent } from "@/lib/services/entitlements";


export default async function EventPage({
  searchParams,
}: {
  /**
   * `?course=<id>` opens that course's card editor.
   *
   * Score entry links here when the round's venue has no card, or when
   * somebody reading the card below spots something wrong. There is one card
   * editor in this app; the alternative to deep-linking it was growing a
   * second one on the entry screen, which is how the event's own card came to
   * disagree with its venue's.
   */
  searchParams: Promise<{ course?: string }>;
}) {
  const session = await requireScreen("event");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const e = state.event;
  const locked = isSetupLocked(state.event);
  // The club's own courses. The setup picker used to read a bundled list of
  // four invented layouts, so it offered courses nobody plays and scored
  // against cards that do not exist.
  const courses = await clubCourses(e.organizationId, e.id);
  const org = await prisma.organization.findUnique({
    where: { id: e.organizationId },
    select: { defaultCourseId: true, logoUrl: true, themeKey: true, themeHex: true },
  });
  const homeCourseId = org?.defaultCourseId ?? null;

  // Checked against the club's own courses rather than trusted: this arrives
  // off the query string, and opening an editor for a row that is not theirs
  // would be the screen contradicting every action behind it.
  const requestedCourse = (await searchParams).course ?? "";
  const openCourseId = courses.some((c) => c.id === requestedCourse) ? requestedCourse : null;

  // Access is per-event *or* inherited from running the organization, so this
  // reads the same list the switch action authorizes against — checking
  // Account rows alone hid a club admin's own tournaments from them.
  //
  // The access list is also the *only* source of events shown. This used to be
  // an unscoped findMany over every organization's tournaments: any signed-in
  // user saw every club's event names, dates, venues and field sizes, and the
  // switcher offered rows the actions then refused — which is how "why can't I
  // delete this tournament?" turned out to mean "why can I see it at all?".
  const accessible = new Map((await accessibleEvents(session.email)).map((a) => [a.eventId, a.role]));
  const allEvents = await prisma.event.findMany({
    where: { id: { in: [...accessible.keys()] } },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { players: true } } },
  });
  const eventRows = allEvents.map((ev) => ({
    id: ev.id,
    name: ev.name,
    status: ev.status,
    dates: ev.dates,
    course: ev.course,
    players: ev._count.players,
    isActive: ev.id === session.eventId,
    hasAccess: accessible.has(ev.id),
    // Copying and deleting are organizer acts — a copy is created inside this
    // tournament's organization, so offering either to a player would show
    // controls the actions reject anyway.
    isOrganizer: accessible.get(ev.id) === "admin",
  }));

  const checklist = setupChecklist({ ...state, branding: clubBrandingState(org) });

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Tournament details</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Manage your tournaments, or configure the one you're running.
        </p>
      </div>

      <EventSwitcher events={eventRows} />

      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />

      <div style={{ marginBottom: 16 }}>
        <SetupChecklist items={checklist} />
      </div>

      <EventSetupClient
        key={e.id}
        initial={{
          name: e.name, dates: e.dates, format: e.format, course: e.course, city: e.city,
          address: e.address, regDeadline: e.regDeadline, capacity: e.capacity,
          playerCountMode: e.playerCountMode, manualPlayerCount: e.manualPlayerCount,
          courseMode: e.courseMode, sideStyle: e.sideStyle,
        }}
        playersCount={state.confirmed.length}
        courses={courses.map((c) => ({ name: c.name, city: c.city, address: "" }))}
      />

      {/* Always available, never a blocker here. A tournament may not need
          course data to score — gross match play doesn't — and still want it,
          because printed scorecards carry par, yardage and stroke index next
          to the club's logo. */}
      <div style={{ marginTop: 16 }}>
        <CourseLibrary
          courses={courses}
          canEdit={session.viewRole === "admin"}
          // Resolved here rather than in the component: a locked feature has
          // to be visible before somebody photographs a card and uploads it.
          cardScanAvailable={(await entitlementForEvent(session.eventId, "cardScan")).allowed}
          homeCourse={homeCourseId}
          // Checked against the club's own courses rather than trusted: this
          // arrives off the query string, and opening an editor for a row that
          // is not theirs would be the screen contradicting every action
          // behind it.
          openCourseId={openCourseId}
        />
      </div>

      {/* The event-level "Course card" section used to sit here, and it was
          the same job done twice on one screen — worse, done twice into two
          different places. It wrote the card onto the EVENT
          (`customPars`/`customStrokeIndex`); the Courses section above writes
          it onto the venue. `courseForRound` prefers the venue, so an
          organizer who typed a card here on a tournament that already had a
          venue watched it be silently ignored.
          Nothing is lost: Courses above can look a course up, add one, or
          paste a card, and every one of those produces a real venue with tees
          and a verification state, which the event card never had. */}

      <div style={{ marginTop: 16 }}>
        <PlaySettings
          mode="tournament"
          settings={settingsOf(e)}
          canEdit={session.viewRole === "admin"}
          shareToken={e.shareToken}
          rounds={state.stages.map((s, i) => ({
            stageId: s.id,
            label: `Round ${i + 1} · ${s.type}`,
            code: s.accessCode,
          }))}
        />
      </div>
    </>
  );
}
