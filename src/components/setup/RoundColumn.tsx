import type { ReactNode } from "react";
import { roundRingWords, type RoundRing } from "@/lib/domain/round-ring";
/**
 * The shape of `RoundStepView` (timeline-step.ts) that this head draws. Declared here, not imported:
 * the rounds area's files are imported by nothing outside it (qa-framework). A `RoundStepView` is
 * assignable to it, so the caller hands the machine's answer straight in.
 */
interface RoundChip {
  chip: string;
  tone: "accent" | "accent-2" | "neutral";
}

/**
 * ONE ROUND'S COLUMN, as every redesigned screen draws its head (R1b): the round's name, then either
 * the needs ring ("2 of 3 set") or its state, then whatever the screen puts under it.
 *
 * It computes nothing. The ring is `roundRing`'s answer, passed in; `ring` is REQUIRED and null is the
 * caller saying "no ring here" (a screen that draws only the state passes null). It never reads a
 * round's `needs`: the count is made once, in `round-ring.ts`. Colours are `--color-*` tokens only;
 * every flex child has `min-width: 0` so the head wraps at 320px instead of pushing the page wide.
 */

/** The chip's tone in tokens; the words are `roundStep`'s, never a second set. */
const TONE_COLOUR: Record<RoundChip["tone"], string> = {
  accent: "var(--color-accent)",
  "accent-2": "var(--color-accent-2)",
  neutral: "var(--color-text-muted)",
};

export interface RoundColumnProps {
  label: string;
  /** `courseDay(...).rounds[id]`: the machine's one answer to a round's chip (`roundStep`). */
  chip: RoundChip;
  /** `roundRing(round)`; null draws the state instead. */
  ring: RoundRing | null;
  children?: ReactNode;
}

export function RoundColumn({ label, chip, ring, children }: RoundColumnProps) {
  return (
    <section data-round-column={label} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 8, color: "var(--color-text)" }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", minWidth: 0 }}>
        <h3 style={{ margin: 0, minWidth: 0, overflowWrap: "anywhere", fontSize: "1rem", fontWeight: 600 }}>{label}</h3>
        {ring ? (
          <span
            data-round-ring={ring.holds ? "holds" : "open"}
            style={{
              minWidth: 0,
              padding: "1px 8px",
              borderRadius: 999,
              border: `1px solid ${ring.set < ring.of ? "var(--color-warning)" : "var(--color-divider)"}`,
              color: ring.set < ring.of ? "var(--color-warning)" : "var(--color-text-muted)",
              fontSize: "0.8125rem",
              whiteSpace: "nowrap",
            }}
          >
            {roundRingWords(ring)}
          </span>
        ) : (
          <span
            data-round-state={chip.chip}
            style={{
              minWidth: 0,
              padding: "1px 8px",
              borderRadius: 999,
              border: "1px solid var(--color-divider)",
              color: TONE_COLOUR[chip.tone],
              fontSize: "0.8125rem",
              whiteSpace: "nowrap",
            }}
          >
            {chip.chip}
          </span>
        )}
      </header>
      <div style={{ minWidth: 0 }}>{children}</div>
    </section>
  );
}
