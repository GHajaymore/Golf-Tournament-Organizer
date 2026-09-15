"use client";
import { useEffect, useState, useTransition } from "react";
import { screenName } from "@/lib/nav";
import {
  saveTournamentSettings,
  saveOrganizationDefaults,
  regenerateRoundCode,
} from "@/app/actions/settings";
import { rotatePublicToken } from "@/app/actions/tournament";
import { setEventDefaultTee } from "@/app/actions/courses";
import {
  LEADERBOARD_VISIBILITY,
  LEADERBOARD_VISIBILITY_LABEL,
  LEADERBOARD_VISIBILITY_HELP,
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
  TEE_POLICY,
  TEE_POLICY_LABEL,
  TEE_POLICY_HELP,
} from "@/lib/tournament-settings";
import {
  ATTENDANCE_MODES,
  ATTENDANCE_MODE_LABEL,
  ATTENDANCE_MODE_HELP,
  attendanceModeChange,
} from "@/lib/domain/attendance";
import {
  PLAYER_ACCESS,
  PLAYER_ACCESS_LABEL,
  PLAYER_ACCESS_HELP,
  usesAccessCodes,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import { formatAccessCode } from "@/lib/code-format";
import { lockoutNotice } from "@/lib/domain/access-lockout";
import { Icon } from "./Icon";
import { StickySave } from "./StickySave";

export interface RoundCode {
  stageId: string;
  label: string;
  code: string;
}

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
}

export interface TeeOption {
  id: string;
  name: string;
  /**
   * The course this set belongs to.
   *
   * A tournament played over two venues offers both courses' sets in one
   * list, and clubs name markers alike — the demo club has "Black" on two
   * courses and "Green" on three. Optional so a caller that has not been
   * taught renders exactly what it did.
   */
  courseName?: string;
  courseRating: number;
  slopeRating: number;
  /** False when nobody has entered a rating, so this set changes nothing. */
  rated: boolean;
}

/** Radio group. Each option carries its own explanation, because these
 *  choices change what players can see and do — not somewhere to be terse. */
/**
 * A subheading naming ONE question.
 *
 * Seven controls sat in a flat list under a single "Players & scoring"
 * heading, answering four unrelated questions: who may see results, how scores
 * get in, who signs a result off, and who is playing next week. That is the
 * same failure as the "Match points & tiebreakers" heading — an ampersand
 * covering two things, so the setting somebody came for cannot be found,
 * because nothing on screen names it.
 *
 * The fix is separation, not removal. Every control here is still present and
 * still does what it did; they are grouped under headings that each name one
 * thing.
 */
function Group({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12, marginTop: 2 }}>
      <span style={{ fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 600 }}>{title}</span>
      <p className="text-muted" style={{ fontSize: 11.5, margin: "3px 0 0", lineHeight: 1.5 }}>
        {blurb}
      </p>
    </div>
  );
}

