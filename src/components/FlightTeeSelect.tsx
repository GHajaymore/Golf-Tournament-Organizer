"use client";
import { useState, useTransition } from "react";
import { setFlightTee } from "@/app/actions/courses";
import { Icon } from "./Icon";

/**
 * THE TEES A FLIGHT PLAYS, ON FLIGHTS THE APP DREW (2026-10-10).
 *
 * "Each flight plays its own tees" is how a club runs its divisions off
 * different sets — and the control that names a flight's set existed only on
 * `FlightBoard`, which is shown only under the Manual rule. A club that let the
 * app draw its handicap divisions, which is the natural rule for exactly this,
 * could turn the policy on and then had nowhere to say which flight plays
 * which tees. Found setting up a three-division net medal with the third
 * division off the reds.
 *
 * The same select `FlightBoard` draws, through the same action, for the grid
 * of generated flights. The organizer's, as `setFlightTee` is.
 */
export function FlightTeeSelect({
  groupId,
  label,
  teeId,
  tees,
  defaultTeeName,
  disabled = false,
  teesDoor,
}: {
  groupId: string;
  /**
   * WHY A FLIGHT'S TEES CANNOT CHANGE NOW, or null — the rounds rule's
   * sentence (`acrossRoundsRefusal(…, "field-tees")`, the very call
   * `setFlightTee` refuses with): a scored round of cards would be reached, its
   * handicaps frozen off its tees at its first card, or the tournament is
   * completed. REQUIRED, so the box is drawn shut with it rather than offered
   * and then refused.
   */
  teesDoor: string | null;
  /** The flight's name, for the control's own label. */
  label: string;
  teeId: string | null;
  tees: { id: string; name: string }[];
  /** What a flight claiming no set plays — "White (round's)". */
  defaultTeeName: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(teeId ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  /** The rounds rule's refusal, or null: an empty sentence is never a reason to shut anything. */
  const shutBy = teesDoor || null;
  const doorId = `flight-tees-door-${groupId}`;
  return (
    <>
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
        <span className="text-muted">Tees</span>
        <select
          className="input"
          aria-label={`Tees for ${label}`}
          style={{ width: "auto", fontSize: 13, padding: "2px 6px" }}
          value={value}
          disabled={disabled || pending || shutBy !== null}
          aria-describedby={shutBy !== null ? doorId : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setError("");
            startTransition(async () => {
              const res = await setFlightTee(groupId, next || null);
              if (res.ok) setValue(next);
              else setError(res.error ?? "Couldn't set those tees.");
            });
          }}
        >
          <option value="">{defaultTeeName || "The round's tees"}</option>
          {tees.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      {/* Why it is shut, under it, before anybody presses (J12, PR 7b). Not where it is shut by a
          lock or a role: the screen's banner says the lock, and a reader with no press needs no reason. */}
      {shutBy !== null && !disabled && (
        <span id={doorId} data-testid="flight-tees-door" className="text-muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          <Icon name="lock-simple" /> {shutBy}
        </span>
      )}
      {error && <span className="form-error">{error}</span>}
    </>
  );
}
