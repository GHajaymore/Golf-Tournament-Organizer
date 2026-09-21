import Link from "next/link";
import { screenMetadata } from "@/lib/screen-metadata";
import { formattingFor } from "@/lib/domain/locale";
import { TournamentFormatting } from "@/components/TournamentFormatting";
import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { roundLabelWith } from "@/lib/domain/round-label";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { strandedEntrantCount } from "@/lib/services/round-codes";
import { hasKnockoutStage } from "@/lib/stage-types";
import { enteredCardCount } from "@/lib/services/round-cards";
import { PlaySettings } from "@/components/PlaySettings";
import { teesForEvent } from "@/lib/services/handicaps";
import { CourseLibrary } from "@/components/CourseLibrary";
import { clubCourses } from "@/lib/services/courses";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { EventSetupClient } from "@/components/EventSetupClient";
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
  const [state, flow, eventTees, params, cardsIn, scanPlan, strandedCount] = await Promise.all([
    loadEventState(session.eventId),
    setupFlowFor(session.eventId),
    teesForEvent(session.eventId),
    searchParams,
    enteredCardCount(session.eventId),
    entitlementForEvent(session.eventId, "cardScan"),
    /**
     * Entrants with no email address, so the sign-in control can say what
     * turning Round Codes off would cost BEFORE the dropdown is touched.
     *
     * The same function `saveTournamentSettings` counts with, so the screen
     * and the refusal cannot name different numbers — which is the fault this
     * rule already had once, when a duplicated condition in the caller
     * shadowed the real one.
     *
     * In this wave because it needs only the session, like the six above it.
     */
    strandedEntrantCount(session.eventId),
  ]);
  if (!state) redirect("/");
  const e = state.event;
  const locked = isSetupLocked(state.event);

  /**
   * And the second wave: the two that genuinely need an answer from the
   * first — both of them the club's id.
   */
  const [courses, org] = await Promise.all([
    // The club's own courses. The setup picker used to read a bundled list of
    // four invented layouts, so it offered courses nobody plays and scored
    // against cards that do not exist.
    clubCourses(e.organizationId, e.id),
    prisma.organization.findUnique({
      where: { id: e.organizationId },
      // `kind` so the branding nudge calls the outfit by its own name — a
      // society is not a club. See ChecklistState.orgKind.
      select: {
        defaultCourseId: true,
        logoUrl: true,
        themeSetAt: true,
        kind: true,
        // How this club writes a date and an amount — the default this
        // tournament may override. See domain/locale.ts.
        locale: true,
        currency: true,
      },
    }),
  ]);
  const homeCourseId = org?.defaultCourseId ?? null;

  /**
   * How this tournament writes its dates: its own answer, then the club's,
   * then US English. Resolved once here rather than in each component, so two
   * halves of one screen cannot disagree about it.
   */
  const fmt = formattingFor(org, e);

  // Checked against the club's own courses rather than trusted: this arrives
  // off the query string, and opening an editor for a row that is not theirs
  // would be the screen contradicting every action behind it.
  const requestedCourse = params.course ?? "";
  const openCourseId = courses.some((c) => c.id === requestedCourse) ? requestedCourse : null;


  /**
   * A match keeps the checklist honest about what it actually has.
   *
   * `setupFlowFor` already returns null for one — two people on the first tee
   * have no tournament to set up — but the checklist below it went on offering
   * Flights and Access & staff, which the sidebar closed for a match long ago.
   */
  const matchEvent = isMatch(e.shape);


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
  /**
   * EACH LABEL NAMES THE SECTION, NEVER THE PAGE.
   *
   * `details` read "Tournament details", which is this screen's own `<h1>` and
   * the sidebar's name for it — so the first thing in a control headed "On
   * this page" was the page. It answered "where does this go?" with "here",
   * and it matched no heading in the section it scrolls to, which is
   * "Tournament identity".
   *
   * The other two were right and are the convention: `Courses` is
   * `CourseLibrary`'s own card title and `Players & scoring` is
   * `PlaySettings`'. A jump-to link is a promise about what you will see when
   * you land, so it has to be the words that are actually there.
   *
   * `/organization`, the other screen with one of these, never had the fault —
   * seven sections, not one of them called "Club settings".
   */
  const sections: SettingsSection[] = [
    { id: "details", label: "Tournament identity" },
    { id: "courses", label: "Courses" },
    { id: "scoring", label: "Players & scoring" },
  ];
  const checklist = setupChecklist({
    isMatch: matchEvent,
    ...state,
    branding: clubBrandingState(org),
    orgKind: org?.kind,
    // Every step's verdict from the FLOW this page already loaded for its
    // rail, so the list under the rail cannot disagree with the rail above it.
    flow: flow?.steps,
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
        {/* ONE JOB NOW, AND THE SUBTITLE SAYS SO.
            It read "Manage your tournaments, or configure the one you're
            running" — an accurate description of a screen doing two things,
            and the plainest evidence that it was. Managing the SET moved to
            /tournaments, which the sidebar's Club group already had the right
            heading for. */}
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Where {e.name || "this tournament"} is played, when, and how it is scored. To switch
          between tournaments or start another, go to <Link href="/tournaments">Tournaments</Link>.
        </p>
      </div>


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
        setup={
          flow
            ? {
                doneCount: flow.doneCount,
                total: flow.steps.length,
                complete: flow.complete,
                // WHICH are done, so the journey card can mark them. The
                // count alone left five identical chips under "3 of 5 done".
                doneHrefs: flow.steps.filter((s) => s.done).map((s) => s.href),
              }
            : null
        }
        // The status, not two conclusions drawn from it. This passed
        // `launched` and `finished`, each computed here and each forwarded
        // untouched through EventSetupClient — a page stating a lifecycle rule
        // and posting it through two components. `tournamentPhase` derives
        // both from `PRE_LAUNCH_STATUSES` now.
        status={e.status}
        scored={cardsIn > 0}
        locale={fmt.locale}
        initial={{
          name: e.name, playKind: e.playKind, startOn: e.startOn, endOn: e.endOn, dates: e.dates, datesTentative: e.datesTentative,
          format: e.format, course: e.course, city: e.city,
          address: e.address, regDeadline: e.regDeadline, regOpens: e.regOpens, capacity: e.capacity,
          playerCountMode: e.playerCountMode, manualPlayerCount: e.manualPlayerCount,
          courseMode: e.courseMode, courseId: e.courseId ?? "",
        }}
        playersCount={state.confirmed.length}
        // The id travels now. It was dropped here, which is the whole reason
        // the tournament's venue was the one thing in the app picked by
        // typing a name — the screen never had anything else to pick by.
        courses={courses.map((c) => ({ id: c.id, name: c.name, city: c.city, address: "" }))}
      />
        {/* HOW THIS ONE WRITES ITS DATES AND ITS MONEY.
            In the identity section because that is what it is: the same kind
            of fact as the name and the venue, and the section a reader is
            already in when they notice a date reads wrong. Almost every
            tournament leaves both following the club — see the component. */}
        <div className="card elev-sm" style={{ marginTop: 16 }}>
          <span className="card-kicker">Dates and money</span>
          <TournamentFormatting
            localeOverride={e.localeOverride}
            currencyOverride={e.currencyOverride}
            clubLocale={org?.locale ?? ""}
            clubCurrency={org?.currency ?? ""}
            canEdit={session.viewRole === "admin"}
          />
        </div>
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
          strandedCount={strandedCount}
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
            // Which course, because a two-venue tournament offers both and
            // clubs name their markers alike — see TeeOption.courseName.
            courseName: t.courseName,
            name: t.name,
            courseRating: t.courseRating,
            slopeRating: t.slopeRating,
            rated: t.rated,
          }))}
          defaultTeeId={e.defaultTeeId}
        />
      </SettingsSectionAnchor>


      <SetupFlowFooter flow={flow} href="/event" />
    </>
  );
}
