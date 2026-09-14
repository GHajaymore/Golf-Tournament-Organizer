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
          /**
           * THE LIST, WHICH IS ITS OWN SCREEN NOW.
           *
           * This pointed at `/event` — 6,330px of configuring ONE tournament,
           * with the switcher 440px of it — because there was nowhere else
           * for it to go. Worse, WHERE that 440px sat depended on the
           * lifecycle: the switcher leads once a tournament is launched and
           * trails while the setup rail is still talking. That is a good rule
           * with a walkthrough behind it — an organizer following the guide
           * to fill in a date should not be met with a form for creating
           * another tournament — but it meant the most pressed link in the
           * console landed somewhere different depending on state, and never
           * on what it asked for.
           *
           * A fragment (`/event#tournaments`) fixed the landing and left the
           * screen still doing two jobs. `/tournaments` is the rest of it:
           * switching, creating, copying and deleting are about the SET of
           * tournaments, which is club-level, and the sidebar's Club group
           * already drew that line.
           */
          href="/tournaments"
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
