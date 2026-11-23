"use client";
import { useId } from "react";
import { eventWords } from "@/lib/domain/event-words";
import { useGolfRegister } from "@/components/GolfTermsProvider";
import { Icon } from "../Icon";

/**
 * WHEN IT IS PLAYED: both date blocks as they were. Lifted out of `EventSetupClient` (R3-1), no
 * behaviour change; Event (R3) mounts it and merges the two Saves. The draft and the dates' own
 * Save stay in the caller, which is where `setTournamentDates` is called.
 */
export function EventWhen({
  playKind,
  label,
  startOn,
  endOn,
  tentative,
  dirty,
  saving,
  onStart,
  onEnd,
  onTentative,
  onSaveDates,
}: {
  playKind: string;
  /** The dates as a sentence, derived from them — never typed. */
  label: string;
  startOn: string;
  endOn: string;
  tentative: boolean;
  /** The dates differ from what is stored: their own Save is offered. */
  dirty: boolean;
  saving: boolean;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  onTentative: (v: boolean) => void;
  onSaveDates: () => void;
}) {
  const register = useGolfRegister();
  const words = eventWords(playKind, register);
  const fid = useId();
  return (
    <div className="pair-grid">
      <div className="field">
        <label htmlFor={`${fid}-start`}>
          {words.kind} dates{" "}
          {!label.trim() && <span style={{ color: "var(--color-accent-200)" }}>· required to launch</span>}
        </label>
        {/* `minWidth: 0` on the inputs, not just `flex: 1`. A native date input's intrinsic minimum is
            its own chrome, and a flex item will not shrink below that unless it is told it may. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input id={`${fid}-start`} aria-label="Tournament dates, first day" className="input" type="date" value={startOn} onChange={(e) => onStart(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <span className="text-muted">–</span>
          <input aria-label="Tournament dates, last day" className="input" type="date" value={endOn} min={startOn || undefined} onChange={(e) => onEnd(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        </div>
        {label && <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>{label}</p>}
        {/* TENTATIVE IS A REAL ANSWER (2026-09-19). A club fixes its calendar months before it fixes a
            tee time; this is how a club gives dates honestly before they are settled. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, minHeight: 44 }}>
          <input
            type="checkbox"
            checked={tentative}
            onChange={(e) => onTentative(e.target.checked)}
          />
          These dates are tentative
        </label>
        {/* ITS OWN SAVE, because the dates outlive the setup lock. A tentative date becomes a fixed one
            weeks later, by which time the tournament is live and `saveEvent` refuses every field on
            this screen. `setTournamentDates` is not behind the lock, for the reason written beside it. */}
        {dirty && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={onSaveDates}
            >
              <Icon name="check" /> {saving ? "Saving…" : "Save dates"}
            </button>
            {/* SAYS THEY ARE NOT SAVED, because they are not (found 2026-09-26): the line shows only
                while the dates differ from what is stored. */}
            <span className="text-muted" style={{ fontSize: 13 }}>
              Not saved yet. Dates have their own Save, so they can still be changed after launch.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
