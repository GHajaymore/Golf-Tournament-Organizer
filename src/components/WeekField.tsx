"use client";
import { useState, useTransition } from "react";
import { setAttendance } from "@/app/actions/attendance";
import {
  ATTENDANCE_MODE_HELP,
  playersAnswer,
  type AttendanceMode,
} from "@/lib/domain/attendance";
import { Icon } from "./Icon";

export interface WeekFieldRow {
  playerId: string;
  name: string;
  status: "in" | "out";
  /** Whether that is somebody's stated answer, or the league's default. */
  explicit: boolean;
  /** Who recorded it — "" when nobody has. */
  decidedBy: string;
}

/**
 * Who is playing this week, and the staff control that says so.
 *
 * `setAttendance` has always allowed staff to answer for anyone, at any time,
 * and its own comment says why: "the organizer marking a Wednesday-morning
 * no-show is who the freeze protects, not obstructs". Nothing in the app ever
 * called it that way. The only writer was the player's own availability card,
 * so the promise on the Rounds screen — "after it, changes go through you" —
 * went through nobody, and a player who forgot to opt out before the deadline
 * stayed on the sheet with no way for the committee to take them off.
 *
 * `captains` mode was worse than incomplete, it was a dead end. Its help text
 * says the captains send their pairs in and "your staff enter them"; there was
 * nowhere to enter them. Because `defaultStatus("captains")` is OUT, a league
 * on that mode resolved every player to out, drew its tee sheet from an empty
 * field, and refused with "nobody is entered yet — add players to the field"
 * over a full roster. Six confirmed players, a link to Registration, and no
 * move that would have helped.
 *
 * SO IT LIVES ON THE TEE SHEET, not on a screen of its own. This is the list
 * the sheet below is drawn from, and the moment an organizer needs to correct
 * it is the moment they are looking at the draw it produced. A separate screen
 * would be one more place to remember, on the morning of the round, which is
 * when nobody remembers anything.
 *
 * Open or closed by default follows the mode, because the two are different
 * jobs. Under `captains` this panel IS the sign-up — nothing else in the app
 * can put a player in — so it opens. Under opt-in and opt-out the players have
 * answered for themselves and this is a correction tool, so it stays folded
 * and shows its counts.
 */
export function WeekField({
  stageId,
  roundLabel,
  mode,
  rows,
  canEdit,
}: {
  stageId: string;
  /** "Round 3" — which week this list is for. */
  roundLabel: string;
  mode: AttendanceMode;
  rows: WeekFieldRow[];
  canEdit: boolean;
}) {
  // Under `captains` nothing else can put a player in, so the control that can
  // is not hidden behind a disclosure.
  const [open, setOpen] = useState(!playersAnswer(mode));
  const [byPlayer, setByPlayer] = useState<Record<string, "in" | "out">>(() =>
    Object.fromEntries(rows.map((r) => [r.playerId, r.status])),
  );
  const [explicitBy, setExplicitBy] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((r) => [r.playerId, r.explicit])),
  );
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const answer = (playerId: string, status: "in" | "out") => {
    setError("");
    const before = byPlayer[playerId];
    const beforeExplicit = explicitBy[playerId];
    setByPlayer((m) => ({ ...m, [playerId]: status }));
    setExplicitBy((m) => ({ ...m, [playerId]: true }));
    startTransition(async () => {
      const res = await setAttendance(stageId, playerId, status);
      if (!res.ok) {
        setByPlayer((m) => ({ ...m, [playerId]: before }));
        setExplicitBy((m) => ({ ...m, [playerId]: beforeExplicit }));
        setError(res.error ?? "Couldn't save that.");
      }
    });
  };

  const inCount = rows.filter((r) => byPlayer[r.playerId] === "in").length;
  const outCount = rows.length - inCount;
  const byDefault = rows.filter(
    (r) => byPlayer[r.playerId] === "in" && !explicitBy[r.playerId],
  ).length;

  return (
    <div
      className="card elev-sm"
      style={{ marginBottom: 16, gap: 8, borderLeft: "3px solid var(--color-accent)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="card-title" style={{ fontSize: 14 }}>
          Who is playing {roundLabel}
        </span>
        <span className="text-muted" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          {inCount} in
          {byDefault > 0 && ` (${byDefault} by default)`} · {outCount} out
        </span>
        {canEdit && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "2px 10px", fontSize: 12, marginLeft: "auto" }}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? "caret-up" : "caret-down"} /> {open ? "Hide the list" : "Edit the list"}
          </button>
        )}
      </div>

      {/* What this mode means, in the mode's own words rather than a second
          copy of them. A secretary who inherited an opt-in league is being
          told why sixteen people are out having done nothing wrong. */}
      <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.5 }}>
        {ATTENDANCE_MODE_HELP[mode]}
        {playersAnswer(mode)
          ? " You can change any answer here at any time — the sign-up deadline binds players, not you."
          : ""}
      </p>

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      {open && canEdit && (
        <div className="table-scroll">
          <table className="table" style={{ fontSize: 12.5 }}>
            <thead>
              <tr>
                <th>Player</th>
                <th style={{ width: 150 }}>This week</th>
                {/* "Why am I not playing this week" has to have a name in the
                    answer, so the row carries whoever recorded it. */}
                <th>Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td>
                    <div className="seg">
                      <label className="seg-opt">
                        <input
                          type="radio"
                          name={`week-${stageId}-${r.playerId}`}
                          checked={byPlayer[r.playerId] === "in"}
                          disabled={pending}
                          onChange={() => answer(r.playerId, "in")}
                        />
                        In
                      </label>
                      <label className="seg-opt">
                        <input
                          type="radio"
                          name={`week-${stageId}-${r.playerId}`}
                          checked={byPlayer[r.playerId] === "out"}
                          disabled={pending}
                          onChange={() => answer(r.playerId, "out")}
                        />
                        Out
                      </label>
                    </div>
                  </td>
                  <td className="text-muted">
                    {explicitBy[r.playerId] ? r.decidedBy || "—" : "nobody yet — league default"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-muted" style={{ padding: "10px 6px" }}>
                    Nobody is in the field yet, so there is nobody to mark in or out.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!canEdit && (
        <p className="text-muted" style={{ fontSize: 11.5, margin: 0 }}>
          Only an organizer can change who is playing.
        </p>
      )}
    </div>
  );
}
