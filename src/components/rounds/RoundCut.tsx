"use client";
import { roundLabel as roundLabelOf, roundNumber as roundNumberOf } from "@/lib/domain/round-label";
import { CutControl } from "@/components/CutControl";
import { SectionLabel } from "@/components/rounds/shared";
import { InfoOrFace } from "@/components/setup/InfoOrFace";
import type { RoundCtx } from "./use-round-ctx";

export function RoundCut({ ctx }: { ctx: RoundCtx }) {
  const { stage, nextStage, allStages, confirmedCount, flightCount, locked, thisRound, showStrokeCut } = ctx;
  return (
    <>
{/* ONLY WHERE CLOSING DECIDES SOMETHING, which is a round scored off
            CARDS.

            A bracket files no card at all — its results are BracketWinner rows
            keyed by slot — and a round measured in match points does not reach
            a stroke board, so closing either changes nobody's position. The
            first draft offered this on every non-bracket round and a plain
            Round Robin grew a panel for a lever that does nothing; the guard
            in `render.test.tsx` that says a round deciding nothing of its own
            must stay silent caught it, and was right to.

            Read off the round's own UNIT rather than its type, because a Round
            Robin set to Stroke Play is head-to-head by type and a medal in
            fact — `docs/deferred-register.md` is explicit that on this axis
            you assert the output, not the flag. */}
        {/* Beside the box that makes it, not behind "Customize": on a
            championship the cut is one of the two things this round decides. */}
        {showStrokeCut && nextStage && (
          <div>
            <SectionLabel>The cut</SectionLabel>
            {/* RANKED ON THE TOTAL, which is what `applyStrokeCut` does and what a
                36-hole cut is. This said "ranked on this round's scores", which
                told the organizer of a 54-hole championship that Round 1 would
                not count towards who plays Round 3 (2026-10-16). */}
            <InfoOrFace
              redesign={ctx.redesign}
              label="the cut"
              face={(words) => (
                <p className="text-muted" style={{ fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>
                  {words}
                </p>
              )}
            >
              Who plays {roundLabelOf(allStages, nextStage.id)}, ranked on
              {roundNumberOf(allStages, stage.id) > 1 ? ` the total after ${thisRound}` : ` ${thisRound || "this round"}`}.
              A tie for the last place is settled the way you choose below. The cut is made when you
              mark this round finished.
            </InfoOrFace>
            <CutControl
              key={nextStage.id}
              formId={stage.id}
              getStageId={async () => nextStage.id}
              roundLabel={roundLabelOf(allStages, nextStage.id)}
              enabled={nextStage.cutEnabled}
              mode={nextStage.cutMode}
              count={nextStage.cutCount}
              percent={nextStage.cutPercent}
              scope={nextStage.cutScope}
              confirmedCount={confirmedCount}
              flightCount={flightCount}
              locked={locked}
              tiesGoThrough
              tieRule={nextStage.cutTies}
            />
          </div>
        )}
    </>
  );
}

/** Whether RoundCut has anything to say: asked by the caller that puts it among children counted by `SettingsGroup`. */
export function roundCutShown(ctx: RoundCtx): boolean {
  const { nextStage, showStrokeCut } = ctx;
  return !!(showStrokeCut && nextStage);
}
