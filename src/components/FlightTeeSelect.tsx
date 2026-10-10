"use client";
import { useState, useTransition } from "react";
import { setFlightTee } from "@/app/actions/courses";

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
}: {
  groupId: string;
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
  return (
    <>
      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
        <span className="text-muted">Tees</span>
        <select
          className="input"
          aria-label={`Tees for ${label}`}
          style={{ width: "auto", fontSize: 13, padding: "2px 6px" }}
          value={value}
          disabled={disabled || pending}
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
      {error && <span className="form-error">{error}</span>}
    </>
  );
}
