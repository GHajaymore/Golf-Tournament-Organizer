"use client";
import { useState, useTransition } from "react";
import { setThirdPlace, createThirdPlaceMatch } from "@/app/actions/tournament";
import { THIRD_PLACE_HELP } from "@/lib/domain/third-place";

/**
 * Whether this knockout plays off for third, and making the match.
 *
 * Off by default and stated as a choice rather than a checkbox nobody reads:
 * plenty of clubs send everyone to the bar instead, and the two beaten
 * semi-finalists are exactly the people least likely to want another match.
 *
 * The pairing is shown before it is committed, and the reason shown when it
 * cannot be — "waiting on the semi-finals" is the ordinary state right up
 * until the day, and an empty box there reads as something broken.
 */
export function ThirdPlaceControl({
  stageId,
  on,
  problem,
  aName,
  bName,
  made,
}: {
  stageId: string;
  on: boolean;
  /** Why there is no pairing yet. Empty when there is one. */
  problem: string;
  aName: string;
  bName: string;
  /** The play-off has already been created. */
  made: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError("");
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Couldn't do that.");
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => run(() => setThirdPlace(stageId, e.target.checked))}
          style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
        />
        <span>
          <span style={{ fontWeight: 500 }}>Play off for third</span>
          <span className="text-muted" style={{ display: "block", fontSize: 12, lineHeight: 1.6 }}>
            {THIRD_PLACE_HELP}
          </span>
        </span>
      </label>

      {on && (
        <div
          style={{
            padding: "9px 11px",
            borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
            fontSize: 12.5,
            lineHeight: 1.6,
          }}
        >
          {made ? (
            <span className="text-muted">
              <i className="ph ph-check-circle" /> The play-off is made — {aName} v {bName}. Enter its result on
              Score entry.
            </span>
          ) : problem ? (
            <span className="text-muted">
              <i className="ph ph-hourglass" /> {problem}
            </span>
          ) : (
            <>
              <strong>{aName} v {bName}</strong>
              <br />
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => run(() => createThirdPlaceMatch(stageId))}
                style={{ marginTop: 7 }}
              >
                <i className="ph ph-flag-checkered" /> Create the play-off
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
