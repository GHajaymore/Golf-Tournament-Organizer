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
           * THE LIST, NOT THE TOP OF THE SCREEN THAT HOLDS IT.
           *
           * This pointed at `/event`, which is 6,330px of configuring ONE
           * tournament with the switcher as 440px — 7% — of it. Worse, where
           * that 7% sits depends on the lifecycle: the switcher leads once a
           * tournament is launched and trails while the setup rail is still
           * talking, which is a deliberate and good rule (an organizer
           * following the guide to fill in a date should not be met with a
           * form for creating another tournament). But it means this link
           * landed somewhere different depending on state — on the demo
           * tournament, 5,782px above the list it was asking for.
           *
           * Somebody pressing "Switch event" wants the list. The anchor is on
           * the section in both of its positions, so this is right in either.
           *
           * `scrollMarginTop` on `SettingsSectionAnchor` keeps the heading
           * clear of the sticky jump-to nav when it lands.
           */
          href="/event#tournaments"
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
