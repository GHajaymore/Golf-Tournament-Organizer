"use client";
import { useState, useTransition } from "react";
import { signInWithPassword, claimPassword, signUp, requestPasswordReset } from "@/app/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";

/**
 * Standard two-tab auth: Log in / Sign up.
 *
 * Two extra states hang off Log in rather than being tabs of their own,
 * because you only reach them from a login attempt:
 *   claim  - the email was invited by an organizer but has no password yet
 *   forgot - password reset request
 */
type Mode = "login" | "signup";
type Extra = null | "claim" | "forgot" | "forgot-sent";

export function LoginPanel() {
  const [mode, setMode] = useState<Mode>("login");
  const [extra, setExtra] = useState<Extra>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const switchMode = (next: Mode) => {
    setMode(next);
    setExtra(null);
    setError("");
    setPassword("");
  };

  const submitLogin = () => {
    setError("");
    startTransition(async () => {
      const result = await signInWithPassword(email, password);
      // A successful sign-in redirect()s server-side and never returns here.
      if (result.needsClaim) {
        setExtra("claim");
        setPassword("");
        return;
      }
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  const submitSignup = () => {
    setError("");
    startTransition(async () => {
      const result = await signUp(name, email, password);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  const submitClaim = () => {
    setError("");
    startTransition(async () => {
      const result = await claimPassword(email, password);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  const submitForgot = () => {
    setError("");
    startTransition(async () => {
      const result = await requestPasswordReset(email);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setExtra("forgot-sent");
    });
  };

  const errorBlock = error ? (
    <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger, #e0665a)" }}>
      <i className="ph ph-warning-circle" /> {error}
    </p>
  ) : null;

  const shell = (children: React.ReactNode) => (
    <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
  );

  /* ── Password reset ──────────────────────────────────────────────── */

  if (extra === "forgot-sent") {
    return shell(
      <>
        <div>
          <h3 style={{ margin: 0, fontSize: 22 }}>Check your email</h3>
          <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
            If <b>{email}</b> has an account, a reset link is on its way. It expires in 15 minutes.
          </p>
        </div>
        <BackLink onClick={() => { setExtra(null); setError(""); }} label="Back to log in" />
      </>,
    );
  }

  if (extra === "forgot") {
    return shell(
      <>
        <div>
          <h3 style={{ margin: 0, fontSize: 22 }}>Reset your password</h3>
          <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
            We'll email a link to set a new password.
          </p>
        </div>
        <div className="field">
          <label>Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitForgot()}
            placeholder="you@email.com"
            autoFocus
          />
        </div>
        {errorBlock}
        <button type="button" className="btn btn-primary btn-block" disabled={pending || !email.trim()} onClick={submitForgot}>
          {pending ? "Sending…" : "Send reset link"}
        </button>
        <BackLink onClick={() => { setExtra(null); setError(""); }} label="Back to log in" />
      </>,
    );
  }

  /* ── First-time password for an invited account ──────────────────── */

  if (extra === "claim") {
    return shell(
      <>
        <div>
          <h3 style={{ margin: 0, fontSize: 22 }}>Set your password</h3>
          <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
            <b>{email}</b> has been invited to a tournament. Choose a password to finish setting up your account.
          </p>
        </div>
        <div className="field">
          <label>Create password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitClaim()}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoFocus
          />
        </div>
        {errorBlock}
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={pending || password.length < MIN_PASSWORD_LENGTH}
          onClick={submitClaim}
        >
          {pending ? "Saving…" : "Set password & continue"}
        </button>
        <BackLink onClick={() => { setExtra(null); setError(""); setPassword(""); }} label="Back to log in" />
      </>,
    );
  }

  /* ── Log in / Sign up ────────────────────────────────────────────── */

  return shell(
    <>
      <div className="seg" style={{ width: "100%" }}>
        <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
          <input type="radio" name="authmode" checked={mode === "login"} onChange={() => switchMode("login")} />
          Log in
        </label>
        <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
          <input type="radio" name="authmode" checked={mode === "signup"} onChange={() => switchMode("signup")} />
          Sign up
        </label>
      </div>

      <div>
        <h3 style={{ margin: 0, fontSize: 22 }}>{mode === "login" ? "Welcome back" : "Create your account"}</h3>
        <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
          {mode === "login"
            ? "Log in to reach the tournaments you have access to."
            : "For organizers running an event, and for players invited to one."}
        </p>
      </div>

      {mode === "signup" && (
        <div className="field">
          <label>Your name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
        </div>
      )}

      <div className="field">
        <label>Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          autoFocus={mode === "login"}
        />
      </div>

      <div className="field">
        <label>Password</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (mode === "login" ? submitLogin() : submitSignup())}
          placeholder={mode === "login" ? "••••••••" : `At least ${MIN_PASSWORD_LENGTH} characters`}
        />
      </div>

      {errorBlock}

      {mode === "login" ? (
        <>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={pending || !email.trim() || !password}
            onClick={submitLogin}
          >
            {pending ? "Logging in…" : "Log in"}
          </button>
          <button
            type="button"
            onClick={() => { setExtra("forgot"); setError(""); }}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              color: "var(--color-neutral-500)", fontSize: 12, textAlign: "center",
            }}
          >
            Forgot password?
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={pending || !name.trim() || !email.trim() || password.length < MIN_PASSWORD_LENGTH}
          onClick={submitSignup}
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      )}

      {/* Players in a code-access tournament have no account at all — this is
          their whole way in, so it can't be buried. */}
      <div
        style={{
          borderTop: "1px solid var(--color-divider)",
          marginTop: 4,
          paddingTop: 12,
          textAlign: "center",
        }}
      >
        <a href="/play" style={{ fontSize: 13, color: "var(--color-accent)" }}>
          Playing today? Enter your round code →
        </a>
      </div>
    </>,
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "pointer",
        color: "var(--color-neutral-500)", fontSize: 12,
        display: "flex", alignItems: "center", gap: 4, alignSelf: "center",
      }}
    >
      <i className="ph ph-arrow-left" /> {label}
    </button>
  );
}
