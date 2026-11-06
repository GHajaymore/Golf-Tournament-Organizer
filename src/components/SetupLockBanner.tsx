"use client";
import { useTransition } from "react";
import { setConfigUnlocked } from "@/app/actions/tournament";
import { Icon } from "./Icon";
import { MoreInfo } from "./MoreInfo";

/**
 * Shown on Set-up screens once the tournament is live: setup is frozen to
 * protect the field, flights, rounds and scoring rules from mid-event edits.
 * The primary Organizer can unlock in place to make a correction.
 *
 * `underWay` (Entries only, day-of field changes PR A): the tournament is live
 * and the field still takes a withdrawal, a put-back and — where the one field
 * rule allows — a late entry. The banner then says what is open rather than
 * "Setup locked", in `fieldBanner`'s words; Unlock stays for the rest.
 */
export function SetupLockBanner({ locked, isAdmin, underWay = null }: { locked: boolean; isAdmin: boolean; underWay?: string[] | null }) {
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
      <Icon name="lock-simple" style={{ fontSize: 18, color: "var(--color-accent-200)" }} />
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontWeight: 500, fontSize: 15 }}>{underWay ? "Under way" : "Setup locked"}</div>
        {/* Two short lines, each its own (panel review of #1028): what is open, then what is not. */}
        {underWay?.map((line) => (
          <p key={line} style={{ margin: "2px 0 0", fontSize: 14 }}>
            {line}
          </p>
        ))}
        {/* One line, the reason an ⓘ away (Ajay, 2026-10-05). */}
        <MoreInfo short={underWay ? "Anything else needs Unlock setup." : "Read-only, to protect the field and results."}>
          {/* "Launched", not "live": the lock holds after the tournament is
              finished too, and a completed championship was being called live. */}
          The tournament has been launched, so setup is read-only to protect the field and results.{" "}
          {isAdmin ? "Unlock to make a correction." : "Ask the Organizer to unlock if a change is needed."}
        </MoreInfo>
      </div>
      {isAdmin && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => startTransition(() => setConfigUnlocked(true))}
        >
          <Icon name="lock-simple-open" /> Unlock setup
        </button>
      )}
    </div>
  );
}
