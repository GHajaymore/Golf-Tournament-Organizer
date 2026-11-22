"use client";
import { RoundCut, roundCutShown } from "@/components/rounds/RoundCut";
import { RoundQualification, roundQualificationShown } from "@/components/rounds/RoundQualification";
import { RoundTransition } from "@/components/rounds/RoundTransition";
import { SectionLabel } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

/**
 * WHAT HAPPENS BETWEEN THIS ROUND AND THE NEXT (R4): the cut, carry-forward or qualification, drawn once under the round it
 * follows, never inside the round that is its subject (a cut belongs to the gap, not to a round). One line says what flows
 * in (`intoNext`, the words the closed row says on the old screen); the controls are the ones the old card mounts, the
 * same components, so a cut set here is the cut set there.
 */
export function BetweenRounds({ ctx }: { ctx: RoundCtx }) {
  const { intoNext, showTransition } = ctx;
  const any = roundCutShown(ctx) || roundQualificationShown(ctx) || showTransition;
  if (!any && !intoNext) return null;
  return (
    <section data-between-rounds={ctx.stage.id} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12, padding: "4px 0 4px 12px", borderLeft: "2px solid var(--color-divider)" }}>
      <SectionLabel>After {ctx.thisRound || "this round"}</SectionLabel>
      {intoNext && <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{intoNext}</p>}
      <RoundCut ctx={ctx} />
      <RoundQualification ctx={ctx} />
      <RoundTransition ctx={ctx} />
    </section>
  );
}
