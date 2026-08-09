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
 *
 * Everything is inside a real <form>. It was a stack of inputs with an Enter
 * handler bolted onto the password field, which meant Enter did nothing from
 * the email field and password managers had no form to recognise — the two
 * things people actually notice about a sign-in box.
 */
type Mode = "login" | "signup";
type Extra = null | "claim" | "forgot" | "forgot-sent";

export function LoginPanel({
  initialMode = "login",
  autoFocusFields = true,
}: { initialMode?: Mode; autoFocusFields?: boolean } = {}) {
  const [mode, setMode] = useState<Mode>(initialMode);
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

  /* ── Presentation ────────────────────────────────────────────────── */

  /** A defined card rather than fields floating on the page. */
  const shell = (children: React.ReactNode) => (
    <div
      style={{
        width: "min(400px, 100%)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: 26,
        borderRadius: 16,
        background: "var(--color-surface)",
        boxShadow: [
          "0 0 0 1px color-mix(in srgb, var(--color-text) 10%, transparent)",
          "0 2px 6px -1px rgba(0,0,0,0.16)",
          "0 22px 56px -20px rgba(0,0,0,0.45)",
          "inset 0 1px 0 0 color-mix(in srgb, var(--color-accent) 16%, transparent)",
        ].join(", "),
      }}
    >
      {children}
    </div>
  );

  const Title = ({ title, sub }: { title: string; sub: React.ReactNode }) => (
    <div>
      <h3 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.022em" }}>{title}</h3>
      <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>
        {sub}
      </p>
    </div>
  );

  // A tinted block with role="alert", so the failure is both visible and
  // announced. Plain red text below a field is easy to miss and invisible to
  // a screen reader that has already moved on.
  const errorBlock = error ? (
    <p
      role="alert"
      style={{
        fontSize: 12.5,
        margin: 0,
        lineHeight: 1.5,
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "9px 11px",
        borderRadius: 9,
        color: "var(--color-danger)",
        background: "var(--color-danger-bg)",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-danger) 32%, transparent)",
      }}
    >
      <i className="ph ph-warning-circle" style={{ fontSize: 14, marginTop: 1, flex: "none" }} />
      <span>{error}</span>
    </p>
  ) : null;

  /* ── Password reset ──────────────────────────────────────────────── */

  if (extra === "forgot-sent") {
    return shell(
      <>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            display: "grid",
            placeItems: "center",
            background: "color-mix(in srgb, var(--color-accent-2) 15%, transparent)",
            color: "var(--color-accent-2-300)",
          }}
        >
          <i className="ph ph-envelope-simple" style={{ fontSize: 18 }} />
        </div>
        <Title
          title="Check your email"
          sub={
            <>
              If <b>{email}</b> has an account, a reset link is on its way. It expires in 15 minutes.
            </>
          }
        />
        <BackLink onClick={() => { setExtra(null); setError(""); }} label="Back to log in" />
      </>,
    );
  }

  if (extra === "forgot") {
    return shell(
      <form
        onSubmit={(e) => { e.preventDefault(); submitForgot(); }}
        style={{ display: "contents" }}
      >
        <Title title="Reset your password" sub="We'll email a link to set a new password." />
        <Field label="Email">
          <input
            className="input"
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoFocus={autoFocusFields}
          />
        </Field>
        {errorBlock}
        <button type="submit" className="btn btn-primary btn-block" disabled={pending || !email.trim()}>
          {pending ? "Sending…" : "Send reset link"}
        </button>
        <BackLink onClick={() => { setExtra(null); setError(""); }} label="Back to log in" />
      </form>,
    );
  }

  /* ── First-time password for an invited account ──────────────────── */

  if (extra === "claim") {
    return shell(
      <form
        onSubmit={(e) => { e.preventDefault(); submitClaim(); }}
        style={{ display: "contents" }}
      >
        <Title
          title="Set your password"
          sub={
            <>
              <b>{email}</b> has been invited to a tournament. Choose a password to finish setting up
              your account.
            </>
          }
        />
        {/* The email is stated above but not in the form, which leaves a
            password manager nothing to file the new credential against. */}
        <input type="hidden" name="email" value={email} autoComplete="username" readOnly />
        <Field label="Create password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
          <PasswordInput
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoFocus={autoFocusFields}
          />
        </Field>
        {errorBlock}
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={pending || password.length < MIN_PASSWORD_LENGTH}
        >
          {pending ? "Saving…" : "Set password & continue"}
        </button>
        <BackLink onClick={() => { setExtra(null); setError(""); setPassword(""); }} label="Back to log in" />
      </form>,
    );
  }

  /* ── Log in / Sign up ────────────────────────────────────────────── */

  const login = mode === "login";

  return shell(
    <>
      {/* A sliding pill rather than two bordered halves — the segmented
          control every current interface uses for exactly this choice. */}
      <div
        role="tablist"
        aria-label="Log in or sign up"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 3,
          padding: 3,
          borderRadius: 11,
          background: "color-mix(in srgb, var(--color-text) 6%, transparent)",
        }}
      >
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            style={{
              appearance: "none",
              border: "none",
              cursor: "pointer",
              padding: "7px 10px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: mode === m ? 600 : 500,
              fontFamily: "var(--font-heading)",
              color: mode === m ? "var(--color-text)" : "color-mix(in srgb, var(--color-text) 58%, transparent)",
              background: mode === m ? "var(--color-surface)" : "transparent",
              boxShadow:
                mode === m
                  ? "0 0 0 1px color-mix(in srgb, var(--color-text) 9%, transparent), 0 1px 2px rgba(0,0,0,0.14)"
                  : "none",
              transition: "background 120ms var(--ease), color 120ms var(--ease)",
            }}
          >
            {m === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>

      <Title
        title={login ? "Welcome back" : "Create your account"}
        sub={
          login
            ? "Log in to reach the tournaments you have access to."
            : "For organizers running an event, and for players invited to one."
        }
      />

      <form
        onSubmit={(e) => { e.preventDefault(); login ? submitLogin() : submitSignup(); }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {!login && (
          <Field label="Your name">
            <input
              className="input"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              autoFocus={autoFocusFields}
            />
          </Field>
        )}

        <Field label="Email">
          <input
            className="input"
            type="email"
            name="email"
            autoComplete={login ? "username" : "email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoFocus={autoFocusFields && login}
          />
        </Field>

        <Field
          label="Password"
          action={
            login ? (
              <button
                type="button"
                onClick={() => { setExtra("forgot"); setError(""); }}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: 11.5,
                  color: "var(--color-accent-400)",
                }}
              >
                Forgot?
              </button>
            ) : null
          }
        >
          <PasswordInput
            value={password}
            onChange={setPassword}
            autoComplete={login ? "current-password" : "new-password"}
            placeholder={login ? "Your password" : `At least ${MIN_PASSWORD_LENGTH} characters`}
          />
        </Field>

        {errorBlock}

        <button
          type="submit"
          className="btn btn-primary btn-block"
          style={{ marginTop: 2 }}
          disabled={
            pending ||
            !email.trim() ||
            (login ? !password : !name.trim() || password.length < MIN_PASSWORD_LENGTH)
          }
        >
          {pending
            ? login
              ? "Logging in…"
              : "Creating account…"
            : login
              ? "Log in"
              : "Create account"}
        </button>
      </form>

      {/* Players in a code-access tournament have no account at all — this is
          their whole way in, so it can't be buried. */}
      <a
        href="/play"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          marginTop: -2,
          padding: "10px 12px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: "none",
          color: "var(--color-accent-300)",
          background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
          boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 22%, transparent)",
        }}
      >
        <i className="ph ph-flag" style={{ fontSize: 15 }} />
        Playing today? Enter your round code
        <i className="ph ph-arrow-right" style={{ fontSize: 13 }} />
      </a>
    </>,
  );
}

