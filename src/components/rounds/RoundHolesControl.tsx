"use client";
import { Refused } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

export function RoundHolesControl({ ctx }: { ctx: RoundCtx }) {
  const { stage, thisRound, holes, shut, pending, refused, commitHoles } = ctx;
  return (
    <>
<div className="field" style={{ width: 110 }}>
          {/* A named group, not a caption tied to nothing (the UI/UX designer on the review panel). */}
          <span className="field-caption">Holes</span>
          <div className="seg" role="radiogroup" aria-label={`Holes for ${thisRound || "this round"}`} style={{ width: "100%" }}>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name={`holes-${stage.id}`} checked={holes === 18} disabled={pending || shut("holes")} onChange={() => commitHoles(18)} />18
            </label>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name={`holes-${stage.id}`} checked={holes === 9} disabled={pending || shut("holes")} onChange={() => commitHoles(9)} />9
            </label>
          </div>
          <Refused text={refused.holes} />
        </div>
    </>
  );
}
