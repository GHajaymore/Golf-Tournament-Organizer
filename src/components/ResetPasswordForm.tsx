"use client";
import { useState, useTransition } from "react";
import { resetPassword } from "@/app/actions/auth";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError("");
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
          placeholder="At least 8 characters"
          autoFocus
        />
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
        />
      </div>
      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger, #e0665a)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" disabled={pending || password.length < 8} onClick={submit}>
        {pending ? "Saving…" : "Set password & sign in"} <i className="ph ph-arrow-right" />
      </button>
    </div>
  );
}
