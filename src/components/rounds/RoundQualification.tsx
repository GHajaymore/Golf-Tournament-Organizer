"use client";
import FieldInfo from "@/components/FieldInfo";
import { CUT_SCOPE_HELP, QUALIFICATION_CUT_HELP } from "@/lib/domain/cut";
import { QualControl } from "@/components/QualControl";
import { SectionLabel } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundQualification({ ctx }: { ctx: RoundCtx }) {
  const { stage, allStages, qual, confirmedCount, flightCount, locked } = ctx;
  return (
    <>
{/* ON THE BRACKET, because how many players a bracket takes is the
            bracket’s own business. This used to sit on a "Qualification Stage" —
            a stage the field never played, whose only job was to host this
            control and whose settings were the EVENT’s anyway. The stage went;
            the question it asked is real and stayed. */}
        {/* NOTHING TO CUT ON when the bracket is the first round: there is no
            qualifying round to rank anybody, so `loadEventState` puts the whole
            field in the draw. Offering "Top 2 per flight" here was offering a
            setting that — before 2026-09-26 — silently left half a club's
            entrants out of its knockout. */}
        {roundQualificationShown(ctx) && (
          allStages.findIndex((s) => s.id === stage.id) === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5, maxWidth: "62ch" }}>
            This bracket is the first round, so everyone in the field goes into the draw, seeded in order —
            there is no qualifying round to cut from. Add a round before it to qualify into it instead.
          </p>
        ) : (
          <div>
            <SectionLabel>
              Qualification cut
              <FieldInfo label="the qualification cut">
                <p>{QUALIFICATION_CUT_HELP}</p>
                <p>{CUT_SCOPE_HELP}</p>
              </FieldInfo>
            </SectionLabel>
            <QualControl mode={qual.mode} perFlight={qual.perFlight} overall={qual.overall} locked={locked} flightCount={flightCount} fieldSize={confirmedCount} />
          </div>
          )
        )}
    </>
  );
}

/** Whether RoundQualification has anything to say: asked by the caller that puts it among children counted by `SettingsGroup`. */
export function roundQualificationShown(ctx: RoundCtx): boolean {
  const { stage } = ctx;
  return !!(stage.type === "Bracket Stage");
}