function Field({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="field" style={{ display: "block" }}>
      <span
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 12,
          fontWeight: 500,
          marginBottom: 6,
          color: "color-mix(in srgb, var(--color-text) 72%, transparent)",
        }}
      >
        {label}
        {action}
      </span>
      {children}
      {hint && (
        <span className="text-muted" style={{ display: "block", fontSize: 11, marginTop: 5 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * A password field you can read back.
 *
 * Typing a password blind on a phone at a golf club, one-handed, is the most
 * common reason a correct password gets rejected — and the reveal toggle is
 * the standard fix everywhere except here.
 */
function PasswordInput({
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span style={{ position: "relative", display: "block" }}>
      <input
        className="input"
        type={shown ? "text" : "password"}
        name="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ paddingRight: 38 }}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        style={{
          position: "absolute",
          right: 4,
          top: "50%",
          transform: "translateY(-50%)",
          width: 28,
          height: 28,
          display: "grid",
          placeItems: "center",
          background: "none",
          border: "none",
          borderRadius: 7,
          cursor: "pointer",
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
        }}
      >
        <i className={shown ? "ph ph-eye-slash" : "ph ph-eye"} style={{ fontSize: 15 }} />
      </button>
    </span>
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: "color-mix(in srgb, var(--color-text) 58%, transparent)",
        fontSize: 12.5,
        display: "flex",
        alignItems: "center",
        gap: 5,
        alignSelf: "center",
      }}
    >
      <i className="ph ph-arrow-left" /> {label}
    </button>
  );
}
