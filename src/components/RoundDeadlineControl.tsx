"use client";
import { useState, useTransition } from "react";
import { setStageDeadlineOverride } from "@/app/actions/tournament";
import { deadlineState } from "@/lib/deadline";

/**
 * Close a round early, or keep it open past its deadline.
 *
 * A deadline is a plan, and the day itself rarely respects it — a fourball is
 * still on the 17th as the clock runs out, or the whole field finished by two
 * and there is no reason to leave scoring open all evening. Without this, an
 * organizer's only options were to edit the date to a lie or to let the round
 * close on someone still playing.
 *
 * Three states, and the override is deliberately tri-state rather than a
 * checkbox: null means "follow the date", which is different from both "closed
 * regardless" and "open regardless". Collapsing that to a boolean would make
 * an extension permanent — the round would stay open next season too.
 */
export function RoundDeadlineControl({
  stageId,
  roundLabel,
  deadline,
  override,
  locked = false,
}: {
  stageId: string;
  roundLabel: string;
  deadline: string;
  /** true = closed by hand, false = extended past the date, null = follow it. */
  override: boolean | null;
  locked?: boolean;
}) {
  const [current, setCurrent] = useState<boolean | null>(override);
  const [pending, startTransition] = useTransition();

  const status = deadlineState(deadline, current);

  const set = (next: boolean | null) => {
    setCurrent(next);
    startTransition(() => setStageDeadlineOverride(stageId, next));
  };

  const label: Record<string, string> = {
    open: "Open — scores can be entered",
    closed: "Closed — the deadline has passed",
    "closed-manual": "Closed early by the organizer",
    extended: "Extended past the deadline",
  };

  const tone = status.open ? "tag-accent" : "tag-neutral";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className={`tag ${tone}`} style={{ fontSize: 11 }}>
          <i className={status.open ? "ph ph-lock-open" : "ph ph-lock"} /> {label[status.state]}
        </span>
        {status.overridden && (
          <span className="text-muted" style={{ fontSize: 11 }}>
            Overriding the date
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {/* "Follow the deadline" is the resting state and is offered as an
            explicit way back, so an override is never a one-way door. */}
        <button
          type="button"
          className="btn"
          disabled={locked || pending || current === null}
          style={{ fontSize: 12, padding: "3px 9px" }}
          onClick={() => set(null)}
        >
          Follow the date
        </button>
        <button
          type="button"
          className="btn"
          disabled={locked || pending || current === true}
          style={{ fontSize: 12, padding: "3px 9px" }}
          onClick={() => set(true)}
        >
          <i className="ph ph-lock" /> Close {roundLabel} now
        </button>
        <button
          type="button"
          className="btn"
          disabled={locked || pending || current === false}
          style={{ fontSize: 12, padding: "3px 9px" }}
          onClick={() => set(false)}
        >
          <i className="ph ph-clock-clockwise" /> Keep it open
        </button>
      </div>

      <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.45, maxWidth: "62ch" }}>
        {status.state === "extended"
          ? "Scores are still being accepted even though the date has passed. Set it back to follow the date once the last card is in."
          : status.state === "closed-manual"
            ? "No further scores for this round, whatever the date says."
            : "Scoring follows the completion deadline above."}
      </p>
    </div>
  );
}
