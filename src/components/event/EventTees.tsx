"use client";
import { TEE_POLICY, TEE_POLICY_LABEL, TEE_POLICY_HELP, type TournamentSettings } from "@/lib/tournament-settings";
import { Icon } from "../Icon";
import { Choice, Group } from "../SettingsChoice";

export interface TeeOption {
  id: string;
  name: string;
  /**
   * The course this set belongs to.
   *
   * A tournament played over two venues offers both courses' sets in one list, and clubs name
   * markers alike — the demo club has "Black" on two courses and "Green" on three. Optional so a
   * caller that has not been taught renders exactly what it did.
   */
  courseName?: string;
  courseRating: number;
  slopeRating: number;
  /** False when nobody has entered a rating, so this set changes nothing. */
  rated: boolean;
}

/**
 * THE EVENT'S TEES: the default set, why it may be shut, and who may play others. Lifted out of
 * `PlaySettings` (R3-1), no behaviour change; Event (R3) mounts it beside the course.
 *
 * The chosen set (`teeId`) stays in the caller, because it is saved by the SAME button as the rest
 * of the form: two save models on one screen is how a club changes something, presses Save, and
 * finds half of it kept.
 */
export function EventTees({
  tees,
  teeId,
  teesDoor,
  teePolicy,
  canEdit,
  pending,
  onTee,
  onTeePolicy,
}: {
  tees: TeeOption[];
  teeId: string | null;
  /** Why the tees cannot change now (the rounds rule's sentence), or null. */
  teesDoor: string | null;
  teePolicy: TournamentSettings["teePolicy"];
  canEdit: boolean;
  pending: boolean;
  onTee: (id: string | null) => void;
  onTeePolicy: (v: TournamentSettings["teePolicy"]) => void;
}) {
  return (
    <>
      <Group
        title="Tees"
        /* The last sentence is the one a multi-venue tournament needs: a stored `Player.teeId` names a
           row on ONE course; at another venue it is a slope and a rating from somewhere else, so it is
           stepped past and the player falls in with the rest of the field. */
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
          disabled={!canEdit || pending || !!teesDoor}
          aria-describedby={teesDoor ? "default-tee-door" : undefined}
          onChange={(e) => onTee(e.target.value || null)}
        >
          {/* A real answer, not a blank: a society that has never thought about tees is not
              misconfigured. `teeForPlay` falls through to `defaultTeeFor`, which prefers a RATED set
              and scopes to the course THAT ROUND is played on. */}
          <option value="">The first rated set at each round&rsquo;s course</option>
          {/* GROUPED BY COURSE when there is more than one, because a two-venue tournament offers both
              and clubs name their markers alike. A single-venue tournament gets a flat list. */}
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
        {/* WHY IT IS SHUT, under it, before anybody presses (J12, PR 7b): the rounds rule's own
            sentence, the one Save would be refused with. Said to whoever may edit. */}
        {canEdit && teesDoor && (
          <p id="default-tee-door" data-testid="default-tee-door" className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
            <Icon name="lock-simple" /> {teesDoor}
          </p>
        )}
        {/* The rating IS the reason to choose one set over another, so an unrated pick is worth
            saying out loud rather than leaving to be discovered when the strokes come out the same. */}
        {teeId && !tees.find((t) => t.id === teeId)?.rated && (
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
            These tees have no Course Rating or Slope, so every player is scored off their raw
            handicap index. Add the ratings on the course to score properly.
          </p>
        )}
      </div>

      <Choice
        label="Who may play other tees"
        value={teePolicy}
        options={TEE_POLICY}
        labels={TEE_POLICY_LABEL}
        help={TEE_POLICY_HELP}
        disabled={!canEdit || pending}
        onChange={onTeePolicy}
      />
    </>
  );
}
