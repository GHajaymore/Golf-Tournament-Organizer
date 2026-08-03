import Link from "next/link";
import { STATUS_META } from "@/lib/format";

/**
 * Persistent "which tournament am I in" strip, shown on every authenticated
 * screen — the app supports managing more than one event, and nothing else
 * on most screens confirms which one you're editing.
 */
export function EventContextBar({
  name,
  dates,
  course,
  city,
  status,
  canSwitch,
}: {
  name: string;
  dates: string;
  course: string;
  city: string;
  status: string;
  canSwitch: boolean;
}) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const location = [course, city].filter(Boolean).join(", ");

  return (
    <div
      className="event-context-bar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        borderBottom: "1px solid var(--color-divider)",
        background: "var(--color-surface)",
        flexWrap: "wrap",
      }}
    >
      <i className="ph-fill ph-flag-pennant" style={{ color: "var(--color-accent)", fontSize: 15 }} />
      <span style={{ fontWeight: 600, fontSize: 13 }}>{name || "Untitled tournament"}</span>
      <span className="text-muted" style={{ fontSize: 12 }}>
        {[dates, location].filter(Boolean).join(" · ")}
      </span>
      <span className={`tag ${meta.tag}`} style={{ fontSize: 10 }}>
        {status === "live" && <i className="ph-fill ph-circle" style={{ fontSize: 6, marginRight: 4 }} />}
        {meta.label}
      </span>
      <div style={{ flex: 1 }} />
      {canSwitch && (
        <Link
          href="/event"
          className="text-muted"
          style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <i className="ph ph-arrows-left-right" /> Switch event
        </Link>
      )}
    </div>
  );
}
