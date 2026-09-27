"use client";

import React, { useState, useTransition } from "react";
import { withdrawMyEntry } from "@/app/actions/enter";

/**
 * "CAN'T MAKE IT?" — a member takes their own name off, until entries close.
 *
 * Ajay's decision, 2026-09-26: entering is one tap and there was no way back
 * short of asking the organizer. `withdrawMyEntry` does the organizer's removal
 * for the member's own entry, and `ClubEventRow.canWithdraw` decides whether to
 * offer it with the same rule the action enforces.
 *
 * TWO STEPS, where entering is one. Putting a name down by mistake costs a
 * second tap to undo; taking it off by mistake can hand a full field's place to
 * the next person on the waiting list, and that is not undone by entering
 * again — the returning member queues at the back. So the first press only
 * asks, and says what will happen to the place.
 *
 * NO `router.refresh()`, for the reason `EnterButton` gives: the action
 * revalidates the screens it changes, and this must render on its own in
 * `render.test.tsx`.
 */
export function WithdrawButton({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  if (done) {
    return (
      <span className="text-muted" style={{ fontSize: 13 }} role="status">
        You&rsquo;ve withdrawn. If there was a waiting list, your place has gone to the next person on it.
      </span>
    );
  }

  if (!asking) {
    return (
      <button
        type="button"
        className="btn-link"
        style={{
          alignSelf: "flex-start",
          fontSize: 13,
          padding: 0,
          background: "none",
          border: "none",
          color: "var(--color-accent-300)",
          cursor: "pointer",
          textDecoration: "underline",
        }}
        onClick={() => setAsking(true)}
      >
        Can&rsquo;t make it? Withdraw
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Withdraw from ${eventName}`}
      style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}
    >
      <span>
        Take your name off <strong>{eventName}</strong>? If the field is full, your place goes to the next
        person on the waiting list.
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          style={{ flex: "1 1 140px" }}
          onClick={() =>
            start(async () => {
              setError("");
              const res = await withdrawMyEntry(eventId);
              if (res.ok) setDone(true);
              else setError(res.error ?? "That didn't work.");
            })
          }
        >
          {pending ? "Withdrawing…" : "Withdraw"}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          style={{ flex: "1 1 140px" }}
          onClick={() => setAsking(false)}
        >
          Keep my place
        </button>
      </div>
      {error && (
        <span className="text-muted" role="alert" style={{ fontSize: 12.5 }}>
          {error}
        </span>
      )}
    </div>
  );
}
