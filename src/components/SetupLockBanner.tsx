"use client";
import { useTransition } from "react";
import { setConfigUnlocked } from "@/app/actions/tournament";

/**
 * Shown on Set-up screens once the tournament is live: setup is frozen to
 * protect the field, flights, rounds and scoring rules from mid-event edits.
 * The primary Organizer can unlock in place to make a correction.
 */
export function SetupLockBanner({ locked, isAdmin }: { locked: boolean; isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  if (!locked) return null;
  return (
    <div
      className="card elev-sm"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 16,
        borderColor: "var(--color-accent-700)",
        background: "color-mix(in srgb, var(--color-accent-900) 40%, transparent)",
      }}
    >
      <i className="ph ph-lock-simple" style={{ fontSize: 18, color: "var(--color-accent-300)" }} />
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>Setup locked</div>
        <div className="text-muted" style={{ fontSize: 12 }}>
          The tournament is live, so setup is read-only to protect the field and results.{" "}
          {isAdmin ? "Unlock to make a correction." : "Ask the Organizer to unlock if a change is needed."}
        </div>
      </div>
      {isAdmin && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => startTransition(() => setConfigUnlocked(true))}
        >
          <i className="ph ph-lock-simple-open" /> Unlock setup
        </button>
      )}
    </div>
  );
}
