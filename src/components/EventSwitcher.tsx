"use client";
import { useState, useTransition } from "react";
import { switchEvent, createEvent, cloneEvent, deleteEvent } from "@/app/actions/tournament";
import { TOURNAMENT_TEMPLATES, templateFor, DEFAULT_TEMPLATE_KEY } from "@/lib/tournament-templates";

/** Marks a "Start from" value as an event id rather than a template key, so the
 *  two namespaces can share one select without ever colliding. */
const COPY_PREFIX = "copy:";

export interface EventRow {
  id: string;
  name: string;
  status: string;
  dates: string;
  course: string;
  players: number;
  isActive: boolean;
  hasAccess: boolean;
  /** Organizer on this event — the bar for copying and deleting it. */
  isOrganizer: boolean;
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
  const [confirmingId, setConfirmingId] = useState("");
  // Deliberately defaults to a blank tournament even though copying is listed
  // first: anyone who clicks Create without reading gets exactly what that
  // button has always done, and copying stays a decision they made on purpose.
  const [source, setSource] = useState(DEFAULT_TEMPLATE_KEY);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // Only tournaments this person organizes. A copy is created inside the source
  // tournament's organization, so anything less than organizer would let a
  // player create events in a club they merely play in — cloneEvent rejects it
  // regardless, but the list shouldn't offer what the action refuses.
  const copyable = events.filter((e) => e.isOrganizer);
  const copyFrom = source.startsWith(COPY_PREFIX)
    ? copyable.find((e) => e.id === source.slice(COPY_PREFIX.length))
    : undefined;
  const blurb = copyFrom
    ? `Copies the settings, rounds and courses from ${copyFrom.name || "that tournament"} — never its players, scores or access codes. Dates start empty and everything stays editable.`
    : templateFor(source).blurb + " Every setting stays editable afterwards.";

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
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                      {confirmingId === e.id ? (
                        <>
                          <span className="text-muted" style={{ fontSize: 12 }}>Delete?</span>
                          <button type="button" className="btn btn-icon" title="Confirm delete" disabled={pending} style={{ color: "var(--color-accent)" }} onClick={() => startTransition(() => deleteEvent(e.id))}>
                            <i className="ph ph-check" />
                          </button>
                          <button type="button" className="btn btn-icon" title="Cancel" onClick={() => setConfirmingId("")}>
                            <i className="ph ph-x" />
                          </button>
                        </>
                      ) : (
                        <>
                          {e.isActive ? (
                            <span className="tag tag-outline">Managing</span>
                          ) : e.hasAccess ? (
                            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => startTransition(() => switchEvent(e.id))}>
                              Manage
                            </button>
                          ) : (
                            <span className="text-muted" style={{ fontSize: 12 }}>No access</span>
                          )}
                          {e.isOrganizer && (
                            <button type="button" className="btn btn-icon" title="Delete tournament" disabled={pending} onClick={() => setConfirmingId(e.id)}>
                              <i className="ph ph-trash" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
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
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label>Start from</label>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
            {copyable.length > 0 && (
              <optgroup label="Copy an existing tournament">
                {copyable.map((e) => (
                  <option key={e.id} value={`${COPY_PREFIX}${e.id}`}>{e.name || "Untitled"}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Start from a template">
              {TOURNAMENT_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>{t.name}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => {
            const copyId = source.startsWith(COPY_PREFIX) ? source.slice(COPY_PREFIX.length) : "";
            setError("");
            startTransition(async () => {
              const res = copyId ? await cloneEvent(copyId, name) : await createEvent(name, source);
              if (res && !res.ok) setError(res.error ?? "Could not create the tournament.");
            });
            setName("");
          }}
        >
          <i className="ph ph-plus" /> Create tournament
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>{blurb}</p>
      {error && <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>{error}</p>}
    </div>
  );
}
