import Link from "next/link";
import { STATUS_META } from "@/lib/format";
import { Icon } from "./Icon";

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
      <Icon name="flag-pennant" weight="fill" style={{ color: "var(--color-accent)", fontSize: 15 }} />
      <span style={{ fontWeight: 600, fontSize: 13 }}>{name || "Untitled tournament"}</span>
      <span className="text-muted" style={{ fontSize: 12 }}>
        {[dates, location].filter(Boolean).join(" · ")}
      </span>
      <span className={`tag ${meta.tag}`} style={{ fontSize: 10 }}>
        {status === "live" && <Icon name="circle" weight="fill" style={{ fontSize: 6, marginRight: 4 }} />}
        {meta.label}
      </span>
      <div style={{ flex: 1 }} />
      {canSwitch && (
        <Link
          href="/event"
          // `touch-target` gives it 44px of height on a coarse pointer without
          // changing how it looks: it is a navigational control, not a link
          // inside a sentence, and at 19px it was the last thing on the
          // dashboard a thumb could miss.
          className="text-muted touch-target"
          style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <Icon name="arrows-left-right" /> Switch event
        </Link>
      )}
    </div>
  );
}
