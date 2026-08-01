"use client";
import { useState, useTransition } from "react";
import { switchEvent, createEvent } from "@/app/actions/tournament";

export interface EventRow {
  id: string;
  name: string;
  status: string;
  dates: string;
  course: string;
  players: number;
  isActive: boolean;
  hasAccess: boolean;
}

const STATUS: Record<string, { label: string; tag: string }> = {
  draft: { label: "Draft", tag: "tag-neutral" },
  registration: { label: "Registration", tag: "tag-accent" },
  ready: { label: "Ready", tag: "tag-accent" },
  live: { label: "Live", tag: "tag-accent-2" },
  completed: { label: "Completed", tag: "tag-neutral" },
};

export function EventSwitcher({ events }: { events: EventRow[] }) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="card-title" style={{ fontSize: 15 }}>Your tournaments</span>
        <span className="text-muted" style={{ fontSize: 12 }}>{events.length} total</span>
      </div>

      <div className="table-scroll">
        <table className="table" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>Tournament</th>
              <th>Status</th>
              <th>Course</th>
              <th style={{ textAlign: "right" }}>Players</th>
              <th style={{ width: 120 }} />
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const s = STATUS[e.status] ?? STATUS.draft;
              return (
                <tr key={e.id} style={e.isActive ? { background: "var(--color-accent-900)" } : undefined}>
                  <td style={{ fontWeight: 500 }}>
                    {e.name || "Untitled"}
                    <div className="text-muted" style={{ fontSize: 11 }}>{e.dates || "No dates set"}</div>
                  </td>
                  <td><span className={`tag ${s.tag}`}>{s.label}</span></td>
                  <td className="text-muted">{e.course || "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.players}</td>
                  <td style={{ textAlign: "right" }}>
                    {e.isActive ? (
                      <span className="tag tag-outline">Managing</span>
                    ) : e.hasAccess ? (
                      <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => startTransition(() => switchEvent(e.id))}>
                        Manage
                      </button>
                    ) : (
                      <span className="text-muted" style={{ fontSize: 12 }}>No access</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid var(--color-divider)", paddingTop: 12, marginTop: 4 }}>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label>Create a new tournament</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Club Championship 2026" />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => {
            startTransition(() => createEvent(name));
            setName("");
          }}
        >
          <i className="ph ph-plus" /> Create tournament
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
        A new tournament starts empty (Draft, one Round Robin round) — the whole workflow below shows the tournament you're managing.
      </p>
    </div>
  );
}
