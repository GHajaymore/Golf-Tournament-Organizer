"use client";
import {
  PLAYER_ACCESS,
  PLAYER_ACCESS_LABEL,
  PLAYER_ACCESS_HELP,
  usesAccessCodes,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import {
  ATTENDANCE_MODES,
  ATTENDANCE_MODE_LABEL,
  ATTENDANCE_MODE_HELP,
  attendanceModeChange,
} from "@/lib/domain/attendance";
import { lockoutNotice } from "@/lib/domain/access-lockout";
import { Icon } from "../Icon";
import { Choice, Group } from "../SettingsChoice";

/**
 * HOW PLAYERS GET IN: lifted out of `PlaySettings` (R3-1), no behaviour change.
 *
 * Two pieces, because the old card draws them in two places: how players sign in (inside the
 * "players may enter scores" branch) and the weekly sign-up (further down). Players' room (R6)
 * mounts both on Entries; until then `PlaySettings` mounts them where they always were. The
 * state stays in `PlaySettings`' one form, so the one Save still keeps every field.
 */

/** "How players sign in", and what turning Round Codes off would cost, said before the choice. */
export function EntriesHowIn({
  form,
  strandedCount,
  disabled,
  onPlayerAccess,
}: {
  form: TournamentSettings;
  /** Entrants still in the field who hold no email address (zero on a club's defaults). */
  strandedCount: number;
  disabled: boolean;
  onPlayerAccess: (v: TournamentSettings["playerAccess"]) => void;
}) {
  const notice = lockoutNotice({ usingCodes: usesAccessCodes(form), strandedCount });
  return (
    <>
      <Choice
        label="How players sign in"
        value={form.playerAccess}
        options={PLAYER_ACCESS}
        labels={PLAYER_ACCESS_LABEL}
        help={PLAYER_ACCESS_HELP}
        disabled={disabled}
        onChange={onPlayerAccess}
      />

      {/* WHAT TURNING ROUND CODES OFF WOULD COST, said before the choice rather than after it.
          `saveTournamentSettings` already REFUSES this change; the count is on the server the whole
          time. Read off `form`, not `settings`, so it disappears the moment they switch away. Same
          sentence as the refusal, from the same function. */}
      {notice && (
        <p className="text-muted" style={{ fontSize: 13, margin: "-4px 0 0", lineHeight: 1.55 }}>
          <Icon name="warning-circle" /> {notice}
        </p>
      )}
    </>
  );
}

/** "Weekly sign-up": who is playing next week, round by round, and what switching it does to the league. */
export function EntriesWeeklySignUp({
  form,
  saved,
  asked,
  disabled,
  onAttendanceMode,
}: {
  form: TournamentSettings;
  /** What is stored, to judge a switch against the mode still in force. */
  saved: TournamentSettings;
  /** Whether there is a next week to ask about (a club's defaults, more than one round, or a mode already set). */
  asked: boolean;
  disabled: boolean;
  onAttendanceMode: (v: TournamentSettings["attendanceMode"]) => void;
}) {
  const warning = attendanceModeChange(saved.attendanceMode, form.attendanceMode);
  return (
    <>
      {/* ASKED WHERE THERE IS A NEXT WEEK (Ajay, 2026-10-05), and ALWAYS where the setting has been
          moved off its default: a setting in force is never hidden from the person who can change it. */}
      {asked && (
        <>
          <Group
            title="Weekly sign-up"
            blurb="Who is playing next week, round by round."
            more="Nothing to do with scoring or sign-off. For a league that plays every week: whether the field is assumed in, assumed out, or the question never asked. Players answer per round, until each round's sign-up deadline."
          />

          <Choice
            label=""
            value={form.attendanceMode}
            options={ATTENDANCE_MODES}
            labels={ATTENDANCE_MODE_LABEL}
            help={ATTENDANCE_MODE_HELP}
            disabled={disabled}
            onChange={onAttendanceMode}
          />
        </>
      )}

      {/* WHAT THE SWITCH DOES TO THE PEOPLE ALREADY IN THE LEAGUE: only explicit choices are stored,
          so moving an opt-out league to opt-in or captains turns everyone who has never touched the
          app from in to OUT at the moment Save is pressed. Shown BEFORE saving. */}
      {warning && (
        <p
          style={{
            fontSize: 13,
            margin: 0,
            lineHeight: 1.55,
            padding: "9px 11px",
            borderRadius: 9,
            background: "color-mix(in srgb, var(--color-text) 5%, transparent)",
          }}
        >
          <Icon name="warning-circle" /> {warning}
        </p>
      )}
    </>
  );
}
