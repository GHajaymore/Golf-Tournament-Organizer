"use client";
import { useState, useTransition } from "react";
import { setBracketMode } from "@/app/actions/tournament";
import { BRACKET_MODES, type BracketMode } from "@/lib/domain/bracket";

/**
 * How the knockout is arranged.
 *
 * Sits behind a disclosure rather than in the page: most organizers pick a
 * shape once and never look at it again, and a control that changes who plays
 * whom shouldn't be the first thing on a screen people open to read results.
 */
export function BracketModePicker({
  mode,
  secondLabel,
  readOnly,
}: {
  mode: BracketMode;
  /** What the second bracket is currently called, or "" when there isn't one. */
  secondLabel: string;
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const current = BRACKET_MODES.find((m) => m.key === mode) ?? BRACKET_MODES[1];

  const choose = (next: BracketMode) => {
    if (next === mode) return;
    setError("");
    startTransition(async () => {
      const res = await setBracketMode(next);
      if (!res.ok && res.error) setError(res.error);
    });
  };

  return (
    <div className="card elev-sm" style={{ gap: 8, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="card-kicker">Arrangement</span>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{current.label}</span>
        {secondLabel && <span className="tag tag-neutral">+ {secondLabel}</span>}
        {!readOnly && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginLeft: "auto", padding: "2px 10px", fontSize: 12 }}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Done" : "Change"}
          </button>
        )}
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>{current.blurb}</p>

      {error && <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>{error}</p>}

      {open && !readOnly && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", marginTop: 4 }}>
          {BRACKET_MODES.map((m) => {
            const active = m.key === mode;
            return (
              <button
                key={m.key}
                type="button"
                disabled={pending}
                onClick={() => choose(m.key)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: active ? "default" : "pointer",
                  color: "var(--color-text)",
                  background: active
                    ? "color-mix(in srgb, var(--color-accent) 14%, transparent)"
                    : "var(--color-bg)",
                  border: `1px solid ${
                    active ? "var(--color-accent)" : "var(--color-divider)"
                  }`,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{m.label}</div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>
                  {m.blurb}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {open && !readOnly && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Changing this redraws who plays whom, so it&apos;s blocked once the tournament is locked.
        </p>
      )}
    </div>
  );
}
