import { requireScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadEventState } from "@/lib/services/tournament";
import { AnnouncementsClient } from "@/components/AnnouncementsClient";

function ago(d: Date): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

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
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Announcements</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Post notices to players — schedule changes, weather, results. Pinned posts sit at the top of
          every player&rsquo;s dashboard.
        </p>
      </div>
      <AnnouncementsClient
        items={items.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          pinned: a.pinned,
          when: ago(a.createdAt),
        }))}
      />
    </>
  );
}
