import { Icon } from "./Icon";

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
  /**
   * "4 hours ago", worked out ONCE, on the server, by `AnnouncementList`.
   *
   * This card read the clock itself while drawing — and on the player's Today
   * it is drawn twice, by the server and again by the phone (the folding list
   * is a client component). A notice posted 59 seconds before the page was
   * built went out as "just now" and was taken over a moment later as "1
   * minute ago": a hydration mismatch on Today, of the kind that had struck
   * that screen in CI and never twice the same way. The clock guard did not
   * see it, because this file is not marked as a client file — it is only
   * imported by one.
   */
  since?: string;
}

/**
 * One posted notice. Its own file so the server list and the player's folding
 * list draw it from one place — see `AnnouncementList`.
 */
export function AnnouncementCard({ a, compact = false }: { a: AnnouncementItem; compact?: boolean }) {
  /**
   * ONE LINE ON TODAY (Ajay, 2026-10-06 — the one-screen Today). The title is
   * the line and the organizer's text opens under it, a platform <details>, so
   * the words stay in the page. The title has to carry the notice on its own,
   * which is what an organizer writing "Frost delay — 30 minutes" already does.
   */
  if (compact && a.body) {
    return (
      <details
        className="card elev-sm"
        style={{ gap: 4, borderColor: a.pinned ? "var(--color-accent-700)" : undefined }}
      >
        <summary className="touch-target" style={{ cursor: "pointer", listStyle: "none" }}>
          {titleRow(a, true)}
        </summary>
        <p data-authored className="text-muted" style={{ fontSize: 14, margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
          {a.body}
        </p>
      </details>
    );
  }
  return (
    <div
      className="card elev-sm"
      style={{ gap: 4, borderColor: a.pinned ? "var(--color-accent-700)" : undefined }}
    >
      {titleRow(a, false)}
      {a.body && (
        // data-authored: the organizer's own words — see e2e/player-words.spec.ts.
        <p data-authored className="text-muted" style={{ fontSize: 14, margin: 0, whiteSpace: "pre-wrap" }}>
          {a.body}
        </p>
      )}
    </div>
  );
}

function titleRow(a: AnnouncementItem, opens: boolean) {
  return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* One line, once read: the pin itself says "pinned", where the chip
            pushed the title onto a second line (measured at 375px, 2026-10-06).
            In full, the chip stays — it is the first thing the notice says. */}
        {opens && a.pinned ? (
          <Icon name="push-pin" aria-label="Pinned" style={{ color: "var(--color-accent-200)" }} />
        ) : (
          <Icon name="megaphone" style={{ color: "var(--color-accent-200)" }} />
        )}
        {a.pinned && !opens && (
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
          {a.since && (
            <span className="text-muted" style={{ fontSize: 13, fontWeight: 400 }}>
              {" "}
              · {a.since}
            </span>
          )}
        </span>
        {opens && <Icon name="caret-down" className="text-muted" aria-hidden />}
      </div>
  );
}
