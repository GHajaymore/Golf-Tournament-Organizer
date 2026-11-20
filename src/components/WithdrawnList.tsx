"use client";
import { useState, useTransition } from "react";
import { reinstateWithdrawn } from "@/app/actions/tournament";
import { Icon } from "./Icon";

/**
 * WHO WITHDREW, AND PUT BACK (day-of field changes, PR A).
 *
 * The list was the server page's own (2026-10-09, grid cell T45): removing a
 * player who had played kept them as withdrawn, and then they were on no list
 * on the page. Now every confirmed player withdrawn after launch is kept here
 * too, and a mistaken tap on the morning is undone in place — before this,
 * only a disqualification could be. Put back follows the one field rule
 * (`reinstate`), open to an Assistant as well as the Organizer until the
 * tournament is completed; `door` is that rule's refusal, or null.
 */
export function WithdrawnList({
  withdrawn,
  door,
}: {
  withdrawn: Array<{ id: string; name: string }>;
  /** Why nobody can be put back now (`fieldDoors(…).reinstate`), or null. */
  door: string | null;
}) {
  const [said, setSaid] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // The last one put back empties the list; what Put back did is still said.
  if (withdrawn.length === 0) {
    return said ? (
      <p role="status" className="card elev-sm" style={{ marginTop: 16, fontSize: 14 }}>
        {said}
      </p>
    ) : null;
  }

  const putBack = (p: { id: string; name: string }) =>
    startTransition(async () => {
      const res = await reinstateWithdrawn(p.id);
      if (res.ok) {
        setError("");
        setSaid(res.said);
      } else {
        setSaid("");
        setError(`${p.name}: ${res.error}`);
      }
    });

  return (
    <section
      aria-label="Withdrawn"
      className="card elev-sm"
      style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <span className="card-title">Withdrawn ({withdrawn.length})</span>
      <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
        Out of the field. Their scores and side-game entries stay on the record; a player who had begun shows as WD at
        the foot of the board, and one who had not as DNS on the results. Put back undoes a withdrawal made by mistake.
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {withdrawn.map((p) => (
          <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 14, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ minHeight: 44, fontSize: 13 }}
              disabled={pending || !!door}
              onClick={() => putBack(p)}
            >
              <Icon name="arrow-counter-clockwise" /> Put back
            </button>
          </li>
        ))}
      </ul>
      {door && <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{door}</p>}
      {said && (
        <p role="status" style={{ margin: 0, fontSize: 13 }}>
          {said}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" style={{ margin: 0 }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}
