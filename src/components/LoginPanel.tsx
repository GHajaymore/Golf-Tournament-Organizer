"use client";
import { useState, useTransition } from "react";
import { checkEmailStatus, signInWithPassword, claimPassword, startNewTournament } from "@/app/actions/auth";

type Stage = "email" | "signin" | "claim" | "signup";

export function LoginPanel() {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [tournamentName, setTournamentName] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const back = () => {
    setStage("email");
    setPassword("");
    setError("");
  };

  const submitEmail = () => {
    setError("");
    startTransition(async () => {
      const result = await checkEmailStatus(email);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setStage(result.status ?? "signup");
    });
  };

  const submitSignin = () => {
    setError("");
    startTransition(async () => {
      const result = await signInWithPassword(email, password);
      // A successful sign-in redirect()s server-side and never returns here.
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

  const submitSignup = () => {
    setError("");
    startTransition(async () => {
      const result = await startNewTournament(name, email, tournamentName, password);
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  const errorBlock = error && (
    <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger, #e0665a)" }}>
      <i className="ph ph-warning-circle" /> {error}
    </p>
  );

  if (stage === "signin") {
    return (
      <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
        <BackButton onClick={back} />
        <div>
          <h3 style={{ margin: "10px 0 0", fontSize: 22 }}>Welcome back</h3>
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
            Signing in as <b>{email}</b>.
          </p>
        </div>
        <div className="field">
          <label>Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitSignin()}
            placeholder="••••••••"
            autoFocus
          />
        </div>
        {errorBlock}
        <button type="button" className="btn btn-primary btn-block" disabled={pending || !password} onClick={submitSignin}>
          {pending ? "Signing in…" : "Sign in"} <i className="ph ph-arrow-right" />
        </button>
      </div>
    );
  }

  if (stage === "claim") {
    return (
      <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
        <BackButton onClick={back} />
        <div>
          <h3 style={{ margin: "10px 0 0", fontSize: 22 }}>Set your password</h3>
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
            <b>{email}</b> has tournament access waiting — set a password to claim it. You'll use this to sign in from now on.
          </p>
        </div>
        <div className="field">
          <label>New password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitClaim()}
            placeholder="At least 8 characters"
            autoFocus
          />
        </div>
        {errorBlock}
        <button type="button" className="btn btn-primary btn-block" disabled={pending || password.length < 8} onClick={submitClaim}>
          {pending ? "Saving…" : "Set password & sign in"} <i className="ph ph-arrow-right" />
        </button>
      </div>
    );
  }

  if (stage === "signup") {
    return (
      <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
        <BackButton onClick={back} />
        <div>
          <h3 style={{ margin: "10px 0 0", fontSize: 22 }}>Start your tournament</h3>
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
            No tournament found for <b>{email}</b> yet — you're a few seconds from running your own.
          </p>
        </div>
        <div className="field">
          <label>Your name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
        </div>
        <div className="field">
          <label>Tournament name <span className="text-muted">(you can change this later)</span></label>
          <input className="input" value={tournamentName} onChange={(e) => setTournamentName(e.target.value)} placeholder="e.g. Club Championship 2026" />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </div>
        {errorBlock}
        <button type="button" className="btn btn-primary btn-block" disabled={pending || !name.trim() || password.length < 8} onClick={submitSignup}>
          {pending ? "Creating…" : "Create my tournament"} <i className="ph ph-arrow-right" />
        </button>
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          You'll land straight on setup — field, format and rounds are all still ahead of you.
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: "min(400px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div className="text-muted" style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Sign in
        </div>
        <h3 style={{ margin: "6px 0 0", fontSize: 22 }}>Enter your email</h3>
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          We'll take you straight to the tournaments you've been given access to.
        </p>
      </div>
      <div className="field">
        <label>Email</label>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitEmail()}
          placeholder="you@email.com"
          autoFocus
        />
      </div>
      {errorBlock}
      <button type="button" className="btn btn-primary btn-block" disabled={pending || !email.trim()} onClick={submitEmail}>
        {pending ? "Checking…" : "Continue"} <i className="ph ph-arrow-right" />
      </button>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-neutral-500)", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
    >
      <i className="ph ph-arrow-left" /> Back
    </button>
  );
}
