"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { approveSignup, removeSignup, setGuestEntry } from "@/app/actions/tournament";
import { GUEST_WORDS } from "@/lib/domain/guest-entry";
import { readHandicapIndex } from "@/lib/domain/handicap-label";
import { bringIntoView } from "@/lib/bring-into-view";
import { useCaughtUp } from "./useAction";
import { Icon } from "./Icon";

/** The two of the field's doors (`fieldDoors`) these rows ask: the sentence that shuts the press, or null where it is open. */
type FieldDoors = { approve: string | null; withdraw: string | null };

/**
 * THE ORGANIZER'S HALF OF GUEST SELF-ENTRY (J39/J40 PR 3B): the tick box on Entries, and the rows of guests waiting.
 * Phone-first rows (A6b): the name, when they asked and who invited them at full contrast; in a net event the one
 * box, "Handicap for today", pre-filled with what they gave; Approve and Decline, each at least 48 px.
 */

export function GuestEntrySwitch({ on, until, locked }: { on: boolean; until: string; locked: boolean }) {
  const W = GUEST_WORDS;
  const [shown, setShown] = useState(on);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const caughtUp = useCaughtUp();
  return (
    <div className="field" style={{ marginTop: 2 }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={shown}
          disabled={pending || locked}
          onChange={(e) => {
            const next = e.target.checked;
            setError("");
            setShown(next);
            start(async () => {
              try {
                const res = caughtUp(await setGuestEntry(next));
                if (!res.ok) {
                  setShown(!next);
                  setError(res.error ?? "That change was not saved.");
                }
              } catch {
                setShown(!next);
                setError("That change was not saved. Check the connection.");
              }
            });
          }}
          style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
        />
        <span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{W.switchLabel}</span>
          {shown && (
            <span className="text-muted" style={{ display: "block", fontSize: 13, marginTop: 2, lineHeight: 1.45 }} data-testid="guest-switch-hint">
              {W.switchHint(until)}
            </span>
          )}
        </span>
      </label>
      {error && (
        <p role="alert" ref={bringIntoView} className="form-error" style={{ fontSize: 13, margin: "6px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export interface GuestWaitingRow {
  id: string;
  name: string;
  /** Club time they asked, "08:12". */
  askedAt: string;
  invitedBy: string;
  /** What they declared, as a figure ("14.2"), or "" for none. */
  declared: string;
  /** The name of the entry already in the field that this one shares a name with, or "". */
  sameNameAs: string;
}

export function GuestApprovals({
  rows,
  netEvent,
  doors,
}: {
  rows: GuestWaitingRow[];
  /** Any round of the event is scored net: the committee's figure is asked (D1). */
  netEvent: boolean;
  /** The field's doors (`fieldDoors`): the sentence that shuts Approve or Decline, or null where it is open. */
  doors: FieldDoors;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="card elev-sm" style={{ borderColor: "var(--color-accent)", gap: 12 }} data-testid="guests-waiting">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="hourglass-medium" style={{ color: "var(--color-accent-200)" }} />
        <span className="card-title" style={{ fontSize: 15 }}>
          Guests asking to play ({rows.length})
        </span>
      </div>
      {doors.approve && (
        <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>
          <Icon name="lock-simple" /> {doors.approve}
        </p>
      )}
      {rows.map((r) => (
        <GuestRow key={r.id} row={r} netEvent={netEvent} approveDoor={doors.approve} withdrawDoor={doors.withdraw} />
      ))}
    </div>
  );
}

function GuestRow({ row, netEvent, approveDoor, withdrawDoor }: { row: GuestWaitingRow; netEvent: boolean; approveDoor: string | null; withdrawDoor: string | null }) {
  const W = GUEST_WORDS;
  const [figure, setFigure] = useState(row.declared);
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  const [pending, start] = useTransition();

  const typed = readHandicapIndex(figure);
  const figureValue = typed.kind === "index" ? typed.value : null;
  const figureBad = typed.kind === "unreadable" || typed.kind === "out-of-range";
  // In a net event no figure, no approval: said in words beside the box, not a bare grey button.
  const needsFigure = netEvent && figureValue === null;
  const hint = !netEvent ? W.grossOnly : row.declared ? W.theyGave(row.declared) : W.noFigure;

  if (approved) {
    return (
      <p style={{ fontSize: 14, margin: 0 }} data-testid="guest-approved">
        <Icon name="check" /> {row.name}: {W.inTheField} · <Link href="/stages">{W.putInGroup}</Link>
      </p>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }} data-testid="guest-waiting-row">
      <div style={{ fontSize: 16, fontWeight: 600 }}>{row.name}</div>
      <div style={{ fontSize: 14 }}>
        {W.asked(row.askedAt)} · {row.invitedBy ? W.invitedBy(row.invitedBy) : W.noInviter}
      </div>
      {row.sameNameAs && (
        <p style={{ fontSize: 14, margin: 0, fontWeight: 600 }} data-testid="same-name">
          <Icon name="warning" /> {W.sameName(row.sameNameAs)}
        </p>
      )}
      {netEvent && (
        <div className="field">
          <label htmlFor={`fig-${row.id}`} style={{ fontSize: 14, fontWeight: 600 }}>
            {W.figureBoxLabel}
          </label>
          <input
            id={`fig-${row.id}`}
            className="input"
            inputMode="decimal"
            autoComplete="off"
            maxLength={12}
            value={figure}
            onChange={(e) => setFigure(e.target.value)}
            style={{ fontSize: 16, minHeight: 48, maxWidth: 160 }}
          />
        </div>
      )}
      <p className="text-muted" style={{ fontSize: 14, margin: 0 }} data-testid="figure-hint">
        {hint}
      </p>
      {error && (
        <p role="alert" ref={bringIntoView} className="form-error" style={{ fontSize: 14, margin: 0 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 48, minWidth: 120, fontSize: 15 }}
          disabled={pending || !!approveDoor || needsFigure || figureBad}
          onClick={() =>
            start(async () => {
              setError("");
              const res = await approveSignup(row.id, netEvent ? figureValue : undefined);
              if (!res.ok) setError(`${row.name}: ${res.error ?? "That did not save."}`);
              else setApproved(true);
            })
          }
        >
          <Icon name="check" /> {row.sameNameAs ? W.approveDifferent : "Approve"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ minHeight: 48, minWidth: 120, fontSize: 15 }}
          disabled={pending || !!withdrawDoor}
          onClick={() => {
            if (!window.confirm(W.declineConfirm(row.name))) return;
            start(async () => {
              setError("");
              const res = await removeSignup(row.id);
              if (!res.ok) setError(`${row.name}: ${res.error}`);
            });
          }}
        >
          {row.sameNameAs ? W.declineAlready : "Decline"}
        </button>
      </div>
    </div>
  );
}
