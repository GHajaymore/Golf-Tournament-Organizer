"use client";
import { useState, useTransition } from "react";
import {
  saveTournamentSettings,
  saveOrganizationDefaults,
} from "@/app/actions/settings";
import { setEventDefaultTee } from "@/app/actions/courses";
import {
  SCORE_ENTRY_BY,
  SCORE_ENTRY_BY_LABEL,
  SCORE_ENTRY_BY_HELP,
  SCORE_ENTRY_WINDOW,
  SCORE_ENTRY_WINDOW_LABEL,
  SCORE_ENTRY_WINDOW_HELP,
  SCORE_APPROVAL,
  SCORE_APPROVAL_LABEL,
  SCORE_APPROVAL_HELP,
  ATTEST_BY,
  ATTEST_BY_LABEL,
  ATTEST_BY_HELP,
  usesAccessCodes,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import { Icon } from "./Icon";
import { StickySave } from "./StickySave";
import { MoreInfo } from "./MoreInfo";
import { Choice, Group } from "./SettingsChoice";
import { EntriesHowIn, EntriesWeeklySignUp } from "./players/EntriesHowIn";
import { EventTees, type TeeOption } from "./event/EventTees";
import { playSettingsDirty, playSettingsToSave } from "./event/event-save-plan";
import { BoardVisibility } from "./event/BoardVisibility";
import { ShareLinks } from "./event/ShareLinks";
import { RoundCodes, type RoundCode } from "./event/RoundCodes";

export type { RoundCode, TeeOption };

interface Props {
  mode: "tournament" | "organization";
  settings: TournamentSettings;
  canEdit: boolean;
  /**
   * Entrants still in the field who hold no email address.
   *
   * Only meaningful on a tournament — an organization has no field to strand,
   * and its defaults apply to tournaments that do not exist yet. Zero means
   * the notice never appears, which is the ordinary case.
   */
  strandedCount?: number;
  /** Tournament mode only — one row per round, for showing Round Codes. */
  rounds?: RoundCode[];
  /** Tournament mode only — the public leaderboard token. */
  shareToken?: string;
  /**
   * Tournament mode only — the tournament's name. Was printed on each round's sign; the signs
   * are the Print kit's now (2026-10-23), which reads it for itself.
   */
  eventName?: string;
  /**
   * Tournament mode only — the sets this course is rated for.
   *
   * Empty for a course with no tees on file, in which case the whole Tees
   * group is hidden: offering a choice between nothing is worse than saying
   * nothing, and the unrated warning elsewhere already tells that club what
   * to do about it.
   */
  tees?: TeeOption[];
  /** The tournament's chosen set. Null falls back to the first by position. */
  defaultTeeId?: string | null;
  /**
   * Tournament mode only — why the tournament's tees cannot change now, or
   * null: the rounds rule's sentence (`acrossRoundsRefusal(…, "field-tees")`,
   * the very call `setEventDefaultTee` refuses with) — a scored round of cards
   * would be reached, its handicaps frozen off its tees at its first card, or
   * the tournament is completed. Played from is drawn shut with it, so it is
   * never offered and then refused at Save (round G594-1, 10 Nov).
   */
  teesDoor?: string | null;
  /**
   * WHERE EACH LIFTED BLOCK IS DRAWN (R3-1). REQUIRED, never defaulted: a block that leaves this
   * card for a redesigned room is drawn there and not here, by ONE boolean per block, set from
   * `screensShownFor` by the page. While the redesign switch is off every one is true and nothing
   * changes. `howInHere`: how players sign in and the weekly sign-up (Players' Entries, R6).
   * `shareHere`: who sees the board, its links and the round codes (Home, R10). `teesHere`: the
   * event's tees (Event, R3).
   */
  howInHere: boolean;
  shareHere: boolean;
  teesHere: boolean;
}

export function PlaySettings({
  mode,
  settings,
  canEdit,
  strandedCount = 0,
  rounds = [],
  shareToken,
  eventName,
  tees = [],
  defaultTeeId = null,
  teesDoor = null,
  howInHere,
  shareHere,
  teesHere,
}: Props) {
  const [form, setForm] = useState<TournamentSettings>(settings);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [teeId, setTeeId] = useState<string | null>(defaultTeeId);
  const [pending, startTransition] = useTransition();

  const isTournament = mode === "tournament";
  // The tee is saved by the SAME button as everything else. Two save models
  // on one screen is how a club changes something, presses Save, and finds
  // half of it kept.
  // Only while this card draws the tees: Event's own Save keeps them when it does, and a stale copy here would write them back.
  const teeDirty = isTournament && teesHere && teeId !== defaultTeeId;
  const dirty = playSettingsDirty(form, settings, teesHere) || teeDirty;

  const set = <K extends keyof TournamentSettings>(key: K, value: TournamentSettings[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const save = () => {
    setError("");
    startTransition(async () => {
      const result = isTournament
        ? await saveTournamentSettings(playSettingsToSave(form, teesHere))
        : await saveOrganizationDefaults(form);
      if (!result.ok) {
        setError(result.error ?? "Couldn't save.");
        return;
      }
      // The tee is an id rather than a settings enum, so it takes its own
      // action — but the same button, and it reports its own failure rather
      // than letting a half-save look like a whole one.
      if (teeDirty) {
        const teeResult = await setEventDefaultTee(teeId);
        if (!teeResult.ok) {
          setError(teeResult.error ?? "Couldn't save the tees.");
          return;
        }
      }
      setSaved(true);
    });
  };

  const codesOn = usesAccessCodes(form);

  return (
    // The tournament's own settings are locked in an archived tournament; the club's house
    // defaults (the same card on Club settings) are the club's, and stay open (`archive-read-only.ts`).
    <div className="card elev-sm" data-this-tournament={isTournament ? "" : undefined} style={{ gap: 14 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>
          {isTournament ? "Players & scoring" : "House defaults for new tournaments"}
        </span>
        {isTournament ? (
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            How players see standings and report scores in this tournament.
          </p>
        ) : (
          <MoreInfo short="Tournaments already created keep their own." style={{ marginTop: 4 }}>
            {/* "What a new tournament starts with" was true of one way of
                starting one. A template is a whole kind of tournament and
                sets every one of these itself, so a club that had chosen
                Round Codes here and then picked "Stroke Play" got email
                sign-in and no word of why. Said, until that is decided. */}
            What a tournament you start from scratch begins with. A template brings its own — a
            championship is blind and committee-scored whatever is set here — and you can change any
            of them on the tournament. Changing these never rewrites an event in progress.
          </MoreInfo>
        )}
      </div>

      {shareHere && (
        <>
          <BoardVisibility
            value={form.leaderboardVisibility}
            disabled={!canEdit || pending}
            onChange={(v) => set("leaderboardVisibility", v)}
          />

          {isTournament && form.leaderboardVisibility === "public" && shareToken && (
            <ShareLinks shareToken={shareToken} canEdit={canEdit} />
          )}
        </>
      )}

      <Group
        title="How scores get in"
        blurb="Who records them, from where, and when."
      />

      <Choice
        label="Can players enter scores?"
        hint="organizers and assistants can always enter and correct scores"
        value={form.scoreEntryBy}
        options={SCORE_ENTRY_BY}
        labels={SCORE_ENTRY_BY_LABEL}
            help={SCORE_ENTRY_BY_HELP}
        disabled={!canEdit || pending}
        onChange={(v) => set("scoreEntryBy", v)}
      />

      {form.scoreEntryBy === "players" && (
        <>
          <Choice
            label="When players may submit"
            value={form.scoreEntryWindow}
            options={SCORE_ENTRY_WINDOW}
            labels={SCORE_ENTRY_WINDOW_LABEL}
            help={SCORE_ENTRY_WINDOW_HELP}
            disabled={!canEdit || pending}
            onChange={(v) => set("scoreEntryWindow", v)}
          />

          {howInHere && (
            <EntriesHowIn
              form={form}
              strandedCount={strandedCount}
              disabled={!canEdit || pending}
              onPlayerAccess={(v) => set("playerAccess", v)}
            />
          )}

          <div className="field">
            <span className="field-caption">Voice entry</span>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.voiceEntry}
                disabled={!canEdit || pending}
                onChange={(e) => set("voiceEntry", e.target.checked)}
              />
              Let scores be dictated out loud instead of typed
            </label>
          </div>
        </>
      )}

      {/* Hidden when the course has no tees on file: a choice between nothing
          is worse than saying nothing, and the unrated warning on the course
          screen already tells that club what to do. */}
      {isTournament && tees.length > 0 && teesHere && (
        <EventTees
          tees={tees}
          teeId={teeId}
          teesDoor={teesDoor}
          teePolicy={form.teePolicy}
          canEdit={canEdit}
          pending={pending}
          onTee={(id) => {
            setTeeId(id);
            setSaved(false);
          }}
          onTeePolicy={(v) => set("teePolicy", v)}
        />
      )}

      <Group
        title="Who signs off a result"
        blurb="Before a score counts on the board."
      />

      <Choice
        label=""
        value={form.scoreApproval}
        options={SCORE_APPROVAL}
        labels={SCORE_APPROVAL_LABEL}
        help={SCORE_APPROVAL_HELP}
        disabled={!canEdit || pending}
        onChange={(v) => set("scoreApproval", v)}
      />

      {/* Only asked when players sign off. With staff approval there is
          nobody to configure, and showing it anyway invites an organizer to
          set something that will never apply. */}
      {form.scoreApproval === "players" && (
        <Choice
          label="How many playing partners must confirm"
          hint="For match results. Playing together means the players in one result — the match — so two pairs sharing a tee time never confirm each other's. A stroke-play card is signed by its own player and needs nobody else."
          value={form.attestBy}
          options={ATTEST_BY}
          labels={ATTEST_BY_LABEL}
          help={ATTEST_BY_HELP}
          disabled={!canEdit || pending}
          onChange={(v) => set("attestBy", v)}
        />
      )}

      {howInHere && (
        <EntriesWeeklySignUp
          form={form}
          saved={settings}
          asked={mode === "organization" || rounds.length > 1 || settings.attendanceMode !== "everyone"}
          disabled={!canEdit || pending}
          onAttendanceMode={(v) => set("attendanceMode", v)}
        />
      )}

      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      {canEdit ? (
        /**
         * THE SAVE FOLLOWS YOU, once there is something to save — see
         * `StickySave`, which holds the measurements and the reasoning and is
         * shared with the setup form above.
         *
         * The note says "players & scoring" with a plain `&`: in a JSX string
         * ATTRIBUTE an entity is literal text, so `&amp;` would have reached
         * the reader as `&amp;`. Entities belong in JSX children.
         *
         * One button still, deliberately: "Two save models on one screen is
         * how a club changes something, presses Save, and finds half of it
         * kept." Sticky only while DIRTY, and to the BOTTOM, which pins it
         * inside this section only.
         */
        <StickySave dirty={dirty} note="Unsaved changes to players & scoring">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !dirty}
            onClick={save}
          >
            <Icon name="check" /> {pending ? "Saving…" : saved && !dirty ? "Saved" : "Save settings"}
          </button>
        </StickySave>
      ) : (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Only the organizer can change these.
        </p>
      )}

      {/* ── Round Codes ─────────────────────────────────────────────────── */}
      {isTournament && codesOn && shareHere && (
        <RoundCodes
          rounds={rounds}
          eventName={eventName ?? ""}
          canEdit={canEdit}
          pending={pending}
          run={startTransition}
          onError={setError}
        />
      )}
    </div>
  );
}
