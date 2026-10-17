"use client";
import { setThirdPlace, createThirdPlaceMatch } from "@/app/actions/tournament";
import { THIRD_PLACE_HELP } from "@/lib/domain/third-place";
import { Icon } from "./Icon";
import { useOptimistic, useTransition } from "react";
import { useAction } from "./useAction";

/**
 * Whether this knockout plays off for third, and making the match.
 *
 * Off by default and stated as a choice rather than a checkbox nobody reads:
 * plenty of clubs send everyone to the bar instead, and the two beaten
 * semi-finalists are exactly the people least likely to want another match.
 *
 * The pairing is shown before it is committed, and the reason shown when it
 * cannot be — "waiting on the semi-finals" is the ordinary state right up
 * until the day, and an empty box there reads as something broken.
 */
export function ThirdPlaceControl({
  stageId,
  on,
  problem,
  aName,
  bName,
  made,
  locked = false,
}: {
  stageId: string;
  on: boolean;
  /** Why there is no pairing yet. Empty when there is one. */
  problem: string;
  aName: string;
  bName: string;
  /** The play-off has already been created. */
  made: boolean;
  /**
   * Setup is locked. Only the SWITCH follows it — `setThirdPlace` is setup and
   * refuses a locked tournament. Creating the play-off does not: the beaten
   * semi-finalists are only known mid-event (Ajay, 2026-09-27).
   */
  locked?: boolean;
}) {
  const { pending, error, setError, run } = useAction();
  /**
   * THE TICK FOLLOWS THE FINGER (2026-10-16). It waited for the server, so on
   * one bar a tap looked like nothing happened, and a second tap undid the first.
   * Shown at once, and put back with the reason if the server says no.
   */
  const [shownOn, showOn] = useOptimistic(on);
  const [switching, startSwitch] = useTransition();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={shownOn}
          disabled={pending || switching || locked}
          onChange={(e) => {
            const next = e.target.checked;
            startSwitch(async () => {
              setError("");
              showOn(next);
              try {
                const res = await setThirdPlace(stageId, next);
                if (!res.ok) setError(res.error ?? "That change was not saved.");
              } catch {
                setError("That change was not saved. Check the connection, and that setup is unlocked.");
              }
            });
          }}
          style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
        />
        <span>
          <span style={{ fontWeight: 500 }}>Play-off for third place</span>
          <span className="text-muted" style={{ display: "block", fontSize: 13, lineHeight: 1.6 }}>
            {THIRD_PLACE_HELP}
          </span>
        </span>
      </label>

      {shownOn && (
        <div
          style={{
            padding: "9px 11px",
            borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {made ? (
            <span className="text-muted">
              <Icon name="check-circle" /> The play-off is made — {aName} v {bName}. Enter its result on
              Score entry.
            </span>
          ) : problem ? (
            <span className="text-muted">
              <Icon name="hourglass" /> {problem}
            </span>
          ) : (
            <>
              <strong>{aName} v {bName}</strong>
              <br />
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => run(() => createThirdPlaceMatch(stageId))}
                style={{ marginTop: 7 }}
              >
                <Icon name="flag-checkered" /> Create the play-off
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="form-error">
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
