"use client";
import { useState, useTransition } from "react";
import { reportBracketResult } from "@/app/actions/tournament";
import { tieReportSentence } from "@/lib/domain/my-tie";

/**
 * A PLAYER REPORTS THEIR KNOCKOUT TIE, and the club approves it (Ajay,
 * 2026-09-28). Knockout ties are usually played when the two players can
 * arrange it, so the people who know the result first are the two who played.
 *
 * What it says afterwards is the point: a report is not a result. The draw on
 * the board does not move until the organizer approves it, so the card says
 * who is waiting on whom rather than congratulating anybody.
 */
export function ReportTie({
  tieKey,
  meId,
  opponentId,
  opponent,
  waiting,
  organizer = "organizer",
}: {
  /** The club's word for who runs it — organizer or organiser (`golf-terms.ts`). */
  organizer?: string;
  tieKey: string;
  meId: string;
  opponentId: string;
  opponent: string;
  /** A report already waiting on the organizer, from either player. */
  waiting: { winnerName: string; result: string; reportedBy: string; byMe: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  const [winner, setWinner] = useState("");
  const [margin, setMargin] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError("");
    startTransition(async () => {
      const r = await reportBracketResult(tieKey, winner, margin);
      if (r.ok) setOpen(false);
      else setError(r.error ?? "That didn't save. Try again.");
    });
  };

  if (waiting && !open) {
    return (
      <div style={{ marginTop: 10 }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          {tieReportSentence(waiting)} Waiting for the {organizer} to approve it.
        </p>
        <button type="button" className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>
          Change the report
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        Report the result
      </button>
    );
  }

  return (
    <form
      style={{ marginTop: 12, display: "grid", gap: 10 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (winner) submit();
      }}
    >
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        <legend style={{ fontSize: 13, marginBottom: 4 }}>Who won?</legend>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15 }}>
          <input type="radio" name={`tie-${tieKey}`} checked={winner === meId} onChange={() => setWinner(meId)} />
          I won
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15 }}>
          <input
            type="radio"
            name={`tie-${tieKey}`}
            checked={winner === opponentId}
            onChange={() => setWinner(opponentId)}
          />
          {opponent} won
        </label>
      </fieldset>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        By how much (optional)
        <input
          className="input"
          value={margin}
          maxLength={24}
          placeholder="e.g. 3&2, 1 up, 19th"
          onChange={(e) => setMargin(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-neutral-400)" }}>
        The {organizer} approves it before the draw moves on.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary" disabled={!winner || pending}>
          {pending ? "Sending…" : `Send to the ${organizer}`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
