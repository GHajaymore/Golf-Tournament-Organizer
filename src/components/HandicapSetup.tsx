"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveHandicapPolicy, saveScoreReporting } from "@/app/actions/handicap-policy";
import FieldInfo from "@/components/FieldInfo";

/**
 * Where this club's handicaps come from, and whether rounds go back.
 *
 * Two switches, not one, because they are two permissions. A club is routinely
 * entitled to look a golfer's index up and not to write to their record —
 * posting a score is the larger permission — and a single toggle would force
 * a club to take both or neither.
 *
 * The screen is honest about the integration not existing yet rather than
 * hiding the option until it does. A club evaluating this app needs to see the
 * path before committing a season to it, and the state it shows here —
 * "chosen, not connected" — is a state the app has to handle correctly anyway,
 * because it is the same state as an association outage.
 */

export interface HandicapSetupView {
  policy: "club" | "hybrid" | "ghin";
  handicap: { providerId: string; label: string; status: string; howToEnable: string };
  scores: {
    enabled: boolean;
    providerId: string;
    label: string;
    status: string;
    howToEnable: string;
  };
  canEdit: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  unconfigured: "Not connected",
  ready: "Connected",
  rejected: "Credentials rejected",
};

export function HandicapSetup({ view }: { view: HandicapSetupView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
      else router.refresh();
    });
  };

  // Shown for hybrid as well: a hybrid club still needs the connection for
  // the half of its roster that has numbers.
  const usesGhin = view.policy !== "club";
  const connected = view.handicap.status === "ready";

  return (
    <section className="card elev-sm" style={{ gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="card-title" style={{ fontSize: 15 }}>Handicaps</span>
        <FieldInfo label="where handicaps come from">
          <p>
            A handicap index issued by an association is the authority. What this app works out
            from your own members&rsquo; cards is a club handicap — the same published method over
            a smaller record — and it never overwrites an association figure.
          </p>
          <p>
            A club that plays entirely off association indexes can say so here, and nobody at the
            club types a handicap again.
          </p>
        </FieldInfo>
      </div>

      <div>
        <span className="card-kicker">Where indexes come from</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {(
            [
              { id: "club", label: "Club only" },
              { id: "hybrid", label: "Both" },
              { id: "ghin", label: view.handicap.label + " only" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`btn ${view.policy === opt.id ? "btn-primary" : "btn-secondary"}`}
              style={{ fontSize: 12.5, padding: "6px 12px" }}
              aria-pressed={view.policy === opt.id}
              disabled={pending || !view.canEdit}
              onClick={() => run(() => saveHandicapPolicy(opt.id, view.handicap.providerId))}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.5 }}>
          {view.policy === "ghin"
            ? "Every member plays off a GHIN index. Nobody at the club enters a handicap by hand, and a member without a GHIN number can't be entered until they have one."
            : view.policy === "hybrid"
              ? "Members with a GHIN number play off it; everyone else plays off the club's own figure. Most clubs are this — a society has visitors, and a club has members who have never held an index."
              : "Handicaps are the club's own: entered by an organizer, or suggested from your members' cards."}
        </p>
      </div>

      {/*
        Shown ONLY once the club is on GHIN. Before that it is an answer to a
        question nobody has asked, and a settings screen that explains
        everything at once explains nothing.
      */}
      {usesGhin && (
        <div
          style={{
            border: "1px solid var(--color-divider)",
            borderRadius: "var(--radius-md)",
            padding: "12px 14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{view.handicap.label}</span>
            <span
              className="pill"
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 3,
                border: "1px solid var(--color-divider)",
                color: connected ? "var(--color-accent-2-300)" : "var(--color-neutral-400)",
              }}
            >
              {STATUS_LABEL[view.handicap.status] ?? view.handicap.status}
            </span>
          </div>
          {!connected && (
            <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.55 }}>
              {view.handicap.howToEnable}
            </p>
          )}
          {/*
            The thing a club most needs to know, and the reason this whole
            feature is arranged the way it is: choosing GHIN before connecting
            it does not put anybody off scratch.
          */}
          {!connected && (
            <p style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.55, color: "var(--color-neutral-300)" }}>
              Until it is connected, players keep the index already on file and the roster shows
              how old it is. Nobody is moved to zero.
            </p>
          )}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
        <span className="card-kicker">Posting rounds back</span>
        <label className="radio" style={{ fontSize: 13, marginTop: 8, display: "flex", gap: 8 }}>
          <input
            type="checkbox"
            checked={view.scores.enabled}
            disabled={pending || !view.canEdit}
            onChange={(e) => run(() => saveScoreReporting(e.target.checked, view.scores.providerId))}
          />
          <span className="dot" />
          <span>Send finished competition rounds to {view.scores.label}</span>
        </label>
        <p className="text-muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.55 }}>
          A posted score changes a golfer&rsquo;s official index at every club they play, and it
          cannot be taken back from here. Only complete rounds of a counting competition are sent,
          each one once, and anything refused is listed with the reason.
        </p>
        {view.scores.enabled && view.scores.status !== "ready" && (
          <p style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.55, color: "var(--color-neutral-300)" }}>
            {view.scores.howToEnable} Nothing is queued or sent until then.
          </p>
        )}
      </div>

      {error && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}
