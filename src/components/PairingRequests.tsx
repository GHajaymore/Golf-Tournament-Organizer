"use client";
import { useState } from "react";
import { setPairingRequest } from "@/app/actions/pairing";
import { listNames } from "@/lib/format";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";
import { useAction } from "./useAction";

/**
 * The committee's list of pairing requests — "can I play with Bea?" — and the
 * one place to add one taken by phone or at the desk. Players can also ask for
 * themselves from their phone; both land here, and the draw below reads them.
 */
export function PairingRequests({
  field,
  pairs,
  splitOnSheet,
}: {
  /** The confirmed field, for the pickers. */
  field: { id: string; name: string }[];
  /** Each request once, whichever of the two made it. */
  pairs: { a: string; b: string }[];
  /** Requests the SAVED sheet splits — asked for after it was drawn. */
  splitOnSheet: string[][];
}) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const { pending, error, run } = useAction({ refresh: true });
  const nameOf = new Map(field.map((p) => [p.id, p.name]));
  // Alphabetical for the pickers — a field arrives in seed order, which nobody
  // scans for a name.
  const byName = [...field].sort((x, y) => x.name.localeCompare(y.name));
  /**
   * The form opens on a tap. Open by default it put an empty card and two
   * selects above the draw, and on a phone the groups — what the organizer
   * came to this screen for — fell below the fold (found by the website
   * session re-shooting the tee sheet, 2026-09-28).
   */
  const [adding, setAdding] = useState(false);

  if (pairs.length === 0 && splitOnSheet.length === 0 && !adding) {
    return (
      <section
        className="card elev-sm"
        style={{ marginBottom: 16, display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 14px" }}
        aria-labelledby="pairing-requests"
      >
        <span id="pairing-requests" style={{ flex: 1, minWidth: 0, fontSize: 14 }}>
          <Icon name="users-three" /> <strong>Pairing requests</strong>{" "}
          <span className="text-muted">— none yet. The draw keeps requests together where it can.</span>
        </span>
        <button type="button" className="btn btn-ghost" onClick={() => setAdding(true)}>
          Add a request
        </button>
      </section>
    );
  }

  return (
    <section className="card elev-sm" style={{ marginBottom: 16, gap: 10 }} aria-labelledby="pairing-requests">
      <div>
        <h2 id="pairing-requests" className="card-title" style={{ fontSize: 16, margin: 0 }}>
          <Icon name="users-three" /> Pairing requests
        </h2>
        <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          The draw keeps these together where it can (not on a draw by position). Players can ask from their
          phone.
        </p>
      </div>

      {splitOnSheet.length > 0 && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
          The saved sheet splits{" "}
          {splitOnSheet.map((c) => listNames(c.map((id) => nameOf.get(id) ?? ""), 6)).join("; ")} — asked for after it
          was drawn. Re-draw to keep them together.
        </p>
      )}

      {pairs.length === 0 ? (
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          No requests yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {pairs.map((r) => (
            <li key={`${r.a}-${r.b}`} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                {nameOf.get(r.a)} <span className="text-muted">with</span> {nameOf.get(r.b)}
              </span>
              <ConfirmButton
                disabled={pending}
                icon="x"
                title={`Remove ${nameOf.get(r.a) ?? ""} with ${nameOf.get(r.b) ?? ""}`}
                confirmLabel="Remove request"
                onConfirm={() => run(() => setPairingRequest(r.a, r.b, false))}
              />
            </li>
          ))}
        </ul>
      )}

      {!adding ? (
        <div>
          <button type="button" className="btn btn-ghost" onClick={() => setAdding(true)}>
            Add a request
          </button>
        </div>
      ) : (
      <form
        style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setPairingRequest(a, b, true), () => {
            setA("");
            setB("");
          });
        }}
      >
        <label style={{ display: "grid", gap: 4, fontSize: 13, minWidth: 0, flex: "1 1 140px" }}>
          Player
          <select className="input" value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">Choose…</option>
            {byName.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13, minWidth: 0, flex: "1 1 140px" }}>
          wants to play with
          <select className="input" value={b} onChange={(e) => setB(e.target.value)}>
            <option value="">Choose…</option>
            {byName
              .filter((p) => p.id !== a)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary" disabled={pending || !a || !b}>
          Add request
        </button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setAdding(false)}>
          Done
        </button>
      </form>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
