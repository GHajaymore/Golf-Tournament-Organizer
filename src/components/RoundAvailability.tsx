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

export interface CaptainFlightCell {
  stageId: string;
  status: "in" | "out";
  /** Whether that answer was stated, or is the league's default. */
  explicit: boolean;
}

export interface CaptainFlightRow {
  playerId: string;
  name: string;
  /** One cell per round, in the same order as the flight's `rounds`. */
  cells: CaptainFlightCell[];
}

/**
 * A flight a player captains, across every round still to be played.
 *
 * This was one round wide — the current one — while the player's own view
 * below it already spanned the season. A captain working out who they can
 * field needs the weeks together: three players out on the same night is the
 * thing worth spotting, and it is invisible one round at a time.
 *
 * Read-only by design. Captains do not set other players' availability;
 * that stays with the organizer, from whatever the captain tells them.
 */
export interface CaptainFlight {
  flightName: string;
  rounds: { stageId: string; label: string }[];
  rows: CaptainFlightRow[];
  /** True when this player deputises rather than captains. */
  deputy?: boolean;
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
        <div key={f.flightName} style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
          <span className="card-kicker">
            {f.flightName} (you&rsquo;re {f.deputy ? "vice-captain" : "captain"})
          </span>
          <p className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 8px", lineHeight: 1.5 }}>
            Who your side has available, week by week. To change someone&rsquo;s answer, ask
            the organizer &mdash; captains don&rsquo;t set other players&rsquo; availability.
          </p>
          {/* A table, because this is a grid of two variables — who, and which
              week — and any other shape makes the reader hold one of them in
              their head. It scrolls sideways rather than squeezing the names. */}
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 260 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Player</th>
                  {f.rounds.map((r) => (
                    <th key={r.stageId} style={{ textAlign: "center", whiteSpace: "nowrap" }}>{r.label}</th>
                  ))}
                  <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>In</th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((row) => (
                  <tr key={row.playerId}>
                    <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
                      {row.name}
                    </td>
                    {row.cells.map((c) => (
                      <td key={c.stageId} style={{ textAlign: "center" }}>
                        <i
                          className={c.status === "in" ? "ph ph-check-circle" : "ph ph-x-circle"}
                          style={{ color: c.status === "in" ? "var(--color-accent-2)" : "var(--color-neutral-500)" }}
                          // The distinction the whole feature turns on: "in"
                          // and "in because nobody said otherwise" are
                          // different promises, and a captain counting heads
                          // deserves to know which one they are looking at.
                          title={`${c.status === "in" ? "In" : "Out"}${c.explicit ? "" : " (by default)"}`}
                          aria-label={`${c.status === "in" ? "In" : "Out"}${c.explicit ? "" : " by default"}`}
                        />
                        {/* 10.5, not 9.5. Nothing in this app should be set
                            below ten: it is read on a phone, outdoors, by
                            people who mostly do not have young eyes. */}
                        {!c.explicit && (
                          <span className="text-muted" style={{ fontSize: 10.5, display: "block", lineHeight: 1 }}>
                            default
                          </span>
                        )}
                      </td>
                    ))}
                    <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {row.cells.filter((c) => c.status === "in").length}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 500 }}>Available</td>
                  {f.rounds.map((r, i) => {
                    const n = f.rows.filter((row) => row.cells[i]?.status === "in").length;
                    return (
                      <td
                        key={r.stageId}
                        style={{ textAlign: "center", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}
                      >
                        {n}
                      </td>
                    );
                  })}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
