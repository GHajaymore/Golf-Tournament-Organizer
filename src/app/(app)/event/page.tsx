import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { PlaySettings } from "@/components/PlaySettings";
import { CourseSetupPrompt } from "@/components/CourseSetupPrompt";
import { CourseLibrary } from "@/components/CourseLibrary";
import { clubCourses } from "@/lib/services/courses";
import { accessibleEvents } from "@/lib/services/access";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { EventSetupClient } from "@/components/EventSetupClient";
import { EventSwitcher } from "@/components/EventSwitcher";
import { SetupLockBanner } from "@/components/SetupLockBanner";
import { SetupChecklist, type ChecklistItem } from "@/components/SetupChecklist";


export default async function EventPage() {
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
    select: { defaultCourseId: true },
  });
  const homeCourseId = org?.defaultCourseId ?? null;

  const allEvents = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { players: true } } },
  });
  // Access is per-event *or* inherited from running the organization, so this
  // has to read the same list the switch action authorizes against — checking
  // Account rows alone hid a club admin's own tournaments from them.
  const accessible = new Map((await accessibleEvents(session.email)).map((a) => [a.eventId, a.role]));
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

  const hasSchedule = state.matches.length > 0;
  const checklist: ChecklistItem[] = [
    {
      label: "Registration & field",
      detail:
        state.confirmed.length > 0
          ? `${state.confirmed.length} confirmed${state.waitlist.length ? ` · ${state.waitlist.length} waitlisted` : ""}`
          : "No players yet — open registration and add the field.",
      done: state.confirmed.length > 0,
      href: "/registration",
    },
    {
      label: "Rounds & format",
      detail:
        state.stages.length > 0
          ? `${state.stages.length} round${state.stages.length === 1 ? "" : "s"} configured`
          : "No rounds yet — sequence the tournament.",
      done: state.stages.length > 0,
      href: "/stages",
    },
    {
      label: "Flights & divisions",
      detail:
        state.groups.length > 0
          ? `${state.groups.length} flights · ${hasSchedule ? "schedule generated" : "schedule not generated yet"}`
          : "No flights yet — generate them from the confirmed field.",
      done: state.groups.length > 0 && hasSchedule,
      href: "/grouping",
    },
    {
      label: "Access & staff",
      detail:
        state.accounts.length > 1
          ? `${state.accounts.length - 1} additional staff account${state.accounts.length - 1 === 1 ? "" : "s"}`
          : "Just you so far — invite assistants if you need help running it.",
      done: state.accounts.length > 1,
      href: "/access",
      optional: true,
    },
  ];

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
          homeCourse={homeCourseId}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <CourseSetupPrompt
          eventCourse={e.course}
          eventCity={e.city}
          isStaff={session.viewRole === "admin" || session.viewRole === "assistant"}
          blocking={false}
        />
      </div>

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
