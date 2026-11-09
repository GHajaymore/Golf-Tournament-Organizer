"use client";
import Link from "next/link";
import { SCOPE_WORDS, wayOutIsOrganizers, type CorrectionFacts, type LockScope, type ScopeLock } from "@/lib/domain/tournament-status";
import { CorrectionButton, CorrectionOpenLine } from "./CommitteeCorrection";
import { Icon } from "./Icon";

/**
 * WHAT IS LOCKED ON THIS SCREEN, AND WHY (state machine PR 5a; UI/UX, panel 8.3 Q3).
 *
 * One banner per screen, one line per locked scope — at most three — each giving
 * the machine's reason ("Locked because the tournament is live.") and its way
 * out. One shared component, so no screen invents its own: a padlock with no
 * sentence stops an organizer and tells them nothing, and a sentence with no
 * way out makes the app the obstacle (the TD's worry, 8.1).
 *
 * Drawn only where a control is actually locked (`locks` empty → nothing), never
 * on a read-only screen: a launched tournament with a banner on every screen is
 * the banner sprawl UI/UX warned of. Two exceptions draw it with no lock: a
 * committee correction open on one of this screen's scopes (so the Organizer
 * can press Done where the scope was opened), and Entries under way (`open`:
 * what the day still allows, from the one field rule).
 *
 * THE ORGANIZER'S BUTTON (PR 5b) is the committee correction — one scope, a
 * reason, closed at Done or the end of the club's day — offered on a lock by
 * launch or by the draw (`correctable`); anybody else is told who can press
 * it. A lock by results or by completion keeps its own way out (Clear the
 * results, Reopen it on the dashboard), as a link. The blanket "Unlock setup"
 * is gone.
 *
 * Focusable (`tabIndex={-1}`) so a padlock on a locked control (`ScopeLockMark`)
 * can move focus here: the reason is said once, not on every control.
 */
export const SCOPE_LOCK_BANNER_ID = "scope-lock-banner";

/**
 * THE BANNER IS NAMED FOR WHAT IT SAYS. A screen reader announces the region's
 * name before its words, so a banner whose only line is "Open for a correction"
 * must not be announced as "Locked" (round G567-2 found the screen drawn open
 * and named locked). Any lock line on the screen makes it "Locked".
 */
export function bannerName(lockLines: number, correctionOpen: boolean): "Locked" | "Open for a correction" | "Under way" {
  if (lockLines > 0) return "Locked";
  return correctionOpen ? "Open for a correction" : "Under way";
}

export function ScopeLockBanner({
  locks,
  isAdmin,
  correction = null,
  open = null,
}: {
  locks: readonly ScopeLock[];
  isAdmin: boolean;
  /** A committee correction open on one of this screen's scopes — said, with Done for the Organizer. */
  correction?: CorrectionFacts | null;
  /** Entries under way: what the day still allows, in the field rule's words (`fieldBanner`). */
  open?: readonly string[] | null;
}) {
  const lines = locks.slice(0, 3);
  if (lines.length === 0 && !correction && !open) return null;
  const correctable = lines.filter((l) => l.correctable).map((l) => l.scope) as LockScope[];
  return (
    <section
      id={SCOPE_LOCK_BANNER_ID}
      tabIndex={-1}
      aria-label={bannerName(lines.length, correction !== null)}
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
      <Icon name={lines.length === 0 ? "lock-simple-open" : "lock-simple"} style={{ fontSize: 18, color: "var(--color-accent-200)" }} />
      <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 4 }}>
        {open && open.length > 0 && (
          <>
            <div style={{ fontWeight: 500, fontSize: 15 }}>Under way</div>
            {/* Two short lines, each its own (panel review of #1028): what is open, then what is not. */}
            {open.map((line) => (
              <p key={line} style={{ margin: 0, fontSize: 14 }}>
                {line}
              </p>
            ))}
          </>
        )}
        {lines.map((l) => (
          <p key={l.scope} style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            <b>{SCOPE_WORDS[l.scope]}</b> · {l.because}{" "}
            {l.correctable ? (
              isAdmin ? null : (
                <span className="text-muted">Only the Organizer can make a committee correction.</span>
              )
            ) : wayOutIsOrganizers(l) && !isAdmin ? (
              <span className="text-muted">Only the Organizer can {l.wayOut.says.charAt(0).toLowerCase() + l.wayOut.says.slice(1)}.</span>
            ) : (
              <Link href={l.wayOut.href} style={{ color: "var(--color-accent-200)", fontWeight: 600 }}>
                {l.wayOut.says}
              </Link>
            )}
          </p>
        ))}
        {correction && <CorrectionOpenLine correction={correction} isAdmin={isAdmin} />}
      </div>
      {isAdmin && correctable.length > 0 && <CorrectionButton scopes={correctable} />}
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
