"use client";
import { useId, useState, useTransition } from "react";
import { deleteClub } from "@/app/actions/club-deletion";
import { ConfirmButton } from "./ConfirmButton";

/**
 * The owner's way to delete the club (2026-10-03). The rule is in
 * `domain/club-deletion.ts`; this says what goes, asks for the name, and takes
 * two presses — `ConfirmButton`, like every other control here that destroys
 * something.
 *
 * In the organization's OWN word — club, society, outing — because the page
 * above it is titled that way ("Society settings"), and a society's owner
 * being asked to "delete this club" reads like the wrong screen.
 *
 * Shown to the owner only. With a paid plan still running, the page shows the
 * sentence that says what to do instead of a form that would only refuse.
 */
export function DeleteClub({
  clubName,
  noun,
  paidPlanRunning,
}: {
  clubName: string;
  /** "club", "society", "outing" — from `orgProfile(...).noun`. */
  noun: string;
  paidPlanRunning: boolean;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    setError("");
    startTransition(async () => {
      // Only returns when it refuses; on success it redirects away.
      const res = await deleteClub(typed);
      if (res && !res.ok) setError(res.error);
    });
  };

  return (
    <section className="card elev-sm" aria-labelledby={`${inputId}-title`} style={{ gap: 10 }}>
      <h2 id={`${inputId}-title`} className="card-title" style={{ fontSize: 15, color: "var(--color-danger)" }}>
        Delete this {noun}
      </h2>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
        Deletes <strong>{clubName}</strong> and everything in it, for good: every tournament with its
        entries, cards, results and money, the member roster, staff access and settings. It cannot be
        undone. Your own account stays, along with anything else you belong to.
      </p>
      {paidPlanRunning ? (
        <p className="text-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
          This {noun} has a paid plan running. Cancel it in Manage billing above first; once the plan has
          ended, the {noun} can be deleted here.
        </p>
      ) : (
        <>
          <label htmlFor={inputId} style={{ fontSize: 12.5, fontWeight: 500 }}>
            Type <strong>{clubName}</strong> to confirm
          </label>
          <input
            id={inputId}
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            style={{ maxWidth: 360 }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <ConfirmButton
              onConfirm={confirm}
              label={pending ? "Deleting…" : `Delete ${noun}`}
              confirmLabel={`Delete the ${noun} for good`}
              title={`Delete this ${noun} and everything in it`}
              className="btn btn-secondary"
              style={{ color: "var(--color-danger)" }}
              disabled={pending}
              note="Every tournament, card and result goes with it."
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
