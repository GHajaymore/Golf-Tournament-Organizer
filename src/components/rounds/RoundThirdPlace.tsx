"use client";
import { ThirdPlaceControl } from "@/components/ThirdPlaceControl";
import { isKnockoutRound } from "@/lib/stage-types";
import type { RoundCtx } from "./use-round-ctx";

export function RoundThirdPlace({ ctx }: { ctx: RoundCtx }) {
  const { stage, thirdPlace, locked } = ctx;
  // The one condition is `roundThirdPlaceShown`'s; `thirdPlace` is only narrowed here for the type.
  return (
    <>
{roundThirdPlaceShown(ctx) && thirdPlace && (
          <div>

            <ThirdPlaceControl
              stageId={stage.id}
              on={thirdPlace.on}
              problem={thirdPlace.problem}
              aName={thirdPlace.aName}
              bName={thirdPlace.bName}
              made={thirdPlace.made}
              locked={locked}
            />
          </div>
        )}
    </>
  );
}

/** Whether RoundThirdPlace has anything to say: asked by the caller that puts it among children counted by `SettingsGroup`. */
export function roundThirdPlaceShown(ctx: RoundCtx): boolean {
  const { stage, thirdPlace } = ctx;
  return !!(isKnockoutRound(stage.type) && thirdPlace);
}
