"use client";
import {
  LEADERBOARD_VISIBILITY,
  LEADERBOARD_VISIBILITY_LABEL,
  LEADERBOARD_VISIBILITY_HELP,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import { Choice, Group } from "../SettingsChoice";

/**
 * WHO CAN SEE THE BOARD: lifted out of `PlaySettings` (R3-1), no behaviour change. Home (R10) mounts
 * it with the share links; until then `PlaySettings` mounts it first, where it always was.
 */
export function BoardVisibility({
  value,
  disabled,
  onChange,
}: {
  value: TournamentSettings["leaderboardVisibility"];
  disabled: boolean;
  onChange: (v: TournamentSettings["leaderboardVisibility"]) => void;
}) {
  return (
    <>
      <Group
        title="Who can see results"
        blurb="The board in the clubhouse and the link families follow."
      />

      <Choice
        label="Who can see the leaderboard"
        value={value}
        options={LEADERBOARD_VISIBILITY}
        labels={LEADERBOARD_VISIBILITY_LABEL}
        help={LEADERBOARD_VISIBILITY_HELP}
        disabled={disabled}
        onChange={onChange}
      />
    </>
  );
}
