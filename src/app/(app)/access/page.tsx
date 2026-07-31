import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AccessClient } from "@/components/AccessClient";

export default async function AccessPage() {
  await requireScreen("access");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Setup</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Access control</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Organizers get full admin access. Players get read-only leaderboard/stats plus score entry for their own
          matches.
        </p>
      </div>
      <AccessClient
        accounts={state.accounts.map((a) => ({ id: a.id, name: a.name, email: a.email, role: a.role }))}
      />
    </>
  );
}
