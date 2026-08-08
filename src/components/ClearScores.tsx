"use client";
import { useState, useTransition } from "react";
import { clearRoundScores } from "@/app/actions/tournament";

/**
 * Clear a round's scores — a selection, or all of them.
 *
 * Deliberately not a row of delete buttons. Wiping scores is the one action
 * on this screen with no undo, and the thing that makes it safe is not a
 * confirmation dialog — people dismiss those — but saying precisely what is
 * about to go and what is not.
 *
 * What survives is the part organizers actually fear losing: registrations,
 * flights, pairings and tee times. A round can be re-scored from scratch
 * without rebuilding the draw, and the panel says so before anyone commits.
 */
export function ClearScores({
  stageId,
  roundLabel,
  players,
  onClose,
}: {
  stageId: string;
  roundLabel: string;
  players: Array<{ id: string; name: string }>;
  /** Closes the panel; the entry screen owns whether it is shown. */
  onClose?: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const all = picked.size === 0;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = () => {
    setError("");
    startTransition(async () => {
      const res = await clearRoundScores(stageId, [...picked]);
      if (!res.ok) {
        setError(res.error ?? "Couldn't clear those scores.");
        return;
      }
      setDone(res.cleared);
      setPicked(new Set());
      setConfirming(false);
    });
  };

  return (
    <div className="card elev-sm" style={{ gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Clear scores — {roundLabel}</span>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: "3px 9px" }}
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            setPicked(new Set());
            onClose?.();
          }}
        >
          Close
        </button>
      </div>

      <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.5, maxWidth: "70ch" }}>
        Removes cards and match results for this round only. <strong>Registrations, flights, pairings and
        tee times are untouched</strong> — the draw stays exactly as it is, so the round can simply be
        scored again.
      </p>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {all ? "Everyone in the round" : `${picked.size} selected`}
          </span>
          {!all && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 11.5, padding: "2px 8px" }}
              disabled={pending}
              onClick={() => setPicked(new Set())}
            >
              Clear selection
            </button>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 4,
            maxHeight: 200,
            overflow: "auto",
            padding: 2,
          }}
        >
          {players.map((p) => (
            <label
              key={p.id}
              style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={picked.has(p.id)}
                disabled={pending}
                onChange={() => toggle(p.id)}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
            </label>
          ))}
        </div>
        <p className="text-muted" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
          Select nobody to clear the whole round.
        </p>
      </div>

      {error && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      {done !== null && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-accent-2-400)" }}>
          <i className="ph ph-check" /> Cleared {done} card{done === 1 ? "" : "s"}.
        </p>
      )}

      {/* The second press is the confirmation. A dialog gets dismissed on
          reflex; a button that changes what it says has to be read. */}
      {confirming ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            style={{
              fontSize: 12.5,
              color: "var(--color-danger)",
              borderColor: "color-mix(in srgb, var(--color-danger) 50%, transparent)",
            }}
            disabled={pending}
            onClick={run}
          >
            <i className="ph ph-trash" />{" "}
            {pending
              ? "Clearing…"
              : all
                ? `Yes — clear every score in ${roundLabel}`
                : `Yes — clear ${picked.size} player${picked.size === 1 ? "" : "s"}`}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12.5 }}
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 12.5, alignSelf: "flex-start" }}
          disabled={pending || players.length === 0}
          onClick={() => {
            setDone(null);
            setConfirming(true);
          }}
        >
          <i className="ph ph-eraser" /> {all ? "Clear the whole round" : `Clear ${picked.size} selected`}
        </button>
      )}
    </div>
  );
}
