import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { organizationsForOrganizer } from "@/lib/services/organization";
import { roundLabelWith } from "@/lib/domain/round-label";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { hasKnockoutStage } from "@/lib/stage-types";
import { enteredCardCount } from "@/lib/services/round-cards";
import { PlaySettings } from "@/components/PlaySettings";
import { teesForEvent } from "@/lib/services/handicaps";
import { CourseLibrary } from "@/components/CourseLibrary";
import { clubCourses } from "@/lib/services/courses";
import { accessibleEvents } from "@/lib/services/access";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { EventSetupClient } from "@/components/EventSetupClient";
import { EventSwitcher } from "@/components/EventSwitcher";
import { SetupLockBanner } from "@/components/SetupLockBanner";
import { SetupFlowRail, SetupFlowFooter } from "@/components/SetupFlowRail";
import { setupFlowFor } from "@/lib/services/setup-flow";
import { railSpeaks } from "@/lib/domain/setup-flow";
import { SetupChecklist } from "@/components/SetupChecklist";
import { SettingsNav, SettingsSectionAnchor, type SettingsSection } from "@/components/SettingsNav";
import { setupChecklist, clubBrandingState } from "@/lib/services/checklist";
import { isMatch } from "@/lib/tournament-shape";
import { entitlementForEvent } from "@/lib/services/entitlements";


