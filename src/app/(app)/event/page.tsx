import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { EventSetupClient } from "@/components/EventSetupClient";

export default async function EventPage() {
  await requireScreen("event");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const e = state.event;

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Setup</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Event setup</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Core event details, venue and default match format.
        </p>
      </div>
      <EventSetupClient
        initial={{
          name: e.name, dates: e.dates, format: e.format, course: e.course, city: e.city,
          address: e.address, regDeadline: e.regDeadline, capacity: e.capacity,
          playerCountMode: e.playerCountMode, manualPlayerCount: e.manualPlayerCount,
        }}
        playersCount={state.confirmed.length}
      />
    </>
  );
}
