"use client";
import { useState, useTransition } from "react";
import { signOutAction } from "@/app/actions/auth";

/**
 * Sign out, for the player's app.
 *
 * The shell had none. Every other surface does — the console sidebar, the
 * mobile tab bar, the code-based /play screen — and the one built for the
 * people who are not organizers was the one with no way out. It matters most
 * exactly there: a player signs in on a phone handed round a fourball, or on
 * the clubhouse iPad by the first tee, and the next person to pick it up is
 * signed in as them, able to read their messages and enter their scores.
 *
 * Confirmed rather than immediate. On a phone, in a pocket, beside a tab bar
 * people tap by feel, a one-tap sign-out is something you do by accident and
 * then need your password to undo — halfway round, with no signal.
 */
export function PlayerSignOut({ name }: { name: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        aria-label="Sign out"
        title={name ? `Signed in as ${name} — sign out` : "Sign out"}
        onClick={() => setAsking(true)}
        style={{ fontSize: 12.5, padding: "6px 10px" }}
      >
        <i className="ph ph-sign-out" style={{ fontSize: 17 }} />
      </button>

      {asking && (
        <div className="dialog-backdrop" onClick={() => setAsking(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Sign out{name ? ` of ${name}’s account` : ""}?</div>
            <div className="dialog-body">
              You&rsquo;ll need your email and password to get back in. Nothing you&rsquo;ve entered is lost —
              scores and messages are saved as you go.
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>
                Stay signed in
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => startTransition(() => signOutAction())}
              >
                <i className="ph ph-sign-out" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
