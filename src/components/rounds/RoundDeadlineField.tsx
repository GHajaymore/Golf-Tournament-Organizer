"use client";
import { setStageDeadline } from "@/app/actions/tournament";
import { dueBeforePlayed, shortDate } from "@/lib/domain/round-dates";
import FieldInfo from "@/components/FieldInfo";
import { isIsoDate } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundDeadlineField({ ctx }: { ctx: RoundCtx }) {
  const { stage, locale, deadline, setDeadline, dueError, setDueError, playedOn, pending, startTransition, playByOnFace } = ctx;
  return (
    <>
{/* ONE FIELD, NOT A HEADING, A SENTENCE AND A LABEL FOR ONE DATE
                (2026-10-16; the review panel on Ajay's "redundancies"). */}
            <div>
              <div className="field" style={{ width: 190 }}>
                <span className="field-caption">
                  <label htmlFor={`deadline-${stage.id}`}>{playByOnFace ? "Play by" : "Cards in by"}</label>
                  <FieldInfo label="the play-by date">
                    <p>
                      For a round players arrange themselves — a knockout&rsquo;s matches, a week&rsquo;s
                      league game — the last day it may be played and its result entered.
                    </p>
                  </FieldInfo>
                </span>
                {/* A date input, so it opens the platform calendar rather than
                    asking someone to guess a format. The native picker follows
                    `color-scheme`, which the app shell now sets from the club's
                    appearance, so it isn't a white popup on a dark page. */}
                <input
                  id={`deadline-${stage.id}`}
                  className="input"
                  type="date"
                  value={isIsoDate(deadline) ? deadline : ""}
                  // Open while live: `setStageDeadline` is not behind the lock.
                  disabled={pending}
                  onChange={(e) => {
                    const date = e.target.value;
                    const before = deadline;
                    setDeadline(date);
                    startTransition(async () => {
                      const res = await setStageDeadline(stage.id, date);
                      setDueError(res.ok ? "" : res.error ?? "Couldn't save that.");
                      // A refused date is not left in the box as if it were kept.
                      if (!res.ok) setDeadline(before);
                    });
                  }}
                />
                {/* A deadline saved before the round was moved later stays
                    behind it, and cannot be met. Said here, beside the box that
                    changes it (2026-10-30, Ajay's "Due Fri, Oct 23" on a round
                    played on 6 Nov). */}
                {!dueError && dueBeforePlayed(deadline, playedOn) && (
                  <p className="form-error" role="alert" style={{ margin: "4px 0 0" }}>
                    This is before the round is played ({shortDate(playedOn, locale)}). Pick that day or later.
                  </p>
                )}
                {dueError && (
                  <p className="form-error" role="alert" style={{ margin: "4px 0 0" }}>
                    {dueError}
                  </p>
                )}
                {/* Deadlines were free text, so older rounds hold things like
                    "Sat 14 Jun" that a date input cannot show. Rather than
                    render an empty box and let the next save quietly erase it,
                    the old value stays visible until someone picks a date. */}
                {deadline && !isIsoDate(deadline) && (
                  <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.4 }}>
                    Currently &ldquo;{deadline}&rdquo; — pick a date to replace it.
                  </p>
                )}
              </div>
            </div>
    </>
  );
}
