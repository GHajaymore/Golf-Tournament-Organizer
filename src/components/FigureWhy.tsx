import type { CSSProperties, ReactNode } from "react";
import type { Working } from "@/lib/domain/figure-working";

/**
 * A FIGURE THAT SAYS HOW IT WAS WORKED OUT (2026-10-24, the panel's first item
 * before launch): tap or press the figure, and one sentence of working opens
 * with the Rule it follows.
 *
 * The platform's `<details>`, so it needs no script — the public board is drawn
 * on the server and stays that way — a keyboard reaches it with Tab and opens
 * it with Enter or Space, and a screen reader announces it as a button that
 * expands. The figure itself is the summary, named "<what> — how it was worked
 * out", so nothing new is added to the line a golfer reads; the dotted line
 * under it is the only sign it opens.
 *
 * Two shapes:
 *   inline   the sentence opens under the figure, in the flow (the hole view's
 *            "1 stroke on this hole");
 *   row      the sentence opens as a card under the nearest positioned
 *            ancestor, across its width — a board row, the running strip —
 *            so a figure at the edge of a phone never opens off the screen.
 *            The caller sets `position: relative` on that ancestor.
 *
 * `working` null draws the figure alone: a figure with nothing to explain (or
 * held from this viewer) has no "why" either.
 *
 * The sentence is built by `lib/domain/figure-working.ts` from the very call
 * that made the figure; this component only draws it.
 */
export function FigureWhy({
  figure,
  working,
  name,
  shape = "row",
  style,
  figureStyle,
}: {
  figure: ReactNode;
  working: Working | null | undefined;
  /** What the figure is, for a screen reader: "Net 72", "Hole 7's stroke". */
  name: string;
  shape?: "inline" | "row";
  style?: CSSProperties;
  figureStyle?: CSSProperties;
}) {
  if (!working) return <>{figure}</>;
  return (
    <details className={`why why-${shape}`} style={style} data-working>
      <summary className="why-figure" aria-label={`${name} — how it was worked out`} style={figureStyle}>
        {figure}
      </summary>
      <span className="why-says" role="note">
        {working.says} <cite>({working.cite})</cite>
      </span>
    </details>
  );
}
