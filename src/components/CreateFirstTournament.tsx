"use client";
import { useState, useTransition } from "react";
import { createEvent } from "@/app/actions/tournament";
import { TOURNAMENT_TEMPLATES, templateFor, DEFAULT_TEMPLATE_KEY } from "@/lib/tournament-templates";
import { TOURNAMENT_SHAPES, DEFAULT_SHAPE, type TournamentShape } from "@/lib/tournament-shape";
import { retentionNotice, planFor } from "@/lib/plans";

/**
 * Create-a-tournament step on the picker screen. Shown prominently when
 * someone has none yet (straight after sign-up), and as a secondary action
 * once they do.
 */
export function CreateFirstTournament({
  first,
  plan = "free",
}: {
  first: boolean;
  /** The organization's plan, so the retention term shown is the real one. */
  plan?: string;
}) {
  const retention = retentionNotice(plan);
  const planName = planFor(plan).name;
  const [name, setName] = useState("");
  const [open, setOpen] = useState(first);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE_KEY);
  const [shape, setShape] = useState<TournamentShape>(DEFAULT_SHAPE);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      await createEvent(name, template, shape);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary"
        style={{ alignSelf: "flex-start", marginTop: 18 }}
      >
        <i className="ph ph-plus" /> Create another tournament
      </button>
    );
  }

  return (
    <div className="card elev-sm" style={{ gap: 12, marginTop: first ? 0 : 18 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>
          {first ? "Organizing an event?" : "Create a tournament"}
        </span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Just a name to start — dates, course, format and field all come next, and can be changed any time.
        </p>
      </div>
      <div className="field">
        <label>Tournament name</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. Club Championship 2026"
          autoFocus
        />
      </div>
      {/* Asked before anything else, because it decides what the rest of setup
          is even about: a single round has no next round to carry into, and a
          knockout has a bracket where a league has none. */}
      <div className="field">
        <label>How is it played?</label>
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {TOURNAMENT_SHAPES.map((s) => {
            const active = s.key === shape;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setShape(s.key)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  color: "var(--color-text)",
                  background: active
                    ? "color-mix(in srgb, var(--color-accent) 14%, transparent)"
                    : "var(--color-bg)",
                  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-divider)"}`,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>
                  {s.blurb}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <label>What kind of tournament?</label>
        <select className="input" value={template} onChange={(e) => setTemplate(e.target.value)}>
          {TOURNAMENT_TEMPLATES.map((t) => (
            <option key={t.key} value={t.key}>{t.name}</option>
          ))}
        </select>
        <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
          {templateFor(template).blurb} Every setting stays editable afterwards.
        </p>
      </div>
      {/* Said before the tournament exists, not after it finishes. A club that
          loses its member-guest results the next morning was not warned
          enough, and burying this in a settings screen would be the same as
          not saying it. */}
      {retention && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 8,
            background: "var(--color-danger-bg)",
            border: "1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)",
          }}
        >
          <i className="ph ph-warning-circle" style={{ color: "var(--color-danger)", fontSize: 15, marginTop: 1 }} />
          <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>
            <b>On the {planName} plan:</b> {retention}
          </p>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={pending || !name.trim()} onClick={submit}>
          {pending ? "Creating…" : "Create tournament"} <i className="ph ph-arrow-right" />
        </button>
        {!first && (
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
