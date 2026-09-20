import { resultSummary, type OutingLine } from "@/lib/domain/tournament-result";
import { resultHeading } from "@/lib/domain/play-kind";

/**
 * WHAT HAPPENED, ROUND BY ROUND — the day's result, headed with whatever the
 * club calls this one ("Outing result", "League result").
 *
 * ONE COMPONENT, TWO PLACES. The board shows it above the standings, and the
 * board's REFUSAL branch shows it too — a team round or a round scored by hand
 * has no player ranking, which is precisely the day whose result a member
 * cannot work out for themselves. Rendering it from one component is what
 * stops those two reading differently, which is the fault this app keeps
 * finding in itself.
 *
 * Nothing at all for a single-round tournament: the board underneath IS the
 * result, and a card repeating it would be the same fact twice.
 */
export function ResultLines({ lines, kind }: { lines: OutingLine[]; kind: string }) {
  if (lines.length < 2) return null;

  return (
    <section className="card elev-sm" style={{ margin: "14px 0" }}>
      <span className="card-title" style={{ fontSize: 15 }}>
        {resultHeading(kind)}
      </span>
      <span className="text-muted" style={{ fontSize: 12.5 }}>
        {resultSummary(lines)}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {lines.map((l) => (
          <div key={l.label} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span className="text-muted" style={{ fontSize: 12, minWidth: 92, flex: "none" }}>
              {l.label}
            </span>
            <span
              style={{
                fontSize: 13.5,
                lineHeight: 1.5,
                color: l.settled ? "var(--color-text)" : "var(--color-text-muted)",
              }}
            >
              {l.result}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
