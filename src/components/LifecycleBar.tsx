"use client";
import { useState, useTransition } from "react";
import { setEventStatus, launchTournament, setConfigUnlocked } from "@/app/actions/tournament";
import { STATUS_META } from "@/lib/format";
import { lifecycleMismatch } from "@/lib/domain/lifecycle-state";
import { Icon } from "./Icon";

export interface LifecycleSummary {
  name: string;
  dates: string;
  course: string;
  format: string;
  players: number;
  flights: number;
  rounds: number;
}

export function LifecycleBar({
  status,
  isAdmin,
  configUnlocked,
  summary,
  matchesScored = 0,
  blockedReason,
}: {
  status: string;
  isAdmin: boolean;
  configUnlocked: boolean;
  summary: LifecycleSummary;
  /** Results recorded so far, so the status can be checked against reality. */
  matchesScored?: number;
  /**
   * Why the next phase cannot be entered yet, or undefined when it can.
   *
   * Computed on the server from `phase-gate.ts`, so the button and the action
   * refuse for the same reason in the same words. The action refuses anyway —
   * a disabled button stops nobody, and a `"use server"` export is a public
   * HTTP endpoint — but an organizer should not have to press a thing to find
   * out it will not work.
   */
  blockedReason?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  /**
   * What the server said when it refused.
   *
   * Kept even though the button is disabled ahead of time: the two are
   * computed from separate reads a moment apart, so a card submitted while the
   * page sat open is exactly the case where the button is live and the answer
   * is still no. Silence there would read as a click that did nothing.
   */
  const [refused, setRefused] = useState("");
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const locked = (status === "live" || status === "completed") && !configUnlocked;
  const mismatch = lifecycleMismatch({ status, matchesScored, playersEntered: summary.players });

  const next = () => {
    /**
     * "Start taking entries", not "Open registration".
     *
     * This moves the tournament to the `registration` PHASE. It publishes no
     * sign-up link and does not change what `registrationStatus` decides — so
     * the old label promised the one thing it did not do, while two other
     * controls a few inches away used the same word for the public link and
     * for accepting entries. Three things, one word.
     *
     * Ajay's call, 2026-08-21: the phase takes a different word and
     * "registration" is left meaning the public sign-up link, which is what it
     * means to a player. Renamed rather than made to publish a link too —
     * that would change behaviour for every existing tournament and put a
     * public form live for an organizer who only moved a phase.
     */
    if (status === "draft") return { label: "Start taking entries", run: () => setEventStatus("registration") };
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
          {status === "live" && <Icon name="circle" weight="fill" style={{ fontSize: 7, marginRight: 5 }} />}
          {meta.label}
        </span>
        {locked && (
          <span className="text-muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="lock-simple" /> Configuration locked
          </span>
        )}
        <div style={{ flex: 1 }} />
        {isAdmin && action && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !!blockedReason}
            // The reason travels with the control, so a disabled button is
            // never a dead end somebody has to guess at.
            title={blockedReason}
            onClick={() => {
              setRefused("");
              if (!action.run) {
                setConfirming(true);
                return;
              }
              const run = action.run;
              startTransition(async () => {
                const res = await run();
                if (res && !res.ok) setRefused(res.error ?? "That could not be done.");
              });
            }}
          >
            {status === "ready" && <Icon name="rocket-launch" />} {action.label}
          </button>
        )}
        {isAdmin && (status === "live" || status === "completed") && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => startTransition(() => setConfigUnlocked(!configUnlocked))}
          >
            <Icon name={configUnlocked ? "ph ph-lock-simple" : "ph ph-lock-simple-open"} />{" "}
            {configUnlocked ? "Lock configuration" : "Unlock configuration"}
          </button>
        )}
      </div>

      {/**
       * WHY THE NEXT STEP IS NOT AVAILABLE, said in full and in place.
       *
       * A greyed-out button with no explanation is the worst of both: it stops
       * the organizer and tells them nothing, so they go looking for a bug.
       * Both messages name the screen that fixes it, because a refusal that
       * does not say what to do next makes the app the obstacle.
       *
       * `refused` takes precedence: if the server said no, that is the newer
       * and more specific answer.
       */}
      {isAdmin && (refused || blockedReason) && (
        <div
          className="card elev-sm"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--color-accent)", gap: 6 }}
        >
          <span className="card-title" style={{ fontSize: 14 }}>
            <Icon name="warning-circle" /> Not yet — {action?.label.toLowerCase()}
          </span>
          <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
            {refused || blockedReason}
          </p>
        </div>
      )}

      {/* The status is the organizer's to set, so this reports the
          disagreement rather than quietly correcting it — launching locks
          configuration and hands out player access, which are decisions, not
          bookkeeping. See lifecycleMismatch. */}
      {mismatch && (
        <div
          className="card elev-sm"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--color-accent)", gap: 8 }}
        >
          <span className="card-title" style={{ fontSize: 14 }}>
            <Icon name="warning-circle" /> {mismatch.title}
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
            {mismatch.detail}
          </p>
          {isAdmin && mismatch.offerLaunch && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => setConfirming(true)}
              style={{ alignSelf: "flex-start" }}
            >
              <Icon name="rocket-launch" /> Launch tournament
            </button>
          )}
        </div>
      )}

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
                <Icon name="rocket-launch" /> Launch tournament
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
