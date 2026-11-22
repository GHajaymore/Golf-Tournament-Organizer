"use client";
import { setStageOptDeadline } from "@/app/actions/attendance";
import { isIsoDate } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundSignUp({ ctx }: { ctx: RoundCtx }) {
  const { stage, optError, setOptError, pending, startTransition } = ctx;
  return (
    <>
{stage.attendance && (
              <div className="field" style={{ maxWidth: 420 }}>
                <label htmlFor={`opt-deadline-${stage.id}`}>Sign-up deadline</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    id={`opt-deadline-${stage.id}`}
                    className="input"
                    type="date"
                    style={{ width: 170 }}
                    defaultValue={isIsoDate(stage.optDeadline) ? stage.optDeadline : ""}
                    disabled={pending}
                    onChange={(e) => {
                      const date = e.target.value;
                      startTransition(async () => {
                        const res = await setStageOptDeadline(stage.id, date);
                        setOptError(res.ok ? "" : res.error ?? "Couldn't save that.");
                      });
                    }}
                  />
                  <span className="text-muted" style={{ fontSize: 13 }}>
                    {stage.attendance.in} in
                    {stage.attendance.inByDefault > 0 && ` (${stage.attendance.inByDefault} by default)`}
                    {" · "}
                    {stage.attendance.out} out
                  </span>
                </div>
                {optError && (
                  <p className="form-error" role="alert" style={{ margin: "4px 0 0" }}>
                    {optError}
                  </p>
                )}
                <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.4 }}>
                  {stage.attendance.playersAnswer
                    ? "Players may answer until the end of this day; after it, changes go through you."
                    : "Players are never asked in this mode — you record the list the captains send in."}{" "}
                  {/* To THIS round's sheet, not to whichever one the tee sheet
                      screen would have picked for itself. A deadline set on
                      Round 6 that sends an organizer to Round 3 is a link that
                      changes the subject. */}
                  <a href={`/foursomes?round=${stage.id}`} style={{ color: "var(--color-accent-200)" }}>
                    Set who is playing
                  </a>
                  .
                </p>
              </div>
            )}
    </>
  );
}
