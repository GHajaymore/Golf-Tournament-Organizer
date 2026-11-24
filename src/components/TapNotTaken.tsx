"use client";

/**
 * The brief note on a hole when its first tap was dropped as the second half
 * of a double-tap (B117). Words and a border, theme tokens only, so it reads
 * in sun; the live-status wrapper takes no room until the note shows.
 */
export function TapNotTaken({ show, hole }: { show: boolean; hole: number }) {
  return (
    // aria-live and NO role="status": the card's own status line stays the one
    // status region on the screen (specs and readers find it by that role).
    <div aria-live="polite" data-testid="tap-not-taken">
      {show && (
        <p
          style={{
            margin: "8px 0 0",
            padding: "8px 12px",
            borderRadius: 8,
            border: "2px solid var(--color-warning)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          Hole {hole}: that tap came too fast to count. Tap again.
        </p>
      )}
    </div>
  );
}
