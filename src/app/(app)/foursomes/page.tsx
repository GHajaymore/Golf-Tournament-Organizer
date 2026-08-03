import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FoursomeMaker } from "@/components/FoursomeMaker";

export default async function FoursomesPage() {
  await requireScreen("foursomes");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Tee sheet &amp; pairings</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Generate playing groups and assign tee times or a shotgun start. Pick an algorithm and group
          size; the remainder is handled automatically.
        </p>
      </div>
      <FoursomeMaker
        players={state.confirmed.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed }))}
      />
    </>
  );
}
