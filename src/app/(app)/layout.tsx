import { Sidebar } from "@/components/Sidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { EventContextBar } from "@/components/EventContextBar";
import { navForRole } from "@/lib/nav";
import { requireSession, initialsOf } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { brandForEvent } from "@/lib/services/organization";
import { settingsOf } from "@/lib/services/tournament";
import { TEAM_FORMAT_NAMES } from "@/lib/formats";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = initialsOf(session.name);
  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
  });
  // Teams only appear once a round is actually set to a team format, so the
  // many tournaments that never play one are not shown a link to an empty
  // screen.
  const teamRounds = event
    ? await prisma.stage.count({ where: { eventId: event.id, format: { in: TEAM_FORMAT_NAMES } } })
    : 0;
  // Screens the tournament governs (leaderboard, score entry) are filtered out
  // of the sidebar here rather than shown and then bounced.
  const sections = navForRole(session.viewRole, event ? settingsOf(event) : undefined, {
    hasTeamRound: teamRounds > 0,
  });
  // Club branding replaces the TourneyHQ mark in the sidebar for every
  // tournament this organization runs (with attribution kept on free plans).
  const brand = session.eventId ? await brandForEvent(session.eventId) : null;

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
      }}
    >
      <Sidebar
        sections={sections}
        name={session.name}
        role={session.role}
        viewRole={session.viewRole}
        initials={initials}
        brand={brand}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <MobileTopBar />
        {event && (
          <EventContextBar
            name={event.name}
            dates={event.dates}
            course={event.course}
            city={event.city}
            status={event.status}
            canSwitch={session.viewRole === "admin"}
          />
        )}
        <main className="app-main" style={{ flex: 1, minWidth: 0, padding: "26px 30px", maxWidth: 1220 }}>
          {children}
        </main>
      </div>
      <MobileTabBar
        sections={sections}
        name={session.name}
        role={session.role}
        viewRole={session.viewRole}
        initials={initials}
        brand={brand}
      />
    </div>
  );
}
