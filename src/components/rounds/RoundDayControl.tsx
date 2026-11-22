"use client";
import { roundLabel as roundLabelOf } from "@/lib/domain/round-label";
import { COMPLETED_DATES } from "@/lib/domain/round-change";
import { shortDate } from "@/lib/domain/round-dates";
import FieldInfo from "@/components/FieldInfo";
import { isKnockoutRound } from "@/lib/stage-types";
import type { RoundCtx } from "./use-round-ctx";

export function RoundDayControl({ ctx }: { ctx: RoundCtx }) {
  const { stage, allStages, locale, playedOn, dateRefused, dateSaid, doors, shut, pending, commitPlayedOn } = ctx;
  return (
    <>
{/* Not on a knockout (2026-10-16): its ties are played over weeks, and Play by
            is the date that matters — two dates for one question was a redundancy. */}
        {!isKnockoutRound(stage.type) && (
        <>
        {/* The day this round is played — and, when a week is rained off, the
            one field the committee needs. Changing it moves this round only;
            the rest of the season and every score already entered stay put. */}
        <div className="field" style={{ width: 172 }}>
          <span className="field-caption">
            Played on
            <FieldInfo label="the day this round is played">
              <p>
                The day the field actually goes out. A fixed-day league plays <i>on</i> a day; the
                deadline below is for rounds where players arrange their own match and must finish
                by a date.
              </p>
              <p>
                <b>Rained off?</b> Change the date here. It moves this round alone — the other
                weeks and any scores already entered are untouched.
              </p>
            </FieldInfo>
          </span>
          <input
            className="input"
            type="date"
            value={playedOn}
            disabled={pending || shut("day")}
            onChange={(e) => commitPlayedOn(e.target.value)}
            aria-label={`Date ${roundLabelOf(allStages, stage.id) || "this round"} is played`}
          />
          {playedOn && (
            <span className="text-muted" style={{ fontSize: 13, marginTop: 3, display: "block" }}>
              {shortDate(playedOn, locale)}
            </span>
          )}
          {/* Shut once the tournament is completed (J12, PR 7b), said under the box. */}
          {doors?.day && !dateRefused && (
            <span className="text-muted" style={{ fontSize: 13, marginTop: 4, display: "block" }}>
              {doors.day}
            </span>
          )}
          {dateRefused && (
            <span role="alert" style={{ fontSize: 13, marginTop: 4, display: "block", color: "var(--color-danger)" }}>
              {/* The plan's window has a plan to see; the rounds rule's refusal has its own way out in its words. */}
              {dateRefused} {dateRefused !== COMPLETED_DATES && <a href="/organization#plan">See plans</a>}
            </span>
          )}
          {dateSaid && (
            <span role="status" className="text-muted" style={{ fontSize: 13, marginTop: 4, display: "block" }}>
              {dateSaid}
            </span>
          )}
        </div>
        </>
        )}
    </>
  );
}
