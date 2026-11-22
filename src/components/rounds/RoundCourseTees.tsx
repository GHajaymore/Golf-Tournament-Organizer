"use client";
import { CoursePicker } from "@/components/CoursePicker";
import { Refused } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundCourseTees({ ctx }: { ctx: RoundCtx }) {
  const { stage, venues, canSetVenue, holes, courseId, nine, nineMayStayOpen, doors, shut, pending, refused, commitVenue } = ctx;
  return (
    <>
{/* Which nine, when the round is 9 holes. Front and back have their own
            pars and stroke indexes, so a net round on the back allocates shots
            completely differently — this is not cosmetic. */}
        {holes === 9 && (
          <div className="field" style={{ width: 168 }}>
            <label htmlFor={`nine-${stage.id}`}>Which nine</label>
            <select
              id={`nine-${stage.id}`}
              className="input"
              /* A round scored from cards is scored as the FRONT nine when
                 nothing says otherwise (`applyNine`), so that is what this
                 shows for it — the screen states what the scorer does. */
              value={nineMayStayOpen || nine !== "full" ? nine : "front"}
              disabled={pending || !canSetVenue || shut("round-tees")}
              onChange={(e) => commitVenue(courseId, e.target.value)}
            >
              <option value="front">Front nine</option>
              <option value="back">Back nine</option>
              {/* Front and back was a forced choice, and some rounds
                  genuinely have no one answer: matches going out on both
                  nines at once.

                  OFFERED ONLY WHERE SOMETHING ELSE SAYS WHICH (2026-10-10).
                  In match play each match states its own nine at score
                  entry, so the round can leave it open. A round scored from
                  cards has nowhere else to say it — every card was scored
                  off the front nine's pars and stroke index under a label
                  reading "Not fixed". */}
              {nineMayStayOpen && <option value="full">Not fixed — each match says which</option>}
            </select>
          </div>
        )}

        {/* Only where the tournament rotates venues. One course means the
            whole event is played there and asking would be noise. */}
        {venues.length > 1 && (
          <div style={{ minWidth: 200 }}>
            <CoursePicker
              label="Course"
              // Off: this chooses among the venues the TOURNAMENT already has
              // — "Same as the tournament" is the empty answer — rather than
              // asking where a round is played in general. Adding a venue is
              // Tournament details; moving one round to another of them is
              // this. Stated rather than defaulted, so the narrowness is a
              // decision somebody made.
              searchDirectory={false}
              options={venues}
              value={courseId ?? ""}
              disabled={pending || !canSetVenue || shut("round-tees")}
              noneLabel="Same as the tournament"
              onChange={(id) => commitVenue(id || null, nine)}
            />
          </div>
        )}
        {/* Why those two are greyed out, ON the page — this app's rule is that
            a control's reason is not left to a tooltip. */}
        {!canSetVenue && (holes === 9 || venues.length > 1) && (
          <span className="text-muted" style={{ fontSize: 13, alignSelf: "center" }}>
            The organizer sets where this round is played.
          </span>
        )}
        {/* Shut by the rounds rule (J12, PR 7b): a round of recorded matches, or completed. */}
        {canSetVenue && doors?.["round-tees"] && (holes === 9 || venues.length > 1) && (
          <span className="text-muted" style={{ fontSize: 13, alignSelf: "center" }}>
            {doors["round-tees"]}
          </span>
        )}
        {/* Beside the venue and the nine, which save together (`commitVenue`). */}
        {refused.venue && (
          <div style={{ flexBasis: "100%", gridColumn: "1 / -1", minWidth: 0 }}>
            <Refused text={refused.venue} />
          </div>
        )}
    </>
  );
}
