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
  locked = false,
  embedded = false,
}: {
  /** Drawn inside another card (a round on Rounds & formats): no card of its own. */
  embedded?: boolean;
  mode: BracketMode;
  /** What the second bracket is currently called, or "" when there isn't one. */
  secondLabel: string;
  readOnly: boolean;
  /**
   * Setup is locked, which `setBracketMode` refuses — by THROWING, so a Change
   * button offered here took the page down to "Application error" on every
   * live knockout (walked 2026-09-27), under a sentence saying it was blocked.
   */
  locked?: boolean;
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
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
    });
  };

  return (
    // EMBEDDED on a round's card (Rounds & formats), it is not a card inside a card
    // (the UI/UX designer on the review panel); on the Bracket screen it still is.
    <div
      className={embedded ? undefined : "card elev-sm"}
      style={embedded ? { display: "flex", flexDirection: "column", gap: 8 } : { gap: 8, marginBottom: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {!embedded && <span className="card-kicker">Arrangement</span>}
        <span style={{ fontSize: 14, fontWeight: 500 }}>{current.label}</span>
        {/* Not where the name already says it: "Main + plate" then "+ Plate" said one thing twice. */}
        {secondLabel && !current.label.toLowerCase().includes(secondLabel.toLowerCase()) && (
          <span className="tag tag-neutral">+ {secondLabel}</span>
        )}
        {!readOnly && !locked && (
          <button
            type="button"
            className="btn btn-secondary"
            aria-expanded={open}
            // A 44px target: it was ~24px tall.
            style={{ marginLeft: "auto", padding: "2px 14px", fontSize: 13, minHeight: 44 }}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Done" : "Change"}
          </button>
        )}
      </div>
      {/* "Every qualifier in a single knockout. Lose and you're out." under "One bracket"
          says the name twice; the others' lines say something the name does not. */}
      {!(embedded && mode === "single") && <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>{current.blurb}</p>}
      {!readOnly && locked && (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Changing this redraws who plays whom, so it is locked while setup is. Unlock setup on{" "}
          <a href="/event">Tournament details</a> to change it.
        </p>
      )}

      {error && <p className="form-error">{error}</p>}

      {open && !readOnly && !locked && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", marginTop: 4 }}>
          {BRACKET_MODES.map((m) => {
            const active = m.key === mode;
            return (
              <button
                key={m.key}
                type="button"
                disabled={pending}
                // Which one is chosen, said to a screen reader as it is shown by the border.
                aria-pressed={active}
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
                <div className="text-muted" style={{ fontSize: 13, marginTop: 2, lineHeight: 1.4 }}>
                  {m.blurb}
                </div>
              </button>
            );
          })}
        </div>
      )}

    </div>
  );
}
