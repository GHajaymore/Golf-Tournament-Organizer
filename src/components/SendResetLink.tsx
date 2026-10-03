"use client";
import { useState, useTransition } from "react";
import { requestPasswordReset } from "@/app/actions/auth";

/**
 * "Change my password", from the account page (2026-10-03).
 *
 * The page used to say "sign out and choose Forgot? on the sign-in form" —
 * sending somebody out of the app to do, by hand, the one thing the page could
 * do for them. This calls the same `requestPasswordReset` the Forgot form does:
 * same rate limit, same email, same answer whether or not anything was sent,
 * so it reveals nothing the public form does not.
 */
export function SendResetLink({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      const res = await requestPasswordReset(email);
      if (res.ok) setState("sent");
      else {
        setError(res.error ?? "Couldn't send it just now. Try again in a moment.");
        setState("error");
      }
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
        We&rsquo;ll email a link to <strong>{email}</strong> to choose a new one. It works for 15 minutes.
      </p>
      {state === "sent" ? (
        <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--color-accent-2-200)" }}>
          Sent &mdash; check {email}. Nothing changes until you use the link.
        </p>
      ) : (
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={send}>
          {pending ? "Sending…" : "Email me a reset link"}
        </button>
      )}
      {state === "error" && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--color-danger)" }}>{error}</p>
      )}
    </div>
  );
}
