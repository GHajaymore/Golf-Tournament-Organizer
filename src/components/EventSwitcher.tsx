"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { switchEvent, createEvent, cloneEvent, deleteEvent } from "@/app/actions/tournament";
import { TOURNAMENT_TEMPLATES, templateFor, DEFAULT_TEMPLATE_KEY } from "@/lib/tournament-templates";
import { Icon } from "./Icon";

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
                            <Icon name="check" />
                          </button>
                          <button type="button" className="btn btn-icon" title="Cancel" onClick={() => setConfirmingId("")}>
                            <Icon name="x" />
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
                              <Icon name="trash" />
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
          <Icon name="plus" /> Create tournament
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>{blurb}</p>
      {error && <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>{error}</p>}

      {/* THE OTHER THING SOMEBODY COMES HERE TO MAKE, and until now the only
          screen offering it was one they could no longer reach.

          `/match/new` is "two people, one round, one screen", and it was
          linked from exactly one place: `/choose`. But `page.tsx` sends anyone
          with an active event straight to their landing screen, so once the
          first tournament exists that door only reopens through the ORG
          onboarding checklist — which disappears at 3 of 3. This screen is
          where a returning organizer goes to create anything, and every one of
          its six templates is a tournament.

          The cost of the gap is on the record: two abandoned draft events in
          the development database, five minutes apart, both with zero players
          and both with their round left on the default Round Robin. Somebody
          wanting one match against one person built a tournament twice and
          gave up. The option they wanted already existed.

          A LINK, not another form. The same argument as on /choose: what the
          match screen asks — two names, holes, whether shots are given —
          belongs together on one page, and half of it inline here would split
          the decision across two places again. */}
      <Link
        href="/match/new"
        className="card elev-sm"
        style={{
          marginTop: 4,
          display: "flex",
          // `.card` is `display: flex; flex-direction: column`, so setting
          // `display: flex` inline changes nothing and the row comes out as a
          // centred stack. Both cards on /choose had exactly this.
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          textDecoration: "none",
          color: "var(--color-text)",
          border: "1px solid var(--color-divider)",
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            flex: "none",
            display: "grid",
            placeItems: "center",
            borderRadius: 9,
            background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)",
          }}
        >
          <Icon name="sword" style={{ color: "var(--color-accent-2)", fontSize: 16 }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 15 }}>
            Just playing a match?
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
            Two players, one round, hole by hole. You don&rsquo;t need a tournament for this.
          </div>
        </div>
        <Icon
          name="arrow-right"
          style={{ color: "var(--color-accent-300)", marginLeft: "auto", flex: "none" }}
        />
      </Link>
    </div>
  );
}
