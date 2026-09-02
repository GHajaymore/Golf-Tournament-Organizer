"use client";
import { useState, useTransition } from "react";
import { resetPassword } from "@/app/actions/auth";
import {
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  passwordHint,
  hintIsProblem,
} from "@/lib/domain/password";

/**
 * Setting a new password, with the rule said out loud.
 *
 * This form had the fault the sign-up form was fixed for and this one was not:
 * the button disabled itself below the minimum length and offered no hint, no
 * message and no explanation. The only statement of the rule was a PLACEHOLDER,
 * which disappears the moment anyone types — exactly when it is needed.
 *
 * It was worse here than on sign-up, because of the order the checks ran in.
 * `password !== confirm` was tested FIRST, so someone typing a short password
 * and mistyping the confirmation was told "Passwords don't match" — true, but
 * not the thing standing between them and their account. They would fix the
 * confirmation, press the button, and get silence, because the button was dead
 * for a reason nothing on screen mentioned.
 *
 * Both fields now carry a live hint, and the checks run shortest-cause-first.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const problem = passwordProblem(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = !pending && problem === null && confirm === password && confirm.length > 0;

  const submit = () => {
    setError("");
    /**
     * Order reversed from the original, and this IS the bug the user hit.
     * A password that is too short is too short whether or not the
     * confirmation matches it, so it is the thing to say first.
     */
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    startTransition(async () => {
      const result = await resetPassword(token, password);
      // A successful reset redirect()s server-side and never returns here.
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  if (!token) {
    return (
      <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
        <h3 style={{ margin: 0, fontSize: 22 }}>Invalid reset link</h3>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          This link is missing its token. Request a new one from the sign-in screen.
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 22 }}>Set a new password</h3>
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          Choose a new password for your account.
        </p>
      </div>

      <div className="field">
        <label>New password</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          aria-describedby="password-hint"
          autoFocus
        />
        <Hint id="password-hint" bad={hintIsProblem(password)}>
          {passwordHint(password)}
        </Hint>
      </div>

      <div className="field">
        <label>Confirm password</label>
        <input
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Re-enter password"
          aria-describedby="confirm-hint"
        />
        {/* Only once there is something to compare. An empty confirmation is
            not a mismatch, it is an unfinished form. */}
        <Hint id="confirm-hint" bad={mismatch}>
          {confirm.length === 0 ? "" : mismatch ? "Passwords don't match" : "Matches"}
        </Hint>
      </div>

      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!ready}
        onClick={submit}
      >
        {pending ? "Saving…" : "Set password & sign in"} <i className="ph ph-arrow-right" />
      </button>
    </div>
  );
}

/**
 * A line under a field saying how it stands.
 *
 * Renders nothing rather than an empty box when there is nothing to say, so
 * the form does not jump as the hint appears and disappears — it reserves no
 * space it is not using, and the two fields are far enough apart that the
 * shift is not the problem an inline error would be.
 */
function Hint({ id, bad, children }: { id: string; bad: boolean; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <span
      id={id}
      className={bad ? undefined : "text-muted"}
      style={{
        display: "block",
        fontSize: 11,
        marginTop: 5,
        color: bad ? "var(--color-danger)" : undefined,
      }}
    >
      {children}
    </span>
  );
}
