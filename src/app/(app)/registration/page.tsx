import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { teesForEvent, roundTeeId } from "@/lib/services/handicaps";
import { redirect } from "next/navigation";
import { RegistrationClient } from "@/components/RegistrationClient";
import { brandForEvent } from "@/lib/services/organization";
import { rosterForEvent } from "@/lib/services/roster";
import { planForEvent } from "@/lib/services/entitlements";
import { phoneRequiredFor } from "@/lib/plans";

export default async function RegistrationPage() {
  const session = await requireScreen("registration");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const locked = isSetupLocked(state.event);
  const brand = await brandForEvent(session.eventId);
  const roster = await rosterForEvent(session.eventId);
  const plan = await planForEvent(session.eventId);

  // Flight label per player, for the confirmed-field table (absorbs the old Roster screen).
  const flightByPlayer = new Map<string, string>();
  state.groups.forEach((g, i) => {
    for (const p of state.confirmed) if (p.groupId === g.id) flightByPlayer.set(p.id, `Flight ${i + 1}`);
  });

  const eventTees = await teesForEvent(state.event.id);
  const roundTee = roundTeeId(eventTees, state.event.defaultTeeId);

  return (
    <RegistrationClient
      // The sets an organizer may put somebody on, and what a blank resolves
      // to, so the column never shows an empty box meaning "the round’s".
      tees={eventTees.map((t) => ({ id: t.id, name: t.name }))}
      teePolicy={settingsOf(state.event).teePolicy}
      defaultTeeName={
        eventTees.find((t) => t.id === roundTee)?.name
          ? `${eventTees.find((t) => t.id === roundTee)?.name} (round’s)`
          : "Round’s tees"
      }
      event={{
        name: state.event.name,
        capacity: state.event.capacity,
        status: state.event.status,
        regDeadline: state.event.regDeadline,
          registrationOverride: state.event.registrationOverride,
        inviteMessage: state.event.inviteMessage,
        organizationName: brand?.name,
        dates: state.event.dates,
        course: state.event.course,
        city: state.event.city,
        registrationOpen: state.event.registrationOpen,
        registrationApproval: state.event.registrationApproval,
        requirePhone: state.event.requirePhone,
        phoneLocked: phoneRequiredFor(plan, false),
        registrationToken: state.event.registrationToken,
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
        teeId: p.teeId,
      }))}
      waitlist={state.waitlist.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, handicapType: p.handicapType, seed: p.seed, email: p.email, phone: p.phone }))}
      pendingEntries={state.players
        .filter((p) => p.status === "pending")
        .map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, handicapType: p.handicapType, seed: p.seed, email: p.email, phone: p.phone }))}
      locked={locked}
      isAdmin={session.viewRole === "admin"}
      roster={roster}
    />
  );
}
