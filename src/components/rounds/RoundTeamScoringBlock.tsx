"use client";
import FieldInfo from "@/components/FieldInfo";
import { RoundTeamScoring } from "@/components/RoundTeamScoring";
import { SectionLabel } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundTeamScoringBlock({ ctx }: { ctx: RoundCtx }) {
  const { stage, locked, doors } = ctx;
  return (
    <>
{/* What the format costs the sides in strokes. On the round,
          beside the format it belongs to — this used to live on the
          Teams screen behind a second round selector, so an organizer
          chose Four-Ball here and discovered what it played off
          somewhere else, with nothing on either screen saying so. */}
      {stage.teamScoring && (
        <div>
          <SectionLabel>
            Handicaps for {stage.teamScoring.name}
            <FieldInfo label="team handicaps">
              <p>
                What each side plays off in this round. The allowance is the share of a
                player&rsquo;s course handicap that counts; some formats also split it between
                partners, and some let you choose how many balls count on a hole.
              </p>
              <p>Every one of these is the format&rsquo;s recommendation until you change it.</p>
            </FieldInfo>
          </SectionLabel>
          <div style={{ marginTop: 6 }}>
            <RoundTeamScoring stageId={stage.id} info={stage.teamScoring} locked={locked} allowanceDoor={doors ? doors.allowance : undefined} />
          </div>
        </div>
      )}
    </>
  );
}
