"use client";
import { useState, useTransition } from "react";
import { saveTournamentSettings } from "@/app/actions/settings";
import type { TournamentSettings } from "@/lib/tournament-settings";
import { Icon } from "../Icon";
import { StickySave } from "../StickySave";
import { EntriesHowIn, EntriesWeeklySignUp } from "./EntriesHowIn";

/**
 * HOW PLAYERS GET IN, ON THE ENTRIES TAB (R6): the two pieces R3-1 lifted out of `PlaySettings`, mounted here while
 * Players is shown (and by `PlaySettings` while it is not: `howInHere`). It holds its own copy of the settings and saves
 * through the same action as the Event card (`saveTournamentSettings`), the whole object, so nothing else is changed by
 * the press. A refusal is said beside the button.
 */
export function EntriesHowInCard({
  settings,
  strandedCount,
  askedWeekly,
  canEdit,
}: {
  settings: TournamentSettings;
  strandedCount: number;
  /** Whether there is a next week to ask about (the Event card's own rule). */
  askedWeekly: boolean;
  canEdit: boolean;
}) {
  const [form, setForm] = useState<TournamentSettings>(settings);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty = form.playerAccess !== settings.playerAccess || form.attendanceMode !== settings.attendanceMode;

  const save = () => {
    setError("");
    startTransition(async () => {
      const result = await saveTournamentSettings(form);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save.");
        return;
      }
      setSaved(true);
    });
  };

  return (
    <div className="card elev-sm" data-entries-how-in style={{ gap: 14, marginBottom: 16 }}>
      <span className="card-title" style={{ fontSize: 15 }}>How players get in</span>
      <EntriesHowIn
        form={form}
        strandedCount={strandedCount}
        disabled={!canEdit || pending}
        onPlayerAccess={(v) => {
          setForm((f) => ({ ...f, playerAccess: v }));
          setSaved(false);
        }}
      />
      <EntriesWeeklySignUp
        form={form}
        saved={settings}
        asked={askedWeekly}
        disabled={!canEdit || pending}
        onAttendanceMode={(v) => {
          setForm((f) => ({ ...f, attendanceMode: v }));
          setSaved(false);
        }}
      />
      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }} data-how-in-error>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
      {canEdit ? (
        <StickySave dirty={dirty} note="Unsaved changes to how players get in">
          <button type="button" className="btn btn-primary" disabled={pending || !dirty} onClick={save}>
            <Icon name="check" /> {pending ? "Saving…" : saved && !dirty ? "Saved" : "Save how players get in"}
          </button>
        </StickySave>
      ) : (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Only the organizer can change these.
        </p>
      )}
    </div>
  );
}
