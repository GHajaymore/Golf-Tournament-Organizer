"use client";
import { useState, useTransition } from "react";
import { createEvent } from "@/app/actions/tournament";

/**
 * Create-a-tournament step on the picker screen. Shown prominently when
 * someone has none yet (straight after sign-up), and as a secondary action
 * once they do.
 */
export function CreateFirstTournament({ first }: { first: boolean }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(first);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!name.trim()) return;
    startTransition(() => createEvent(name));
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
