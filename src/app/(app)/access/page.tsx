import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { golfTermsForEvent } from "@/lib/services/organization";
import { screensShownFor, keepingPreview } from "@/lib/services/screens-shown";
import { EventHelpers } from "@/components/club/EventHelpers";

export const metadata = screenMetadata("/access");

export default async function AccessPage() {
  await requireScreen("access");
  const session = await getSession();
  if (!session) redirect("/");
  // R7: while Club settings is shown, this event's helpers are its "On this event" section, drawn there
  // and only there (`MOVES`, `/access` → `/organization#access`). One boolean, so the list is never drawn twice.
  // The old address still OPENS (it answers 200 on its own path, as every old door does while a redesigned
  // screen is shown: `lifecycle-menu.spec`), and says where the list is, with a link.
  const shown = await screensShownFor(session);
  if (shown.has("clubSettings")) {
    return (
      <>
        <div className="page-kicker">Set up</div>
        <h1 className="page-title">Staff &amp; helpers</h1>
        <section className="card">
          <p style={{ margin: 0 }}>
            This tournament&rsquo;s helpers are now in{" "}
            <Link href={await keepingPreview("/organization#access")}>Club settings, under Staff &amp; access, On this event</Link>.
          </p>
        </section>
      </>
    );
  }
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
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