export const metadata = screenMetadata("/event");

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

  /**
   * EVERYTHING THIS SCREEN NEEDS THAT ONLY NEEDS THE SESSION, AT ONCE.
   *
   * This page made TWELVE round-trips one after another, four of them from
   * inside the JSX — `organizationsForOrganizer` twice, `enteredCardCount`
   * and `entitlementForEvent` — where they do not merely cost their own
   * latency but stall the render that is already in progress.
   *
   * Almost none of them depended on each other. They were sequential because
   * `await` on its own line reads naturally, not because anything needed the
   * previous answer: the tees, the setup flow, the access list, the card
   * count and the plan entitlement are all answers to "this event id" and
   * could always have been asked together.
   *
   * Two waves now — this one off the session, the one below off what it
   * returns. Measured on the demo data before and after; see the PR.
   *
   * `loadEventState` is in here with the rest rather than gating them. It can
   * come back null, and then everything else was wasted work — but that path
   * ends in a redirect, so the waste is on a request nobody reads, and paying
   * for it buys the other eleven their parallelism on every request that is
   * actually served.
   */
  const [state, flow, eventTees, params, accessList, cardsIn, scanPlan, orgsForSwitcher] =
    await Promise.all([
      loadEventState(session.eventId),
      setupFlowFor(session.eventId),
      teesForEvent(session.eventId),
      searchParams,
      accessibleEvents(session.email),
      enteredCardCount(session.eventId),
      entitlementForEvent(session.eventId, "cardScan"),
      organizationsForOrganizer(session.email),
    ]);
  if (!state) redirect("/");
  const e = state.event;
  const locked = isSetupLocked(state.event);

  /**
   * And the second wave: the three that genuinely need an answer from the
   * first — the club's id, and the list of events access allows.
   */
  const [courses, org, allEvents] = await Promise.all([
    // The club's own courses. The setup picker used to read a bundled list of
    // four invented layouts, so it offered courses nobody plays and scored
    // against cards that do not exist.
    clubCourses(e.organizationId, e.id),
    prisma.organization.findUnique({
      where: { id: e.organizationId },
      // `kind` so the branding nudge calls the outfit by its own name — a
      // society is not a club. See ChecklistState.orgKind.
      select: { defaultCourseId: true, logoUrl: true, themeSetAt: true, kind: true },
    }),
    prisma.event.findMany({
      where: { id: { in: accessList.map((a) => a.eventId) } },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { players: true } } },
    }),
  ]);
  const homeCourseId = org?.defaultCourseId ?? null;

  // Checked against the club's own courses rather than trusted: this arrives
  // off the query string, and opening an editor for a row that is not theirs
  // would be the screen contradicting every action behind it.
  const requestedCourse = params.course ?? "";
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
  const accessible = new Map(accessList.map((a) => [a.eventId, a.role]));
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

  // The details step comes from the FLOW this page already loaded for its
  // rail, so the two cannot disagree about whether step one is finished.
  const detailStep = flow?.steps.find((s) => s.href === "/event");
  // The money step's own answer, for the same reason: the flow decides whether
  // it is finished and a second copy of that test here is how the rail and the
  // dashboard would come to disagree about it.
  const moneyStep = flow?.steps.find((s) => s.href === "/prizes");
  /**
   * A match keeps the checklist honest about what it actually has.
   *
   * `setupFlowFor` already returns null for one — two people on the first tee
   * have no tournament to set up — but the checklist below it went on offering
   * Flights and Access & staff, which the sidebar closed for a match long ago.
   */
  const matchEvent = isMatch(e.shape);

  /**
   * ONE SWITCHER, RENDERED IN ONE OF TWO PLACES.
   *
   * It was written out twice with identical props — once above the setup form
   * and once below it — under `!railSpeaks(flow)` and `railSpeaks(flow)`.
   * Those two are exhaustive, so it always renders; what the pair decides is
   * WHERE, which is the whole point (see the long note at the first site).
   *
   * Two copies of a six-line element is two places to update and one of them
   * to forget, and the props are not trivially identical — `events` is a
   * mapped array and `organizations` was a separate `await` at each site. As
   * one element it cannot drift, and the position stays a decision rather
   * than a duplication.
   */
  const switcher = (
    <SettingsSectionAnchor id="tournaments">
      <EventSwitcher events={eventRows} organizations={orgsForSwitcher} />
    </SettingsSectionAnchor>
  );

  /**
   * WHAT THIS PAGE CONTAINS, because it is long enough that you cannot see.
   *
   * Measured: 6,221px after folding the tee tables away — 7.7 phone screens —
   * across four independent areas with nothing between them but a gap. An
   * organizer coming to change who can see the leaderboard scrolls past the
   * whole setup form, the journey card and every course the club owns, with
   * no way of knowing that section exists until they arrive at it.
   *
   * `SettingsNav` is the app's existing answer to exactly this. It was built
   * for Club settings at 11,000px, and its own header sets out why a nav
   * rather than collapsing everything: sections already carry their own
   * headings, and several hold unsaved drafts behind a Save button that a
   * disclosure unmounting its children would throw away silently. Both are
   * true here too — which is why the tee tables ARE folded (they hold no
   * draft and carry no heading of their own) and these sections are not.
   *
   * Used on one screen until now. Second reader, same component.
   */
  const sections: SettingsSection[] = [
    { id: "details", label: "Tournament details" },
    { id: "courses", label: "Courses" },
    { id: "scoring", label: "Players & scoring" },
    { id: "tournaments", label: "Your tournaments" },
  ];
  const checklist = setupChecklist({
    isMatch: matchEvent,
    ...state,
    branding: clubBrandingState(org),
    orgKind: org?.kind,
    details: detailStep ? { done: detailStep.done, missing: detailStep.missing } : undefined,
    money: moneyStep ? { done: moneyStep.done } : undefined,
  });

  return (
    <>
      {/* Above the page title on all four Set-up screens. A progress rail is
          wayfinding — it says where you are, the way a breadcrumb does — and
          wayfinding belongs above the heading it locates. It also has to be in
          the same place on every screen of the four, or it stops being a
          landmark and becomes decoration that moves. */}
      <SetupFlowRail flow={flow} href="/event" />
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h1 className="page-title">Tournament details</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Manage your tournaments, or configure the one you're running.
        </p>
      </div>

      {/**
       * THE SWITCHER YIELDS WHILE SETUP IS STILL RUNNING.
       *
       * `/event` is two screens in one, and its own subtitle says so: "Manage
       * your tournaments, or configure the one you're running." The manager
       * half — every tournament you have, plus a form to create another, plus
       * a link to set up a casual round — sat directly under the heading, and
       * the half the screen is NAMED after sat below all three.
       *
       * That matters because of who is sent here. The setup rail's first step
       * points at this screen and describes it as "Say where it is played, or
       * what day". Walked on 2026-09-11 with a tournament created a minute
       * earlier: the first thing under the heading was a table of tournaments,
       * then "Create a new tournament", then "Just playing a round?" — and the
       * dates and venue fields were fourth. An organizer following the guide
       * to fill in a date is met with a form for making another tournament.
       *
       * So it moves below while the rail is speaking, and leads again once the
       * rail goes quiet. Precisely when that is, since "setup is done" would
       * be wrong: `railSpeaks` is `!complete || readyToLaunch`, and
       * `readyToLaunch` is `complete && !launched` — so the rail keeps talking
       * through the gap between finishing setup and launching, and only stops
       * once the tournament is LAUNCHED. Which is the right line. A launched
       * tournament is one an organizer comes to /event to manage; an unlaunched
       * one is still being built, even if every box is ticked.
       *
       * Same predicate and same reasoning as the checklist immediately below:
       * while the guide is running the ordered guide wins, afterwards the
       * status board does. One rule, two readers.
       */}
      {!railSpeaks(flow) && switcher}

      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />

      {/* The checklist stays, but only once the guided rail above has stopped
          rendering — which it does the moment setup is complete.

          Two progress lists on one screen is worse than either alone, and
          these two disagree by design: the rail is ORDERED and says what to do
          next, the checklist is a flat status board including the optional
          items (staff, club branding) that a guide must not put in anybody's
          way. While setup is running the ordered one wins; afterwards the
          checklist is what an organizer comes back to. */}
      {!railSpeaks(flow) && (
        <div style={{ marginBottom: 16 }}>
          <SetupChecklist items={checklist} currentPath="/event" />
        </div>
      )}

      <SettingsNav sections={sections} />

      <SettingsSectionAnchor id="details">
      <EventSetupClient
        key={e.id}
        isMatch={matchEvent}
        hasBracket={hasKnockoutStage(state.stages)}
        setup={flow ? { doneCount: flow.doneCount, total: flow.steps.length, complete: flow.complete } : null}
        launched={e.status === "live" || e.status === "completed"}
        scored={cardsIn > 0}
        initial={{
          name: e.name, dates: e.dates, format: e.format, course: e.course, city: e.city,
          address: e.address, regDeadline: e.regDeadline, capacity: e.capacity,
          playerCountMode: e.playerCountMode, manualPlayerCount: e.manualPlayerCount,
          courseMode: e.courseMode, sideStyle: e.sideStyle, courseId: e.courseId ?? "",
        }}
        playersCount={state.confirmed.length}
        // The id travels now. It was dropped here, which is the whole reason
        // the tournament's venue was the one thing in the app picked by
        // typing a name — the screen never had anything else to pick by.
        courses={courses.map((c) => ({ id: c.id, name: c.name, city: c.city, address: "" }))}
      />
      </SettingsSectionAnchor>

      {/* Always available, never a blocker here. A tournament may not need
          course data to score — gross match play doesn't — and still want it,
          because printed scorecards carry par, yardage and stroke index next
          to the club's logo. */}
      <SettingsSectionAnchor id="courses">
        <CourseLibrary
          courses={courses}
          canEdit={session.viewRole === "admin"}
          // Resolved here rather than in the component: a locked feature has
          // to be visible before somebody photographs a card and uploads it.
          cardScanAvailable={scanPlan.allowed}
          homeCourse={homeCourseId}
          // Checked against the club's own courses rather than trusted: this
          // arrives off the query string, and opening an editor for a row that
          // is not theirs would be the screen contradicting every action
          // behind it.
          openCourseId={openCourseId}
        />
      </SettingsSectionAnchor>

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

      <SettingsSectionAnchor id="scoring">
        <PlaySettings
          mode="tournament"
          settings={settingsOf(e)}
          canEdit={session.viewRole === "admin"}
          shareToken={e.shareToken}
          rounds={state.stages.map((s) => ({
            stageId: s.id,
            label: roundLabelWith(state.stages, s.id, s.type),
            code: s.accessCode,
          }))}
          // The sets this course is rated for, so the choice names real tees
          // with their real ratings rather than asking for one blind.
          tees={eventTees.map((t) => ({
            id: t.id,
            name: t.name,
            courseRating: t.courseRating,
            slopeRating: t.slopeRating,
            rated: t.rated,
          }))}
          defaultTeeId={e.defaultTeeId}
        />
      </SettingsSectionAnchor>

      {/* And here it is while the guide is running: still on the screen, still
          one click from switching or creating, just no longer standing in
          front of the fields the guide sent this organizer to fill in. */}
      {railSpeaks(flow) && switcher}

      <SetupFlowFooter flow={flow} href="/event" />
    </>
  );
}
