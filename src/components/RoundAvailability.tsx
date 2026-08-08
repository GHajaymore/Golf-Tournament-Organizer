"use client";
import { useState, useTransition } from "react";
import { setAttendance } from "@/app/actions/attendance";

export interface AvailabilityRound {
  stageId: string;
  label: string;
  /** ISO date, or "" for an open window. */
  optDeadline: string;
  /** The signed-in player's effective answer. */
  status: "in" | "out";
  /** Whether that answer was stated, or is the league's default. */
  explicit: boolean;
  /** True once the window has closed for players. */
  locked: boolean;
}

export interface CaptainFlightRow {
  playerId: string;
  name: string;
  status: "in" | "out";
  explicit: boolean;
}

export interface CaptainFlight {
  flightName: string;
  roundLabel: string;
  rows: CaptainFlightRow[];
}

/**
 * The weekly question, asked where a player already looks.
 *
 * One row per round: In / Out, the deadline, and — the honest part — whether
 * the current answer is theirs or just the league's default. "In (by
 * default)" and "In" are different promises, and a tee sheet built on the
 * difference deserves to show it.
 *
 * The captain's section is read-only on purpose. Seeing your flight's list
 * is an appointment; changing someone's answer stays between the player and
 * the committee, so the row shows who is in without offering a way to flip
 * anyone else.
 */
export function RoundAvailability({
  playerId,
  rounds,
  captainOf = [],
}: {
  /** The signed-in player's entry in this tournament. */
  playerId: string;
  rounds: AvailabilityRound[];
  /** Flights this player captains, resolved for the current round. */
  captainOf?: CaptainFlight[];
}) {
  const [byStage, setByStage] = useState<Record<string, "in" | "out">>(() =>
    Object.fromEntries(rounds.map((r) => [r.stageId, r.status])),
  );
  const [explicitByStage, setExplicitByStage] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rounds.map((r) => [r.stageId, r.explicit])),
  );
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const answer = (stageId: string, status: "in" | "out") => {
    setError("");
    const before = byStage[stageId];
    const beforeExplicit = explicitByStage[stageId];
    setByStage((m) => ({ ...m, [stageId]: status }));
    setExplicitByStage((m) => ({ ...m, [stageId]: true }));
    startTransition(async () => {
      const res = await setAttendance(stageId, playerId, status);
      if (!res.ok) {
        setByStage((m) => ({ ...m, [stageId]: before }));
        setExplicitByStage((m) => ({ ...m, [stageId]: beforeExplicit }));
        setError(res.error ?? "Couldn't save that.");
      }
    });
  };

  if (rounds.length === 0 && captainOf.length === 0) return null;

  return (
    <div className="card elev-sm" style={{ gap: 12 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Playing this week?</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.5 }}>
          Answer per round. After a round&rsquo;s sign-up deadline the organizer makes changes.
        </p>
      </div>

      {rounds.map((r) => {
        const status = byStage[r.stageId];
        const explicit = explicitByStage[r.stageId];
        return (
          <div
            key={r.stageId}
            style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
          >
            <span style={{ minWidth: 90, fontSize: 13, fontWeight: 500 }}>{r.label}</span>
            <div className="seg">
              <label className="seg-opt" style={{ opacity: r.locked ? 0.5 : 1 }}>
                <input
                  type="radio"
                  name={`avail-${r.stageId}`}
                  checked={status === "in"}
                  disabled={pending || r.locked}
                  onChange={() => answer(r.stageId, "in")}
                />
                In
              </label>
              <label className="seg-opt" style={{ opacity: r.locked ? 0.5 : 1 }}>
                <input
                  type="radio"
                  name={`avail-${r.stageId}`}
                  checked={status === "out"}
                  disabled={pending || r.locked}
                  onChange={() => answer(r.stageId, "out")}
                />
                Out
              </label>
            </div>
            {!explicit && (
              <span className="tag tag-neutral" style={{ fontSize: 10.5 }}>
                by default
              </span>
            )}
            <span className="text-muted" style={{ fontSize: 11.5 }}>
              {r.locked
                ? "Sign-up closed"
                : r.optDeadline
                  ? `Answer by ${r.optDeadline}`
                  : "Open"}
            </span>
          </div>
        );
      })}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      {captainOf.map((f) => (
        <div key={f.flightName + f.roundLabel} style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
          <span className="card-kicker">
            {f.flightName} — {f.roundLabel} (you&rsquo;re captain)
          </span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 4,
              marginTop: 6,
            }}
          >
            {f.rows.map((row) => (
              <span key={row.playerId} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                <i
                  className={row.status === "in" ? "ph ph-check-circle" : "ph ph-x-circle"}
                  style={{ color: row.status === "in" ? "var(--color-accent-2)" : "var(--color-neutral-500)" }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
                {!row.explicit && <span className="text-muted" style={{ fontSize: 10.5 }}>(default)</span>}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
