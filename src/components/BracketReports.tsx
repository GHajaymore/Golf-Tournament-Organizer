"use client";
import { useState, useTransition } from "react";
import { approveBracketReport, rejectBracketReport } from "@/app/actions/tournament";

export interface BracketReportRow {
  key: string;
  /** "Semi-finals", with the draw's name when there are two ("Plate · Final"). */
  round: string;
  a: string;
  b: string;
  winner: string;
  result: string;
  reportedBy: string;
}

/**
 * RESULTS PLAYERS HAVE REPORTED, waiting on staff (Ajay, 2026-09-28: "player
 * may enter it but organizer/club needs to approve it").
 *
 * Above the draw, because it is the thing on this screen that is waiting on
 * somebody. Approving records the result exactly as clicking the winner on the
 * draw would, margin included; turning it down leaves the tie open.
 */
export function BracketReports({ rows }: { rows: BracketReportRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  if (rows.length === 0) return null;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't save. Try again.");
    });
  };

  return (
    <section className="card elev-sm" style={{ marginBottom: 20 }} aria-labelledby="reported-results">
      <h2 id="reported-results" className="card-title" style={{ fontSize: 16, margin: 0 }}>
        {rows.length === 1 ? "A result to approve" : `${rows.length} results to approve`}
      </h2>
      <p className="text-muted" style={{ margin: "4px 0 12px", fontSize: 13 }}>
        Reported by a player in the tie. Nothing moves on the draw until you approve it.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {rows.map((r) => (
          <li
            key={r.key}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--color-divider)",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>{r.round}</div>
              <div style={{ fontSize: 15 }}>
                {r.a} v {r.b}: <strong>{r.winner}</strong> won{r.result ? ` ${r.result}` : ""}
              </div>
              <div style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>Reported by {r.reportedBy}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                aria-label={`Approve: ${r.winner} won ${r.a} v ${r.b}`}
                onClick={() => act(() => approveBracketReport(r.key))}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending}
                aria-label={`Turn down the report of ${r.a} v ${r.b}`}
                onClick={() => act(() => rejectBracketReport(r.key))}
              >
                Turn down
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
