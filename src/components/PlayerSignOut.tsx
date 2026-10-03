"use client";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { signOutAction } from "@/app/actions/auth";
import { Icon } from "./Icon";

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
        <Icon name="sign-out" style={{ fontSize: 17 }} />
      </button>

      {/* PORTALED TO THE PAGE (2026-09-29). This button lives in the player
          shell's header, and that header has `backdrop-filter`, which makes it
          the containing block for any `position: fixed` inside it. So the
          backdrop was fixed to the HEADER, not the screen, and the dialog was
          centred on a 63px strip with its title cut off above the top edge —
          on every player's phone. Found by dialog.spec's new top-edge check.
          Rendered only once asked, which is always after hydration, so
          `document` is there. */}
      {asking && createPortal(
        <div className="dialog-backdrop" onClick={() => setAsking(false)}>
          {/* ANNOUNCED AS A DIALOG, WHICH IT WAS NOT.
              It looked modal and was semantically invisible: a backdrop and a
              centred box, with no `role` and no `aria-modal`, so a screen
              reader announced a couple of anonymous divs and gave no signal
              that the rest of the page had been shut off behind them. Found by
              sweeping the three dialogs and reading what each actually
              carried — the app had it backwards, with the two real modals
              unannounced and the one announced thing (CardConflict) not modal
              at all. Labelled BY its own title rather than a second copy of
              the words, so the two cannot drift. */}
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signout-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-title" id="signout-dialog-title">
              Sign out{name ? ` of ${name}’s account` : ""}?
            </div>
            <div className="dialog-body">
              You&rsquo;ll need your email and password to get back in. Nothing you&rsquo;ve entered is lost —
              scores and messages are saved as you go.
              {/* The player app's way to their account page (2026-10-03): the
                  dialog about the account is where somebody looks for it. A
                  link in the text, not a third button — three did not fit the
                  dialog on a phone, and the first was clipped at its edge. */}
              <span style={{ display: "block", marginTop: 8 }}>
                <a href="/account">Your account</a> &mdash; your details, or deleting it.
              </span>
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
                <Icon name="sign-out" /> Sign out
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
