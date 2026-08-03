import { requireScreen, isSetupLocked } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { RegistrationClient } from "@/components/RegistrationClient";
import { SetupLockBanner } from "@/components/SetupLockBanner";

export default async function RegistrationPage() {
  const session = await requireScreen("registration");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const locked = isSetupLocked(state.event);

  return (
    <>
      <SetupLockBanner locked={locked} isAdmin={session.viewRole === "admin"} />
      <RegistrationClient
      event={{
        name: state.event.name,
        capacity: state.event.capacity,
        regDeadline: state.event.regDeadline,
        inviteMessage: state.event.inviteMessage,
        dates: state.event.dates,
        course: state.event.course,
        city: state.event.city,
      }}
      confirmed={state.confirmed.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed, email: p.email, phone: p.phone }))}
      waitlist={state.waitlist.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed, email: p.email, phone: p.phone }))}
      />
    </>
  );
}
