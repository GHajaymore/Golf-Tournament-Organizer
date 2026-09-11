import { Icon } from "./Icon";

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
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
            <span style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</span>
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
