import { Icon } from "./Icon";
import { sinceWords } from "@/lib/domain/since";

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  /**
   * When it was posted. The organizer's screen always said "4 hours ago" and
   * the player's never did, so "Tee times moved ten minutes later" could have
   * been this morning's or last week's, and the person it was written for had
   * no way to tell. Walked 2026-09-28.
   */
  createdAt?: Date | string;
}

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
 */
export function AnnouncementList({ items }: { items: AnnouncementItem[] }) {
  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((a) => (
        <div
          key={a.id}
          className="card elev-sm"
          style={{ gap: 4, borderColor: a.pinned ? "var(--color-accent-700)" : undefined }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Icon name="megaphone" style={{ color: "var(--color-accent-300)" }} />
            {a.pinned && (
              <span className="tag tag-accent">
                <Icon name="push-pin" /> Pinned
              </span>
            )}
            {/* The title takes the rest of the row and wraps INSIDE it. As a
                plain wrapping item a long title dropped whole to the next line
                and left the megaphone alone on the row above it. */}
            <span style={{ fontWeight: 600, fontSize: 14, flex: "1 1 0", minWidth: 0 }}>
              {a.title}
              {a.createdAt && (
                <span className="text-muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  {" "}
                  · {sinceWords(a.createdAt)}
                </span>
              )}
            </span>
          </div>
          {a.body && (
            <p className="text-muted" style={{ fontSize: 13, margin: 0, whiteSpace: "pre-wrap" }}>
              {a.body}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
