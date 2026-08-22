import { requireScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SeriesClient } from "@/components/SeriesClient";
import { seriesForOrg, seriesTable } from "@/lib/services/series";
import { honoursBoard, championSuggestions } from "@/lib/services/honours";
import { HonoursBoard } from "@/components/HonoursBoard";
import { organizationIdForEvent } from "@/lib/services/roster";

/**
 * Season-long standings — an order of merit across several tournaments.
 *
 * Club-level rather than per-event: a season outlives any one round, and the
 * same table is what an organizer looks at from whichever tournament they
 * happen to have open.
 */
export default async function SeriesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await requireScreen("series");
  const params = await searchParams;

  const organizationId = await organizationIdForEvent(session.eventId);
  if (!organizationId) redirect("/dashboard");

  const seasons = await seriesForOrg(organizationId);
  // The club's permanent record, beside the season it is running. Both are
  // history that outlives whichever tournament happens to be open.
  const board = await honoursBoard(organizationId);
  const pending = session.viewRole === "admin" ? await championSuggestions(organizationId) : [];
  const active = seasons.find((s) => s.id === params.id) ?? seasons[0] ?? null;
  const table = active ? await seriesTable(active.id) : null;

  const currentEvent = session.eventId
    ? await prisma.event.findUnique({
        where: { id: session.eventId },
        select: { id: true, seriesId: true },
      })
    : null;

  return (
    <>
      <p className="kicker">Club</p>
      <h1 className="page-title">Season standings</h1>
      <SeriesClient
        seasons={seasons}
        activeId={active?.id ?? null}
        events={table?.events ?? []}
        standings={table?.standings ?? []}
        unlinked={table?.unlinked ?? 0}
        currentEventId={currentEvent?.id ?? ""}
        currentEventSeriesId={currentEvent?.seriesId ?? null}
        canEdit={session.viewRole === "admin"}
      />
      {/* The permanent record, under the season currently being played. Both
          are club history that outlives whichever tournament happens to be
          open, which is why they share a screen. */}
      <HonoursBoard board={board} pending={pending} canEdit={session.viewRole === "admin"} />
    </>
  );
}
