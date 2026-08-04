"use client";
import { useState, useTransition } from "react";
import { signInByEmail } from "@/app/actions/auth";

export function LoginPanel() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError("");
    startTransition(async () => {
      const result = await signInByEmail(email);
      // A successful sign-in redirect()s server-side and never returns here.
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

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
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="you@email.com"
          autoFocus
        />
      </div>
      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger, #e0665a)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" disabled={pending || !email.trim()} onClick={submit}>
        {pending ? "Signing in…" : "Continue"} <i className="ph ph-arrow-right" />
      </button>
      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
        New to Flights? Ask the organizer running your event to add your email under Access &amp; staff — you'll be
        able to sign in the moment they do.
      </p>
    </div>
  );
}
