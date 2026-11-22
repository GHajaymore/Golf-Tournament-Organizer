"use client";
import { standingsUnit } from "@/lib/format-chain";
import { RoundClosedControl } from "@/components/RoundClosedControl";
import { isStablefordRound } from "@/lib/domain/week-basis";
import { RoundDeadlineControl } from "@/components/RoundDeadlineControl";
import { SectionLabel, SettingsGroup } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundOnTheDay({ ctx }: { ctx: RoundCtx }) {
  const { stage, today, underWay, thisRound, deadline, pending } = ctx;
  return (
    <>
{/* ON THE DAY: the two controls about PLAY, once there is play to speak
          of (`underWay`). At setup they were noise with a trap in it — ticking
          "This round is finished" on an unplayed round leaves everybody without
          a place. A round that is already closed, or has a card, shows them
          whatever the tournament's status. */}
      {underWay && (
        <SettingsGroup title="On the day">
          {stage.type !== "Bracket Stage" &&
            standingsUnit(stage.format, stage.scoringBasis) !== "match points" && (
            <div>
              <SectionLabel>Is this round over?</SectionLabel>
              <RoundClosedControl
                stageId={stage.id}
                closed={stage.closed}
                pointsBoard={isStablefordRound(stage.scoringBasis, stage.format)}
              />
            </div>
          )}
          {/* Under the date it overrules, which is in Customize: closing a
              round's scoring early is a decision made on the day. */}
          <div>
            <SectionLabel>Scoring window</SectionLabel>
            <RoundDeadlineControl
              stageId={stage.id}
              roundLabel={thisRound}
              deadline={deadline}
              today={today}
              override={stage.deadlineOverride}
              // Open while live: closing or reopening scoring is a
              // decision made on the day (2026-09-27).
              locked={pending}
            />
          </div>
        </SettingsGroup>
      )}
    </>
  );
}