function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  labels,
  help,
  disabled,
  onChange,
}: {
  /** Empty where the Group heading above already names this setting. */
  label: string;
  hint?: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  help?: Record<T, string>;
  disabled: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      {/* Suppressed when the Group heading directly above already says it.
          Grouping the settings put "Who signs off a result" immediately under
          a heading reading "Who signs off a result", and the same for "Weekly
          sign-up" — a stutter, and a separation that made the screen wordier
          rather than clearer. Where a group holds one control, the heading IS
          the label. */}
      {label && (
        <label>
          {label} {hint && <span className="text-muted">· {hint}</span>}
        </label>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
        {options.map((opt) => (
          <label
            key={opt}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 13,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <input
              type="radio"
              checked={value === opt}
              disabled={disabled}
              onChange={() => onChange(opt)}
              style={{ marginTop: 2 }}
            />
            <span>
              {labels[opt]}
              {help?.[opt] && (
                <span className="text-muted" style={{ display: "block", fontSize: 12 }}>
                  {help[opt]}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function PlaySettings({
  mode,
  settings,
  canEdit,
  strandedCount = 0,
  rounds = [],
  shareToken,
  tees = [],
  defaultTeeId = null,
}: Props) {
  const [form, setForm] = useState<TournamentSettings>(settings);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState("");
  const [rotating, setRotating] = useState(false);
  const [origin, setOrigin] = useState("");
  const [teeId, setTeeId] = useState<string | null>(defaultTeeId);
  const [pending, startTransition] = useTransition();

  // The share link needs the real host, which only the browser knows.
  useEffect(() => setOrigin(window.location.origin), []);

  const isTournament = mode === "tournament";
  // The tee is saved by the SAME button as everything else. Two save models
  // on one screen is how a club changes something, presses Save, and finds
  // half of it kept.
  const teeDirty = isTournament && teeId !== defaultTeeId;
  const dirty =
    (Object.keys(form) as (keyof TournamentSettings)[]).some((k) => form[k] !== settings[k]) || teeDirty;

  /**
   * The weekly-sign-up switch, judged against the mode still in force.
   *
   * `settings` is what is saved and `form` is the draft, so this is a warning
   * about a change not yet made — which is the only moment it is useful.
   */
  const attendanceWarning = attendanceModeChange(
    settings.attendanceMode,
    form.attendanceMode,
  );

  const set = <K extends keyof TournamentSettings>(key: K, value: TournamentSettings[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const save = () => {
    setError("");
    startTransition(async () => {
      const result = isTournament
        ? await saveTournamentSettings(form)
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

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(""), 1600);
    });
  };

  const shareUrl = shareToken && origin ? `${origin}/live/${shareToken}` : "";
  const codesOn = usesAccessCodes(form);

  return (
    <div className="card elev-sm" style={{ gap: 14 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>
          {isTournament ? "Players & scoring" : "House defaults for new tournaments"}
        </span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          {isTournament
            ? "How players see standings and report scores in this tournament."
            : "What a new tournament starts with. Tournaments already created keep their own settings — changing these never rewrites an event in progress."}
        </p>
      </div>

      <Group
        title="Who can see results"
        blurb="The board in the clubhouse and the link families follow."
      />

      <Choice
        label="Who can see the leaderboard"
        value={form.leaderboardVisibility}
        options={LEADERBOARD_VISIBILITY}
        labels={LEADERBOARD_VISIBILITY_LABEL}
        help={LEADERBOARD_VISIBILITY_HELP}
        disabled={!canEdit || pending}
        onChange={(v) => set("leaderboardVisibility", v)}
      />

      {isTournament && form.leaderboardVisibility === "public" && shareUrl && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Public leaderboard link</div>
            <code style={{ fontSize: 12, wordBreak: "break-all" }}>{shareUrl}</code>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => copy(shareUrl, "share")}>
            <Icon name="copy" /> {copied === "share" ? "Copied" : "Copy"}
          </button>
          {/* P3 of the audit: this token was minted once at creation and
              nothing replaced it, so a link posted somewhere public could only
              be dealt with by turning the leaderboard off. Confirmed, because
              every copy of the old URL dies the moment it runs — including the
              one on the clubhouse noticeboard. */}
          {canEdit && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={rotating}
              title="Replace this link — the old one stops working"
              onClick={() => {
                if (
                  !window.confirm(
                    "Replace the leaderboard link?\n\nThe current link stops working immediately — anyone who has it, including on a noticeboard or in a group chat, will get a not-found page. You'll need to share the new one.",
                  )
                ) {
                  return;
                }
                setRotating(true);
                void rotatePublicToken("share").finally(() => setRotating(false));
              }}
            >
              <Icon name="arrows-clockwise" /> New link
            </button>
          )}
        </div>
      )}

      <Group
        title="How scores get in"
        blurb="Who records them, from where, and when."
      />

      <Choice
        label="Who enters scores"
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

          <Choice
            label="How players sign in"
            value={form.playerAccess}
            options={PLAYER_ACCESS}
            labels={PLAYER_ACCESS_LABEL}
            help={PLAYER_ACCESS_HELP}
            disabled={!canEdit || pending}
            onChange={(v) => set("playerAccess", v)}
          />

          {/* WHAT TURNING ROUND CODES OFF WOULD COST, said before the choice
              rather than after it.

              `saveTournamentSettings` already REFUSES this change, which is
              the house answer to damage that lands on other people. A refusal
              is right and it arrives late: an organizer picks "Email", saves,
              and only then learns that forty entrants have no address and each
              needs one. The count is on the server the whole time.

              Read off `form`, not `settings`, so it disappears the moment they
              switch away and comes back if they switch back — the state the
              sentence describes is the one the dropdown is showing, not the
              one that was last saved.

              Same sentence as the refusal, from the same function. Two
              wordings of one rule is how a screen comes to promise something
              the action refuses. */}
          {lockoutNotice({ usingCodes: usesAccessCodes(form), strandedCount }) && (
            <p
              className="text-muted"
              style={{ fontSize: 12, margin: "-4px 0 0", lineHeight: 1.55 }}
            >
              <Icon name="warning-circle" />{" "}
              {lockoutNotice({ usingCodes: usesAccessCodes(form), strandedCount })}
            </p>
          )}

          <div className="field">
            <label>Voice entry</label>
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
      {isTournament && tees.length > 0 && (
        <>
          <Group
            title="Tees"
            /* The last sentence is the one a multi-venue tournament needs and
               nothing said. A stored `Player.teeId` names a row on ONE course;
               at another venue it is not a stale preference but a slope and a
               rating from somewhere else, so it is stepped past and the player
               falls in with the rest of the field. Said here because the
               control above is where somebody decides whether to rely on
               personal sets at all. */
            blurb="Which set this tournament is played from, and who decides. The tees change the Course Handicap, so they change the strokes. A player's own set only counts at the course it belongs to — anywhere else they play the round's."
          />

          <div className="field">
            <label htmlFor="default-tee">
              Played from <span className="text-muted">· anyone not put on their own set plays these</span>
            </label>
            <select
              id="default-tee"
              className="input"
              value={teeId ?? ""}
              disabled={!canEdit || pending}
              onChange={(e) => {
                setTeeId(e.target.value || null);
                setSaved(false);
              }}
            >
              {/* A real answer, not a blank: a society that has never thought
                  about tees is not misconfigured, and saying so is honest
                  about what the app will then do.

                  IT SAID "The first set on the course", AND THAT STOPPED
                  BEING TRUE. `teeForPlay` falls through to `defaultTeeFor`,
                  which prefers a RATED set over an unrated one — an unrated
                  set produces no course-handicap conversion at all, so
                  falling back to one would quietly price the field off raw
                  indexes with a rated set sitting behind it in the list. And
                  it scopes to the course THAT ROUND is played on, not to a
                  single course the tournament may not have: a two-day
                  member-guest at two clubs resolves this separately per day.

                  Neither is what the old sentence promised, and a label that
                  describes the wrong fallback is worse than a blank — it is
                  the reason an organizer does not go and look. */}
              <option value="">The first rated set at each round&rsquo;s course</option>
              {/**
                * GROUPED BY COURSE, because a two-venue tournament offers
                * both and clubs name their markers alike.
                *
                * The demo club has "Black" on two courses and "Green" on
                * three. Flat, that list reads as ten options with duplicate
                * names and no way to tell which is which — a reader picking
                * "Black" cannot know whose, and the rating beside it is the
                * only clue, which is exactly the number they came here to
                * decide rather than to decode.
                *
                * `optgroup` rather than putting the course in every label:
                * it says the course once per block, is what a screen reader
                * announces as a grouping, and keeps the option itself short
                * enough to read on a phone.
                *
                * Only when there IS more than one course. A single-venue
                * tournament gets a flat list, because a group heading
                * repeating the tournament's only course is furniture.
                */}
              {(() => {
                const byCourse = new Map<string, TeeOption[]>();
                for (const t of tees) {
                  const key = t.courseName ?? "";
                  if (!byCourse.has(key)) byCourse.set(key, []);
                  byCourse.get(key)!.push(t);
                }
                const option = (t: TeeOption) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.rated ? ` — ${t.courseRating.toFixed(1)} / ${t.slopeRating}` : " — not rated"}
                  </option>
                );
                if (byCourse.size < 2) return tees.map(option);
                return [...byCourse].map(([courseName, rows]) => (
                  <optgroup key={courseName} label={courseName || "Other courses"}>
                    {rows.map(option)}
                  </optgroup>
                ));
              })()}
            </select>
            {/* The rating IS the reason to choose one set over another, so an
                unrated pick is worth saying out loud rather than leaving to be
                discovered when the strokes come out the same off every tee. */}
            {teeId && !tees.find((t) => t.id === teeId)?.rated && (
              <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.5 }}>
                These tees have no Course Rating or Slope, so every player is scored off their raw
                handicap index. Add the ratings on the course to score properly.
              </p>
            )}
          </div>

          <Choice
            label="Who decides"
            value={form.teePolicy}
            options={TEE_POLICY}
            labels={TEE_POLICY_LABEL}
            help={TEE_POLICY_HELP}
            disabled={!canEdit || pending}
            onChange={(v) => set("teePolicy", v)}
          />
        </>
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
          set something that will never apply.
          This comment had drifted off its control: "Weekly sign-up" was
          inserted between it and the attestBy Choice it describes, so it read
          as an explanation of a setting it has nothing to do with — and
          "Weekly sign-up" is not gated on sign-off at all. Weekly sign-up is
          its own question and now sits under its own heading below. */}
      {form.scoreApproval === "players" && (
        <Choice
          label="How many playing partners must confirm"
          hint="Playing together means the players in one result — in match play that is the match, so two pairs sharing a tee time never approve each other's cards."
          value={form.attestBy}
          options={ATTEST_BY}
          labels={ATTEST_BY_LABEL}
          help={ATTEST_BY_HELP}
          disabled={!canEdit || pending}
          onChange={(v) => set("attestBy", v)}
        />
      )}

      <Group
        title="Weekly sign-up"
        blurb="Who is playing next week — nothing to do with scoring or sign-off. For a league that plays every week: whether the field is assumed in, assumed out, or the question never asked. Players answer per round, until each round's sign-up deadline."
      />

      <Choice
        label=""
        value={form.attendanceMode}
        options={ATTENDANCE_MODES}
        labels={ATTENDANCE_MODE_LABEL}
        help={ATTENDANCE_MODE_HELP}
        disabled={!canEdit || pending}
        onChange={(v) => set("attendanceMode", v)}
      />

      {/* WHAT THE SWITCH DOES TO THE PEOPLE ALREADY IN THE LEAGUE.
          Only explicit choices are stored, so every silent player's status is
          derived from this setting at read time — and moving an opt-out league
          to opt-in or captains turns everyone who has never touched the app
          from in to OUT, for every round, at the moment Save is pressed. The
          next tee sheet then comes out empty. Shown BEFORE saving, against the
          mode still in force, because afterwards it is not a warning. */}
      {attendanceWarning && (
        <p
          style={{
            fontSize: 12.5,
            margin: 0,
            lineHeight: 1.55,
            padding: "9px 11px",
            borderRadius: 9,
            background: "color-mix(in srgb, var(--color-text) 5%, transparent)",
          }}
        >
          <Icon name="warning-circle" /> {attendanceWarning}
        </p>
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
         * One button still, deliberately. This file already says why: "Two
         * save models on one screen is how a club changes something, presses
         * Save, and finds half of it kept." Per-group saves would fix the
         * distance by breaking that, so the button moves rather than
         * multiplies.
         *
         * Sticky only while DIRTY, so a screen nobody has touched carries no
         * floating chrome — and sticky to the BOTTOM, which pins it inside
         * this section only: scroll up into Courses and it is gone, because
         * those controls are not part of this form and a Save hovering over
         * them would be lying about what it saves.
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
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Only the organizer can change these.
        </p>
      )}

      {/* ── Round Codes ─────────────────────────────────────────────────── */}
      {isTournament && codesOn && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
          <span className="card-title" style={{ fontSize: 14 }}>Round Codes</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
            One code per round. Read it out on the first tee or put it on the tee sheet — players enter it,
            then pick their own name. Anyone with the code can report a score for that round, so reissue it if
            it travels beyond the field.
          </p>

          {rounds.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              Codes appear here once the tournament has rounds. Add them on {screenName("/stages")}.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Round</th>
                    <th style={{ width: 150 }}>Code</th>
                    <th style={{ width: 190 }} />
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((r) => (
                    <tr key={r.stageId}>
                      <td>{r.label}</td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)", letterSpacing: "0.06em" }}>
                        {r.code ? formatAccessCode(r.code) : "—"}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {r.code && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 12, padding: "3px 9px" }}
                            onClick={() => copy(formatAccessCode(r.code), r.stageId)}
                          >
                            <Icon name="copy" /> {copied === r.stageId ? "Copied" : "Copy"}
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 12, padding: "3px 9px", marginLeft: 6 }}
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () => {
                                const res = await regenerateRoundCode(r.stageId);
                                if (!res.ok) setError(res.error ?? "Couldn't reissue the code.");
                              })
                            }
                          >
                            <Icon name="arrows-clockwise" /> Reissue
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
