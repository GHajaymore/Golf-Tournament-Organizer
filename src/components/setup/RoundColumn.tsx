import type { ReactNode } from "react";
import { roundRingWords, type RoundRing } from "@/lib/domain/round-ring";
import type { StatusRound } from "@/lib/domain/tournament-status";

/**
 * ONE ROUND'S COLUMN, as every redesigned screen draws its head (R1b): the round's name, then either
 * the needs ring ("2 of 3 set") or its state, then whatever the screen puts under it.
 *
 * It computes nothing. The ring is `roundRing`'s answer, passed in; `ring` is REQUIRED and null is the
 * caller saying "no ring here" (a screen that draws only the state passes null). It never reads a
 * round's `needs`: the count is made once, in `round-ring.ts`. Colours are `--color-*` tokens only;
 * every flex child has `min-width: 0` so the head wraps at 320px instead of pushing the page wide.
 */

export const ROUND_STATE_WORDS: Record<StatusRound["state"], string> = {
  "not-started": "Not started",
  "under-way": "Under way",
  closed: "Closed",
};

export interface RoundColumnProps {
  label: string;
  state: StatusRound["state"];
  /** `roundRing(round)`; null draws the state instead. */
  ring: RoundRing | null;
  children?: ReactNode;
}

export function RoundColumn({ label, state, ring, children }: RoundColumnProps) {
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
            data-round-state={state}
            style={{
              minWidth: 0,
              padding: "1px 8px",
              borderRadius: 999,
              border: "1px solid var(--color-divider)",
              color: "var(--color-text-muted)",
              fontSize: "0.8125rem",
              whiteSpace: "nowrap",
            }}
          >
            {ROUND_STATE_WORDS[state]}
          </span>
        )}
      </header>
      <div style={{ minWidth: 0 }}>{children}</div>
    </section>
  );
}
