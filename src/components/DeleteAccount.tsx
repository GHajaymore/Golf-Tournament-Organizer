"use client";
import { useId, useState, useTransition } from "react";
import { deleteMyAccount } from "@/app/actions/account";
import { ConfirmButton } from "./ConfirmButton";

/**
 * Delete my account (2026-10-03). The rule is in `domain/account-deletion.ts`.
 * Says exactly what goes and what the clubs keep, asks for the email address,
 * and takes two presses — `ConfirmButton`, like every control that destroys
 * something here.
 *
 * With a club this person alone owns, the page shows the sentence that says
 * what to do first instead of a form that would only refuse.
 */
export function DeleteAccount({ email, soleOwnerOf }: { email: string; soleOwnerOf: string[] }) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    setError("");
    startTransition(async () => {
      // Only returns when it refuses; on success it signs out and redirects.
      const res = await deleteMyAccount(typed);
      if (res && !res.ok) setError(res.error);
    });
  };

  return (
    <section className="card elev-sm" aria-labelledby={`${inputId}-title`} style={{ gap: 10 }}>
      <h2 id={`${inputId}-title`} className="card-title" style={{ fontSize: 15, color: "var(--color-danger)" }}>
        Delete my account
      </h2>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
        Deletes your sign-in and everything that gives you access: your staff roles in any club or
        tournament, the phones you turned notifications on for, and your place in club conversations.
        It cannot be undone.
      </p>
      <p className="text-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
        What a club keeps about you stays with the club &mdash; your entries and scores in its tournaments,
        its roster details, messages you wrote in its conversations. Ask the club to remove those; it can
        do it directly.
      </p>
      {soleOwnerOf.length > 0 ? (
        <p role="note" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
          You&rsquo;re the only owner of <strong>{soleOwnerOf.join(", ")}</strong>. Give{" "}
          {soleOwnerOf.length === 1 ? "it" : "each of them"} another owner in Staff &amp; access, or delete{" "}
          {soleOwnerOf.length === 1 ? "it" : "them"} from its settings, first.
        </p>
      ) : (
        <>
          <label htmlFor={inputId} style={{ fontSize: 12.5, fontWeight: 500 }}>
            Type <strong>{email}</strong> to confirm
          </label>
          <input
            id={inputId}
            className="input"
            type="email"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={{ maxWidth: 360 }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <ConfirmButton
              onConfirm={confirm}
              label={pending ? "Deleting…" : "Delete my account"}
              confirmLabel="Delete my account for good"
              title="Delete your account and your access"
              className="btn btn-secondary"
              style={{ color: "var(--color-danger)" }}
              disabled={pending}
              note="You'll be signed out."
            />
          </div>
          {error && (
            <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--color-danger)" }}>
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
