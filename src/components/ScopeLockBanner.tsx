"use client";
import Link from "next/link";
import { useTransition } from "react";
import { setConfigUnlocked } from "@/app/actions/tournament";
import type { LockScope, ScopeLock } from "@/lib/domain/tournament-status";
import { Icon } from "./Icon";

/**
 * WHAT IS LOCKED ON THIS SCREEN, AND WHY (state machine PR 5a; UI/UX, panel 8.3 Q3).
 *
 * One banner per screen, one line per locked scope — at most three — each giving
 * the machine's reason ("Locked because the tournament is live.") and its way out.
 * One shared component, so no screen invents its own: a padlock with no sentence
 * stops an organizer and tells them nothing, and a sentence with no way out makes
 * the app the obstacle (the TD's worry, 8.1).
 *
 * Drawn only where a control is actually locked (`locks` empty → nothing), never
 * on a read-only screen: a launched tournament with a banner on every screen is
 * the banner sprawl UI/UX warned of.
 *
 * THE ORGANIZER'S BUTTON is today's "Unlock setup" on a lock by launch — the only
 * override there is until PR 5b replaces it with a committee correction to one
 * scope. So on that line the button IS the way out, and anybody else is told who
 * can press it. A lock by the draw, by results or by completion keeps its own way
 * out (Reopen the draw on Flights, Clear the results, Reopen it on the dashboard).
 *
 * Focusable (`tabIndex={-1}`) so a padlock on a locked control (`ScopeLockMark`)
 * can move focus here: the reason is said once, not on every control.
 */
export const SCOPE_LOCK_BANNER_ID = "scope-lock-banner";

/** The scope, as the line names it. */
const SCOPE_WORDS: Record<LockScope, string> = {
  details: "Details",
  rounds: "Rounds",
  field: "The field",
  flights: "Flights",
  draw: "The draw",
  sides: "Sides",
  cup: "Cup teams",
  money: "Money",
  teeSheet: "The tee sheet",
};

export function ScopeLockBanner({ locks, isAdmin }: { locks: readonly ScopeLock[]; isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  const lines = locks.slice(0, 3);
  if (lines.length === 0) return null;
  const unlockHere = isAdmin && lines.some((l) => l.by === "launch");
  return (
    <section
      id={SCOPE_LOCK_BANNER_ID}
      tabIndex={-1}
      aria-label="Locked"
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
      <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 4 }}>
        {lines.map((l) => (
          <p key={l.scope} style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            <b>{SCOPE_WORDS[l.scope]}</b> · {l.because}{" "}
            {l.by === "launch" ? (
              isAdmin ? null : (
                <span className="text-muted">Only the Organizer can unlock it.</span>
              )
            ) : (
              <Link href={l.wayOut.href} style={{ color: "var(--color-accent-200)", fontWeight: 600 }}>
                {l.wayOut.says}
              </Link>
            )}
          </p>
        ))}
      </div>
      {unlockHere && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => startTransition(() => setConfigUnlocked(true))}
        >
          <Icon name="lock-simple-open" /> Unlock setup
        </button>
      )}
    </section>
  );
}

/**
 * A PADLOCK ON A LOCKED CONTROL (panel 8.3 Q3, Q7): small, named "Locked — see
 * above", and pressing it moves focus to the banner, which says why. The reason
 * is not repeated per control.
 */
export function ScopeLockMark() {
  return (
    <button
      type="button"
      className="btn btn-icon"
      aria-label="Locked — see above"
      onClick={() => document.getElementById(SCOPE_LOCK_BANNER_ID)?.focus()}
    >
      <Icon name="lock-simple" />
    </button>
  );
}
