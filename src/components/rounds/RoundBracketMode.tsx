"use client";
import { isKnockoutRound } from "@/lib/stage-types";
import { BracketModePicker } from "@/components/BracketModePicker";
import type { RoundCtx } from "./use-round-ctx";

export function RoundBracketMode({ ctx }: { ctx: RoundCtx }) {
  const { stage, arrangement, locked } = ctx;
  return (
    <>
{/* THE DRAW'S SHAPE, ON THE ROUND THAT IS THE DRAW (2026-10-16).
            One bracket, Main + plate, two or several flights was chosen only on
            the Bracket screen, which an organizer reaches after setting up —
            so a club wanting "a qualifying match: the winner into the winners'
            bracket, the loser into a consolation" built the rounds here and
            could not find the word for it (Ajay, describing exactly Main +
            plate). Same picker, same organizer-only and lock rules. */}
        {isKnockoutRound(stage.type) && arrangement && (
          <div>
            <BracketModePicker mode={arrangement.mode} secondLabel={arrangement.secondLabel} readOnly={!arrangement.canChange} locked={locked} embedded />
          </div>
        )}
    </>
  );
}

/** Whether RoundBracketMode has anything to say: asked by the caller that puts it among children counted by `SettingsGroup`. */
export function roundBracketModeShown(ctx: RoundCtx): boolean {
  const { stage, arrangement } = ctx;
  return !!(isKnockoutRound(stage.type) && arrangement);
}
