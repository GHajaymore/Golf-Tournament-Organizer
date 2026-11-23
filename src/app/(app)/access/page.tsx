import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { golfTermsForEvent } from "@/lib/services/organization";
import { screensShownFor } from "@/lib/services/screens-shown";
import { EventHelpers } from "@/components/club/EventHelpers";

export const metadata = screenMetadata("/access");

export default async function AccessPage() {
  await requireScreen("access");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  // R7: while Club settings is shown, this event's helpers are its "On this event" section, drawn there
  // and only there (`MOVES`, `/access` → `/organization#access`). One boolean, so the list is never drawn twice.
  const shown = await screensShownFor(session);
  if (shown.has("clubSettings")) redirect("/organization#access");
  // The club's word for who runs it — organizer or organiser (`golf-terms.ts`).
  const { organizers } = await golfTermsForEvent(session.eventId);

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        {/* The sidebar's own words. Eighteen of the twenty-one console screens
            already head themselves with the label on the link that reaches
            them; this one said "Access control", so the door and the room had
            different names and the browser tab was about to be a third. See
            screen-metadata.ts. */}
        <h1 className="page-title">Staff &amp; helpers</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {organizers.charAt(0).toUpperCase() + organizers.slice(1)} get full admin access. Players get read-only leaderboard/stats plus score entry for their own
          matches.
        </p>
      </div>
      <EventHelpers eventId={session.eventId} organizationId={state.event.organizationId} />
    </>
  );
}
