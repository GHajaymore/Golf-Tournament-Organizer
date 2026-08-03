import { Sidebar } from "@/components/Sidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { EventContextBar } from "@/components/EventContextBar";
import { navForRole } from "@/lib/nav";
import { requireSession, initialsOf } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const sections = navForRole(session.viewRole);
  const initials = initialsOf(session.name);
  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { name: true, dates: true, course: true, city: true, status: true },
  });

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
      />
    </div>
  );
}
