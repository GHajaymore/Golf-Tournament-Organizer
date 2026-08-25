"use client";
import { useEffect, useState, useTransition } from "react";
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
} from "@/lib/domain/attendance";
import {
  PLAYER_ACCESS,
  PLAYER_ACCESS_LABEL,
  PLAYER_ACCESS_HELP,
  usesAccessCodes,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import { formatAccessCode } from "@/lib/code-format";

export interface RoundCode {
  stageId: string;
  label: string;
  code: string;
}

interface Props {
  mode: "tournament" | "organization";
  settings: TournamentSettings;
  canEdit: boolean;
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
            <i className="ph ph-copy" /> {copied === "share" ? "Copied" : "Copy"}
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
              <i className="ph ph-arrows-clockwise" /> New link
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
            blurb="Which set this tournament is played from, and who decides. The tees change the Course Handicap, so they change the strokes."
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
                  about what the app will then do. */}
              <option value="">The first set on the course</option>
              {tees.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.rated ? ` — ${t.courseRating.toFixed(1)} / ${t.slopeRating}` : " — not rated"}
                </option>
              ))}
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

      {error && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      {canEdit ? (
        <button
          type="button"
          className="btn btn-primary"
          style={{ alignSelf: "flex-start" }}
          disabled={pending || !dirty}
          onClick={save}
        >
          <i className="ph ph-check" /> {pending ? "Saving…" : saved && !dirty ? "Saved" : "Save settings"}
        </button>
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
              Codes appear here once the tournament has rounds. Add them on Rounds &amp; format.
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
                            <i className="ph ph-copy" /> {copied === r.stageId ? "Copied" : "Copy"}
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
                            <i className="ph ph-arrows-clockwise" /> Reissue
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
