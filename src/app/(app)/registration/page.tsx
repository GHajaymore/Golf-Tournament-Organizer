import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RegistrationClient } from "@/components/RegistrationClient";

export default async function RegistrationPage() {
  await requireScreen("registration");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  return (
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
      confirmed={state.confirmed.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed }))}
      waitlist={state.waitlist.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed }))}
    />
  );
}
