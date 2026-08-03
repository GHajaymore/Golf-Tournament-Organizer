import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { EventSetupClient } from "@/components/EventSetupClient";
import { EventSwitcher } from "@/components/EventSwitcher";
import { SetupLockBanner } from "@/components/SetupLockBanner";
import { COURSES } from "@/lib/courses";

export default async function EventPage() {
  const session = await requireScreen("event");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const e = state.event;
  const locked = isSetupLocked(state.event);

  const allEvents = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { players: true } },
      accounts: { where: { email: session.email }, select: { id: true } },
    },
  });
  const eventRows = allEvents.map((ev) => ({
    id: ev.id,
    name: ev.name,
    status: ev.status,
    dates: ev.dates,
    course: ev.course,
    players: ev._count.players,
    isActive: ev.id === session.eventId,
    hasAccess: ev.accounts.length > 0,
  }));

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Event setup</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Manage your tournaments, or configure the one you're running.
        </p>
      </div>

      <EventSwitcher events={eventRows} />

      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />

      <div style={{ marginBottom: 12 }}>
        <span className="card-kicker">Editing · {e.name || "Untitled tournament"}</span>
      </div>

      <EventSetupClient
        key={e.id}
        initial={{
          name: e.name, dates: e.dates, format: e.format, course: e.course, city: e.city,
          address: e.address, regDeadline: e.regDeadline, capacity: e.capacity,
          playerCountMode: e.playerCountMode, manualPlayerCount: e.manualPlayerCount,
        }}
        playersCount={state.confirmed.length}
        courses={COURSES.map((c) => ({ name: c.name, city: c.city, address: c.address }))}
      />
    </>
  );
}
