"use client";
import { SingleMatchRulePicker } from "@/components/SingleMatchRulePicker";
import { SectionLabel } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundSingleMatch({ ctx }: { ctx: RoundCtx }) {
  const { stage, singleMatch, locked } = ctx;
  return (
    <>
{/* One match, paired by a rule rather than by hand. */}
        {stage.type === "Single Match Stage" && singleMatch && (
          <div>
            <SectionLabel>The match</SectionLabel>
            <SingleMatchRulePicker
              stageId={stage.id}
              rule={singleMatch.rule}
              ruleLabel={singleMatch.ruleLabel}
              problem={singleMatch.resolution.problem}
              aName={singleMatch.aName}
              bName={singleMatch.bName}
              matchId={singleMatch.matchId}
              stale={singleMatch.stale}
              rounds={singleMatch.rounds}
              players={singleMatch.players}
              locked={locked}
            />
          </div>
        )}
    </>
  );
}

/** Whether RoundSingleMatch has anything to say: asked by the caller that puts it among children counted by `SettingsGroup`. */
export function roundSingleMatchShown(ctx: RoundCtx): boolean {
  const { stage, singleMatch } = ctx;
  return !!(stage.type === "Single Match Stage" && singleMatch);
}
