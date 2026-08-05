"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { addMembersToEvent } from "@/app/actions/roster";
import type { RosterCandidate } from "@/lib/services/roster";

/**
 * Fill a field from the club roster.
 *
 * The point of a roster is that the second tournament of a season shouldn't
 * mean retyping the first one's field — so this sits above the manual add form
 * and is the fastest path in: search, tick, add.
 */
export function RosterPicker({
  candidates,
  eventName,
  locked,
}: {
  candidates: RosterCandidate[];
  eventName: string;
  locked: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const available = candidates.filter((c) => !c.entered);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.memberNumber.toLowerCase().includes(q),
    );
  }, [available, query]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  const add = () => {
    setError("");
    setResult("");
    const ids = [...selected];
    if (ids.length === 0) return;
    startTransition(async () => {
      const r = await addMembersToEvent(ids);
      if (!r.ok) {
        setError(r.error ?? "Couldn't add those members.");
        return;
      }
      const bits = [`Added ${r.added}`];
      if (r.waitlisted) bits.push(`${r.waitlisted} waitlisted`);
      if (r.skipped) bits.push(`${r.skipped} already in the field`);
      setResult(`${bits.join(" · ")}.`);
      setSelected(new Set());
    });
  };

  return (
    <div className="card elev-sm" style={{ gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Add from the club roster</span>
        <Link href="/roster" className="text-muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          Manage members <i className="ph ph-arrow-right" />
        </Link>
      </div>

      {candidates.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          The roster is empty. Everyone you add below — or import by CSV — joins it automatically, so next
          season&rsquo;s field is a few clicks rather than a retype.
        </p>
      ) : available.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Every active member is already in this field.
        </p>
      ) : (
        <>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${available.length} member${available.length === 1 ? "" : "s"}…`}
          />

          <label
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}
            className="text-muted"
          >
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((c) => c.id)))}
            />
            Select all {query.trim() ? "matching" : ""}
          </label>

          <div
            style={{
              maxHeight: 240,
              overflowY: "auto",
              border: "1px solid var(--color-divider)",
              borderRadius: "var(--radius-md)",
            }}
          >
            {visible.map((c) => (
              <label
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  fontSize: 13,
                  borderBottom: "1px solid var(--color-divider)",
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.name}
                  {c.memberNumber && (
                    <span className="text-muted" style={{ fontSize: 11, marginLeft: 5 }}>#{c.memberNumber}</span>
                  )}
                </span>
                <span className="text-muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                  {c.handicap}
                  {c.handicapType === "9" ? " (9)" : ""}
                </span>
              </label>
            ))}
            {visible.length === 0 && (
              <p className="text-muted" style={{ fontSize: 12, margin: 0, padding: "10px" }}>
                No members match that search.
              </p>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={pending || locked || selected.size === 0}
            onClick={add}
          >
            <i className="ph ph-user-plus" />{" "}
            {pending
              ? "Adding…"
              : selected.size === 0
                ? `Add to ${eventName}`
                : `Add ${selected.size} ${selected.size === 1 ? "member" : "members"} to ${eventName}`}
          </button>
        </>
      )}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger, #e0665a)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      {result && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          <i className="ph ph-check-circle" style={{ color: "var(--color-accent-2-300)" }} /> {result}
        </p>
      )}
    </div>
  );
}
