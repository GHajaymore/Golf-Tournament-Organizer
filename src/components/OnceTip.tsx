"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon";
import { markSeen, useSeenOnce } from "./useSeenOnce";

/**
 * A HOW-TO SENTENCE, SAID ONCE AND THEN KEPT A TAP AWAY.
 *
 * Open the first time this phone shows it; folded to one small ⓘ line every
 * time after. Never REMOVED: the words stay in the page inside a `<details>`,
 * so a player who wants them back taps once, a screen reader still reaches
 * them, and a server render carries them — which is why the components that
 * moved onto this kept every sentence their tests pin.
 *
 * Closed on the server and on the first client render, opened in an effect
 * when this phone has not seen it. That way round, the returning player — the
 * common case by a distance — gets no layout shift at all, and only the first
 * view pays one.
 *
 * Seen means SHOWN, not acknowledged: a tip opened once is recorded at once.
 * Ajay's ask was "required only once", and a tip that waits for a "Got it" is
 * one more control on a crowded screen.
 */
export function OnceTip({
  id,
  label,
  children,
  style,
}: {
  /** Stable key for this tip; it names the localStorage entry. */
  id: string;
  /** What the folded line says, e.g. "About the microphone". */
  label: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { seen } = useSeenOnce(id);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (seen === false) {
      setOpen(true);
      markSeen(id);
    }
  }, [seen, id]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      style={{ margin: 0, ...style }}
    >
      <summary
        className="touch-target"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          listStyle: "none",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--color-neutral-400)",
        }}
      >
        <Icon name="info" /> {label}
      </summary>
      <div style={{ fontSize: 14, lineHeight: 1.5, color: "var(--color-neutral-400)", marginTop: 2 }}>{children}</div>
    </details>
  );
}
