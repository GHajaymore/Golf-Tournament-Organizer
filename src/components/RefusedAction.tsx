import Link from "next/link";
import { Icon } from "./Icon";

/**
 * A MAIN ACTION THE APP REFUSES, SAID WHERE THE PRESS WOULD BE (state machine
 * PR 3; UI/UX, panel 8.3 Q2).
 *
 * The button is drawn refused, and its reason sits directly under it ending in
 * the way out — "Review 1 card" — a link to the screen that puts it right. One
 * component, so no screen invents its own refused button: a greyed-out control
 * with no sentence stops an organizer and tells them nothing, and a sentence
 * with no link makes the app the obstacle (the TD's worry, 8.1: an organizer
 * locked out on the day with no way out on screen).
 *
 * `aria-disabled`, NOT `disabled`: a disabled button leaves the tab order, so a
 * screen reader never reaches the reason. This one stays focusable, names its
 * reason through `aria-describedby`, and does nothing when pressed — it has no
 * handler to call.
 *
 * Reads the machine's refused action as it stands: `nextAction.disabledBecause`
 * and `nextAction.wayOut` (`tournamentStatus`).
 */
export function RefusedAction({
  label,
  icon,
  reason,
  wayOut,
  primary = true,
}: {
  label: string;
  /** A Phosphor icon name, as `Icon` takes it. */
  icon?: string;
  /** Why it is refused — the machine's own sentence, unchanged. */
  reason: string;
  /** Where it is put right. */
  wayOut: { says: string; href: string } | null;
  /** The screen's one filled button, or a quiet one. */
  primary?: boolean;
}) {
  // From the label, not `useId`: no hook, so a server screen can draw it as
  // well as a client one. A screen has one main action, so one label.
  const id = `refused-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return (
    <div className="refused-action" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
      <button type="button" className={primary ? "btn btn-primary" : "btn btn-secondary"} aria-disabled="true" aria-describedby={id}>
        {icon && <Icon name={icon} />} {label}
      </button>
      <p id={id} className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.55, maxWidth: "68ch" }}>
        <Icon name="warning-circle" /> {reason}
        {wayOut && (
          <>
            {" "}
            <Link href={wayOut.href} style={{ color: "var(--color-accent-200)", fontWeight: 600 }}>
              {wayOut.says}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
