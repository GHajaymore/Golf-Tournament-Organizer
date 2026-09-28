import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { entitlementForEvent } from "@/lib/services/entitlements";
import { prisma } from "@/lib/db";
import { loadEventState } from "@/lib/services/tournament";
import { AnnouncementsClient } from "@/components/AnnouncementsClient";
// The same words the player's copy of the notice now carries (`AnnouncementList`),
// rather than a private "4h ago" that disagreed with it in form.
import { sinceWords } from "@/lib/domain/since";

export const metadata = screenMetadata("/announcements");

export default async function AnnouncementsPage() {
  const session = await requireScreen("announcements");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const items = await prisma.announcement.findMany({
    where: { eventId: session.eventId },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Manage</div>
        <h1 className="page-title">Announcements</h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {/* WHERE IT LANDS, said before it is posted. This read "schedule
              changes, weather" and stopped, and a posted notice alerts nobody:
              it waits on Today — pinned at the top, the rest at the foot below
              the card and the board (walked 2026-09-28). A secretary moving the
              tee times needs to know that before choosing this over Messages. */}
          Post notices to players — schedule changes, weather, results. They appear on each
          player&rsquo;s Today screen when they open it: pinned posts at the top, the rest at the foot.
          Nothing is sent to their phones — a post in Messages also shows them an unread count.
        </p>
      </div>
      <AnnouncementsClient
        aiAvailable={(await entitlementForEvent(session.eventId, "aiAssist")).allowed}
        items={items.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          pinned: a.pinned,
          when: sinceWords(a.createdAt),
        }))}
      />
    </>
  );
}
