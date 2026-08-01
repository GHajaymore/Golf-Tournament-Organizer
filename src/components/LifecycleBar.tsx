"use client";
import { useState, useTransition } from "react";
import { setEventStatus, launchTournament, setConfigUnlocked } from "@/app/actions/tournament";

export interface LifecycleSummary {
  name: string;
  dates: string;
  course: string;
  format: string;
  players: number;
  flights: number;
  rounds: number;
}

const STATUS_META: Record<string, { label: string; tag: string }> = {
  draft: { label: "Draft", tag: "tag-neutral" },
  registration: { label: "Registration open", tag: "tag-accent" },
  ready: { label: "Ready to launch", tag: "tag-accent" },
  live: { label: "Live", tag: "tag-accent-2" },
  completed: { label: "Completed", tag: "tag-neutral" },
};

export function LifecycleBar({
  status,
  isAdmin,
  configUnlocked,
  summary,
}: {
  status: string;
  isAdmin: boolean;
  configUnlocked: boolean;
  summary: LifecycleSummary;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const locked = (status === "live" || status === "completed") && !configUnlocked;

  const next = () => {
    if (status === "draft") return { label: "Open registration", run: () => setEventStatus("registration") };
    if (status === "registration") return { label: "Mark ready", run: () => setEventStatus("ready") };
    if (status === "ready") return { label: "Launch tournament", run: null }; // opens modal
    if (status === "live") return { label: "Complete tournament", run: () => setEventStatus("completed") };
    return null;
  };
  const action = next();

  return (
    <>
      <div
        className="card elev-sm"
        style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}
      >
        <span className="card-kicker">Tournament status</span>
        <span className={`tag ${meta.tag}`} style={{ fontSize: 12 }}>
          {status === "live" && <i className="ph-fill ph-circle" style={{ fontSize: 7, marginRight: 5 }} />}
          {meta.label}
        </span>
        {locked && (
          <span className="text-muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <i className="ph ph-lock-simple" /> Configuration locked
          </span>
        )}
        <div style={{ flex: 1 }} />
        {isAdmin && action && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() =>
              action.run ? startTransition(action.run) : setConfirming(true)
            }
          >
            {status === "ready" && <i className="ph ph-rocket-launch" />} {action.label}
          </button>
        )}
        {isAdmin && (status === "live" || status === "completed") && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => startTransition(() => setConfigUnlocked(!configUnlocked))}
          >
            <i className={configUnlocked ? "ph ph-lock-simple" : "ph ph-lock-simple-open"} />{" "}
            {configUnlocked ? "Lock configuration" : "Unlock configuration"}
          </button>
        )}
      </div>

      {confirming && (
        <div className="dialog-backdrop" onClick={() => setConfirming(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Launch “{summary.name}”?</div>
            <div className="dialog-body">
              Once launched, registered participants receive Player access and can view their schedule,
              matches, scorecards, leaderboard and tournament information. Critical configuration locks
              (you can unlock it later).
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  ["Dates", summary.dates || "—"],
                  ["Course", summary.course || "—"],
                  ["Format", summary.format === "stroke" ? "Stroke play" : "Match play"],
                  ["Registered players", String(summary.players)],
                  ["Flights", String(summary.flights)],
                  ["Rounds", String(summary.rounds)],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid var(--color-divider)", paddingBottom: 4 }}>
                    <span className="text-muted">{k}</span>
                    <span style={{ fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await launchTournament();
                    setConfirming(false);
                  })
                }
              >
                <i className="ph ph-rocket-launch" /> Launch tournament
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
