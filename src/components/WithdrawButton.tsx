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
 *
 * SOMEBODY ON THE WAITING LIST HAS NO PLACE TO GIVE AWAY. Walked 2026-09-28:
 * a member on the Am-Am's list was asked "If the field is full, your place goes
 * to the next person on the waiting list" and offered "Keep my place" — neither
 * is true of them. What they lose is their spot in the queue, so that is what
 * they are told.
 */
export function withdrawWords(
  waiting: boolean,
  /** Within `waiting`: with the organizer to approve, which is no queue at all. */
  awaiting = false,
): { consequence: string; keep: string; done: string } {
  if (waiting && awaiting) {
    return {
      consequence: "Your entry is withdrawn before it’s approved.",
      keep: "Keep my entry",
      done: "You’ve withdrawn your entry.",
    };
  }
  return waiting
    ? {
        consequence: "You’ll lose your spot in the queue.",
        keep: "Stay on the list",
        done: "You’ve come off the waiting list.",
      }
    : {
        consequence: "If the field is full, your place goes to the next person on the waiting list.",
        keep: "Keep my place",
        done: "You’ve withdrawn. If there was a waiting list, your place has gone to the next person on it.",
      };
}

export function WithdrawButton({
  eventId,
  eventName,
  waiting = false,
  awaiting = false,
}: {
  eventId: string;
  eventName: string;
  /** On the waiting list rather than in the field. */
  waiting?: boolean;
  /** Within `waiting`: with the organizer to approve rather than queuing. */
  awaiting?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const words = withdrawWords(waiting, awaiting);

  if (done) {
    return (
      <span className="text-muted" style={{ fontSize: 13 }} role="status">
        {words.done}
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
          color: "var(--color-accent-200)",
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
        Take your name off {waiting && !awaiting ? "the waiting list for " : ""}
        <strong>{eventName}</strong>? {words.consequence}
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
          {words.keep}
        </button>
      </div>
      {error && (
        <span className="text-muted" role="alert" style={{ fontSize: 13 }}>
          {error}
        </span>
      )}
    </div>
  );
}
