"use client";

/**
 * The brief note on a hole when its first tap was dropped as the second half
 * of a double-tap (B117). Words and a border, theme tokens only, so it reads
 * in sun.
 *
 * IT TAKES NO LAYOUT SPACE, EVER. The wrapper is zero-height and the note is
 * laid over its neighbour, so the pad under the player's thumb never moves
 * when the note appears (an in-flow note pushed the pad down about 50px at
 * the very moment somebody was tapping it again). `place="above"` draws it
 * over what is above the wrapper (the hole's header, on the stroke card);
 * `"below"` over what is below it.
 */
export function TapNotTaken({ show, hole, place = "above" }: { show: boolean; hole: number; place?: "above" | "below" }) {
  return (
    // aria-live and NO role="status": the card's own status line stays the one
    // status region on the screen (specs and readers find it by that role).
    <div aria-live="polite" data-testid="tap-not-taken" style={{ position: "relative", height: 0 }}>
      {show && (
        <p
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            ...(place === "above" ? { bottom: 0 } : { top: 0 }),
            zIndex: 2,
            margin: 0,
            padding: "8px 12px",
            borderRadius: 8,
            border: "2px solid var(--color-warning)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            fontSize: 16,
            fontWeight: 700,
            pointerEvents: "none",
          }}
        >
          Hole {hole}: that tap came too fast to count. Tap again.
        </p>
      )}
    </div>
  );
}
