"use client";
import { roundLabel as roundLabelOf } from "@/lib/domain/round-label";
import { SectionLabel, RoundHandicaps } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundHandicapsBlock({ ctx }: { ctx: RoundCtx }) {
  const { stage, allStages } = ctx;
  return (
    <>
{/* Was "Cut line &amp; carry-forward — before the next round" —
                an ampersand heading naming two of the THREE things beneath it.
                The third is the Generate pairings button, and nobody looking
                for "how do I draw Round 2" would look under a heading about cut
                lines. Renamed to cover the handover itself; no sub-headings
                added, because each control below already labels itself and a
                heading that repeats the label under it is the trap this pass
                walked into on its own first screen. */}

            {/* POINTS ARE SCORING, NOT A TIEBREAK (2026-10-16; the review panel). They
                shared one block with the table's tie chain under "Tiebreakers"; the tie
                chain is on the face now, under Ties. One line here, the figures on Change. */}


            {/* A committee's own figure for one player in one round — a visitor's
                handicap, a correction for the day. Real, and rare: in Customize,
                not on the face of every round. */}
            {stage.handicaps.length > 0 && (
              <div>
                <SectionLabel>Handicaps for this round</SectionLabel>
                <div style={{ marginTop: 6 }}>
                  <RoundHandicaps stageId={stage.id} rows={stage.handicaps} roundName={roundLabelOf(allStages, stage.id) || "this round"} />
                </div>
              </div>
            )}
    </>
  );
}
