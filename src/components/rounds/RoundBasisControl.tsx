"use client";
import { isManualFormat } from "@/lib/formats";
import FieldInfo from "@/components/FieldInfo";
import { isHeadToHead } from "@/lib/stage-types";
import { isStablefordFormat } from "@/lib/domain/week-basis";
import { BASIS_CHOICES, Refused } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundBasisControl({ ctx }: { ctx: RoundCtx }) {
  const { stage, golfWords, thisRound, basis, format, doors, shut, pending, refused, commitBasis } = ctx;
  return (
    <>
{/* OFF HANDICAP OR SCRATCH — on the face of the round, not in Customize
          (2026-10-16). It is the first thing a club decides about a competition
          after the format, and it was behind a fold labelled "Result
          calculation", so a new organizer's medal stayed gross because nobody
          found the choice. Ajay: "made it default as the usual golf clubs play
          and keep the customization in to customize section". The allowance
          that goes with Net sits directly under it. Not on a round scored by
          hand: the committee works its result out, so there is nothing here for
          the app to apply. */}
      {!isManualFormat(format) && (
      <div className="field" style={{ maxWidth: 420, width: "100%" }}>
        <span className="field-caption">
          Handicap
          <FieldInfo label="playing off handicap or scratch">
            <p>
              <b>Net</b> takes each player&rsquo;s handicap strokes off first, so a 20-handicap can
              win — how most club, league and {golfWords.golfGroup} competitions are played. <b>Gross</b> ranks the strokes actually
              taken, as a scratch championship does. <b>Both</b> keeps the two orders of merit from
              one card, for a competition that gives a gross and a net prize.
            </p>
          </FieldInfo>
        </span>
        {isStablefordFormat(format) ? (
          /* STABLEFORD IS PLAYED OFF HANDICAP — the way clubs run it
             (Ajay, 2026-09-28). A scratch competition is stroke play, so
             there is nothing to choose here, and a picker offering
             "Gross" would be offering a result the engine never gave. */
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
            Off handicap — points are worked out after each player&rsquo;s strokes, as
            Stableford is played everywhere. For a scratch competition, choose Stroke Play.
          </p>
        ) : (
          <>
            <div className="seg" role="radiogroup" aria-label={`Handicap for ${thisRound || "this round"}`} style={{ width: "100%" }}>
              {/* The choosable three. A round still HOLDING the legacy
                  `stableford` basis shows none of these checked, and the
                  summary line above still names it — see `BASIS_OPTIONS`. */}
              {BASIS_CHOICES.map((o) => (
                <label key={o.key} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name={`basis-${stage.id}`} checked={basis === o.key} disabled={pending || shut("allowance")} onChange={() => commitBasis(o.key)} />
                  {o.label}
                </label>
              ))}
            </div>
            {/* Why the choice is shut (J12, PR 7b): a round of recorded matches, or completed. */}
            {doors?.allowance && (
              <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
                {doors.allowance}
              </p>
            )}
            <Refused text={refused.basis} />
            {/* Only where the choice needs words (2026-10-16): Gross and Net say themselves. */}
            {basis === "both" && (
              <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
                A gross and a net order of merit from the same cards.
              </p>
            )}
            {/* How strokes are given in a net match, said once (2026-10-16; the golf
                professional on the review panel: a medal states its allowance, a net
                match stated nothing). */}
            {basis === "net" && isHeadToHead(stage.type) && (
              <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
                The higher handicap gets the difference in strokes, on the hardest holes by stroke index.
              </p>
            )}
          </>
        )}
      </div>
      )}
    </>
  );
}
