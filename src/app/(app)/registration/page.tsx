import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { RegistrationClient } from "@/components/RegistrationClient";
import { brandForEvent } from "@/lib/services/organization";
import { rosterForEvent } from "@/lib/services/roster";

export default async function RegistrationPage() {
  const session = await requireScreen("registration");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const locked = isSetupLocked(state.event);
  const brand = await brandForEvent(session.eventId);
  const roster = await rosterForEvent(session.eventId);

  // Flight label per player, for the confirmed-field table (absorbs the old Roster screen).
  const flightByPlayer = new Map<string, string>();
  state.groups.forEach((g, i) => {
    for (const p of state.confirmed) if (p.groupId === g.id) flightByPlayer.set(p.id, `Flight ${i + 1}`);
  });

  return (
    <RegistrationClient
      event={{
        name: state.event.name,
        capacity: state.event.capacity,
        regDeadline: state.event.regDeadline,
          registrationOverride: state.event.registrationOverride,
        inviteMessage: state.event.inviteMessage,
        organizationName: brand?.name,
        dates: state.event.dates,
        course: state.event.course,
        city: state.event.city,
      }}
      confirmed={state.confirmed.map((p) => ({
        id: p.id,
        name: p.name,
        handicap: p.handicap,
        handicapType: p.handicapType,
        seed: p.seed,
        email: p.email,
        phone: p.phone,
        flight: flightByPlayer.get(p.id),
      }))}
      waitlist={state.waitlist.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, handicapType: p.handicapType, seed: p.seed, email: p.email, phone: p.phone }))}
      locked={locked}
      isAdmin={session.viewRole === "admin"}
      roster={roster}
    />
  );
}
