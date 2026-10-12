import { AnnouncementCard, type AnnouncementItem } from "./AnnouncementCard";
import { FoldedAnnouncements } from "./FoldedAnnouncements";
import { sinceWords } from "@/lib/domain/since";

export type { AnnouncementItem } from "./AnnouncementCard";

/**
 * Posted notices, rendered the same way wherever they are read.
 *
 * Lifted out of the dashboard when `/me` learned to show them. The markup was
 * inline there and only there, which is how the player screen came to show
 * none at all — see `announcementsFor` for the whole of that.
 *
 * A component rather than a copied block, so the organizer previewing a notice
 * on the dashboard is looking at what the field will actually see. Two copies
 * of this drifting apart is a smaller version of the bug it was extracted to
 * fix.
 *
 * `foldSeen` is the player's Today (Ajay, 2026-10-05): a notice read once
 * folds into "N earlier messages" instead of sitting between the cards for
 * the rest of the tournament. Never for pinned ones — pinning is the
 * organizer saying this outranks everything — and never on the organizer's
 * dashboard, which shows what was posted.
 */
export function AnnouncementList({
  items,
  foldSeen = false,
  lineOnceRead = false,
}: {
  items: AnnouncementItem[];
  foldSeen?: boolean;
  /**
   * The player's PINNED notices on Today (2026-10-06): in full until this
   * phone has shown them, then one line — the title, the text a tap away.
   * Never folded away; see `FoldedAnnouncements`.
   */
  lineOnceRead?: boolean;
}) {
  if (items.length === 0) return null;
  // "4 hours ago" is said HERE, on the server, once — the cards below are
  // drawn again in the browser on the player's Today, and a card that read
  // the clock for itself said two different things. See `since` on the item.
  const now = new Date();
  items = items.map((a) => ({ ...a, since: a.createdAt ? sinceWords(a.createdAt, now) : "" }));
  if (foldSeen) return <FoldedAnnouncements items={items} />;
  if (lineOnceRead) return <FoldedAnnouncements items={items} earlierFold={false} />;

  return (
    <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((a) => (
        <AnnouncementCard key={a.id} a={a} />
      ))}
    </div>
  );
}
