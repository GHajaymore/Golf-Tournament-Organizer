import { suspendedWords, type PlayStatus } from "@/lib/domain/play-status";
import { Icon } from "./Icon";

/**
 * PLAY IS SUSPENDED, across the top of every player screen and the public
 * board. `role="alert"` so a screen reader announces it, and on the danger
 * colour: this is the one notice in the app that is about safety.
 */
export function PlaySuspendedBanner({ status, organizer }: { status: PlayStatus; organizer?: string }) {
  if (!status.suspended) return null;
  const { title, body } = suspendedWords(status.note, organizer);
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "12px 14px",
        marginBottom: 14,
        borderRadius: 10,
        // The theme's own danger pair — `danger` is drawn to read ON
        // `dangerBg` on both grounds. White on `danger` does not: the dark
        // ground's danger is a light red, and white on it is about 3.4:1.
        background: "var(--color-danger-bg)",
        border: "2px solid var(--color-danger)",
        color: "var(--color-danger)",
        lineHeight: 1.45,
      }}
    >
      <Icon name="warning" style={{ fontSize: 22, flex: "none", marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: "block", fontSize: 16 }}>{title}</strong>
        <span style={{ fontSize: 14, color: "var(--color-text)" }}>{body}</span>
      </div>
    </div>
  );
}
