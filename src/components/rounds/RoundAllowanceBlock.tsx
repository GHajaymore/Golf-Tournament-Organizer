"use client";
import { RoundAllowance } from "@/components/RoundAllowance";
import type { RoundCtx } from "./use-round-ctx";

export function RoundAllowanceBlock({ ctx }: { ctx: RoundCtx }) {
  const { stage, doors, shut } = ctx;
  return (
    <>
{stage.allowance && (
        // The line itself starts "Handicap allowance 95%"; a heading saying the same went (2026-10-16).
        <RoundAllowance stageId={stage.id} info={stage.allowance} locked={shut("allowance")} door={doors?.allowance ?? null} />
      )}
    </>
  );
}
