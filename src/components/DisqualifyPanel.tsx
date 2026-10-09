"use client";
import { useId, useState, useTransition } from "react";
import { disqualifyPlayer, reinstatePlayer } from "@/app/actions/disqualify";
import { ConfirmButton } from "./ConfirmButton";

/**
 * The committee's ruling: disqualify a player, with the reason on the record,
 * or reinstate one ruled out in error (2026-10-08).
 *
 * Its own panel rather than a button in the field table, because the table's
 * controls are behind the setup lock and a ruling is made while the
 * tournament is live — exactly when the lock is on. Staff only; the page
 * decides whether to render it.
 */
export function DisqualifyPanel({
  field,
  disqualified,
  league = false,
}: {
  /**
   * A season of weekly rounds (2026-10-08). There, each week is its own
   * competition: a DQ for one week's card is no score THAT week, not removal
   * from the season — which is what this does. Said before anybody presses it,
   * with the per-week remedy, rather than discovered on the season table.
   */
  league?: boolean;
  /** Players still in the field, who may be ruled out. */
  field: Array<{ id: string; name: string }>;
  /** Players already disqualified, who may be reinstated. */
  disqualified: Array<{ id: string; name: string }>;
}) {
  const fid = useId();
  const [playerId, setPlayerId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const chosen = field.find((p) => p.id === playerId);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setError("");
        after?.();
      } else setError(res.error);
    });

  return (
    <section className="card elev-sm" style={{ marginTop: 16, gap: 10 }} aria-labelledby={`${fid}-title`}>
      <span id={`${fid}-title`} className="card-title" style={{ fontSize: 15 }}>
        Disqualification
      </span>
      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
        A disqualified player has no score for the competition. They show as DQ at the foot of every board, keep
        no place, and leave the field and any pot not yet settled. Their cards stay on the record.
      </p>
      {league && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-warning)", fontWeight: 600 }}>
          This is a league: disqualifying here takes them out of the whole season. For one week&rsquo;s card,
          empty that week&rsquo;s card on Score entry instead — they score nothing for that week, as if they
          had missed it.
        </p>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label htmlFor={`${fid}-player`}>Player</label>
          <select
            id={`${fid}-player`}
            className="input"
            value={playerId}
            disabled={pending}
            onChange={(e) => setPlayerId(e.target.value)}
          >
            <option value="">Choose a player</option>
            {field.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 2, minWidth: 200 }}>
          <label htmlFor={`${fid}-reason`}>Reason (goes on the record)</label>
          <input
            id={`${fid}-reason`}
            className="input"
            value={reason}
            maxLength={200}
            disabled={pending}
            placeholder="e.g. Returned a score lower than actually taken (Rule 3.3b)"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <ConfirmButton
          className="btn btn-secondary touch-target"
          icon="flag"
          label="Disqualify"
          title={chosen ? `Disqualify ${chosen.name}` : "Disqualify"}
          confirmLabel="Disqualify"
          note={chosen ? `${chosen.name} will show as DQ with no place.` : undefined}
          disabled={pending || !chosen || !reason.trim()}
          onConfirm={() =>
            run(
              () => disqualifyPlayer(playerId, reason),
              () => {
                setPlayerId("");
                setReason("");
              },
            )
          }
        />
      </div>
      {error && (
        <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
      {disqualified.length > 0 && (
        <ul aria-label="Disqualified" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {disqualified.map((p) => (
            <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
              <span style={{ minWidth: 0 }}>
                <strong>DQ</strong> · {p.name}
              </span>
              <ConfirmButton
                className="btn btn-secondary touch-target"
                icon="arrow-counter-clockwise"
                label="Reinstate"
                title={`Reinstate ${p.name}`}
                confirmLabel="Reinstate"
                note={`${p.name} returns to the field with every card they returned.`}
                disabled={pending}
                onConfirm={() => run(() => reinstatePlayer(p.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
