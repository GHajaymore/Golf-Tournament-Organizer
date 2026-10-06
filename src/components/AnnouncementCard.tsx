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
 * One posted notice. Its own file so the server list and the player's folding
 * list draw it from one place — see `AnnouncementList`.
 */
export function AnnouncementCard({ a }: { a: AnnouncementItem }) {
  return (
    <div
      className="card elev-sm"
      style={{ gap: 4, borderColor: a.pinned ? "var(--color-accent-700)" : undefined }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name="megaphone" style={{ color: "var(--color-accent-200)" }} />
        {a.pinned && (
          <span className="tag tag-accent">
            <Icon name="push-pin" /> Pinned
          </span>
        )}
        {/* The title takes the rest of the row and wraps INSIDE it. As a
            plain wrapping item a long title dropped whole to the next line
            and left the megaphone alone on the row above it. */}
        <span style={{ fontWeight: 600, fontSize: 15, flex: "1 1 0", minWidth: 0 }}>
          {/* The title in an element of its own: its text stays one node,
              which is how a reader (and player-round.spec) finds it. */}
          <span>{a.title}</span>
          {a.createdAt && (
            <span className="text-muted" style={{ fontSize: 13, fontWeight: 400 }}>
              {" "}
              · {sinceWords(a.createdAt)}
            </span>
          )}
        </span>
      </div>
      {a.body && (
        // data-authored: the organizer's own words — see e2e/player-words.spec.ts.
        <p data-authored className="text-muted" style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap" }}>
          {a.body}
        </p>
      )}
    </div>
  );
}
