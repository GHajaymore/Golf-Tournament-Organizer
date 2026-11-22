"use client";
import FieldInfo from "@/components/FieldInfo";
import { CUT_SCOPE_HELP, ROUND_CUT_HELP } from "@/lib/domain/cut";
import { SettingsGroup } from "@/components/rounds/shared";
import { NextRoundTransition } from "@/components/rounds/NextRoundTransition";
import type { RoundCtx } from "./use-round-ctx";

export function RoundTransition({ ctx }: { ctx: RoundCtx }) {
  const { stage, nextStage, allStages, confirmedCount, flightCount, carryPrompt, showTransition } = ctx;
  return (
    <>
{/* BEFORE THE NEXT ROUND, ON THE FACE OF A ROUND ROBIN (2026-10-16).
          It was inside Customize. In a match-play event of groups — two round
          robins and a knockout, the shape Ajay asked to be walked — what carries
          into the next round, who survives a cut and drawing that round's
          matches are what the round is FOR, and the carry question used to open
          Customize by itself to be seen. A golf pro would not call any of it a
          customisation. */}
      {showTransition && (
        <SettingsGroup
          title={
            <>
              Before the next round
              <FieldInfo label="the cut line and carry-forward">
                <p>{ROUND_CUT_HELP}</p>
                <p>{CUT_SCOPE_HELP}</p>
              </FieldInfo>
            </>
          }

        >
          <NextRoundTransition key={nextStage?.id ?? "none"} stageId={stage.id} nextStage={nextStage} allStages={allStages} confirmedCount={confirmedCount} flightCount={flightCount} carry={carryPrompt} />
        </SettingsGroup>
      )}
    </>
  );
}
