"use client";
import { useState, useTransition } from "react";
import {
  setStageDeadline,
  setStageCarry,
  setStageScoringBasis,
  setStageFormat,
  setStageHoles,
  addStage,
  removeStage,
  generateNextRound,
} from "@/app/actions/tournament";
import { setStageCourse } from "@/app/actions/courses";
import { GOLF_FORMATS } from "@/lib/formats";
import { chainIssues, issuesForRound, carryForwardPrompt, type CarryPrompt } from "@/lib/format-chain";
import { ScoringClient } from "./ScoringClient";
import { QualControl } from "./QualControl";
import { CutControl } from "./CutControl";
import type { TiebreakerKey } from "@/lib/domain";

export interface StageView {
  id: string;
  position: number;
  type: string;
  description: string;
  format: string;
  holes: number;
  deadline: string;
  scoringBasis: string;
  carryEnabled: boolean;
  carryPct: number;
  /** Whether the organizer has answered the carry-forward question either way. */
  carryAsked: boolean;
  cutEnabled: boolean;
  cutMode: string;
  cutCount: number;
  cutPercent: number;
  matchCount: number;
  /** Venue for this round; null means the tournament's own course. */
  courseId: string | null;
  /** full | front | back — which nine, when the round is 9 holes. */
  nine: string;
}

export interface ScoringValues {
  winPts: number;
  tiePts: number;
  lossPts: number;
  holeRatioPts: number;
  bonusPts: number;
}

export interface QualValues {
  mode: string;
  perFlight: number;
  overall: number;
}

const STAGE_TYPES = ["Round Robin", "Single Match Stage", "Qualification Stage", "Bracket Stage"];

/** Rotating per-round accent so a page of several round cards reads as distinct at a glance. */
const ROUND_PALETTE = ["var(--color-accent)", "var(--color-accent-2)", "var(--color-accent-400)", "var(--color-accent-2-400)"];

const BASIS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "gross", label: "Gross" },
  { key: "net", label: "Net" },
  { key: "both", label: "Both" },
  { key: "stableford", label: "Stableford" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="card-kicker" style={{ display: "block" }}>{children}</span>;
}

/**
 * Configures what happens between this round and the next one — carry-forward
 * and the cut line — right from the round you're currently looking at. Both
 * controls are always live: if the next round doesn't exist yet, touching
 * either one creates it automatically (via ensureNextStageId) instead of
 * requiring a separate "Add round" step first. Keyed by the next stage's id
 * (or "none") so its local state re-syncs whenever a round gets added/removed.
 */
function NextRoundTransition({
  stageId,
  nextStage,
  confirmedCount,
  carry,
}: {
  /** The current round's id — where a newly-created next round gets appended after. */
  stageId: string;
  nextStage: StageView | undefined;
  confirmedCount: number;
  /** Whether to put the carry-forward question in front of the organizer. */
  carry: CarryPrompt;
}) {
  const [carryEnabled, setCarryEnabled] = useState(nextStage?.carryEnabled ?? false);
  const [carryPct, setCarryPct] = useState(nextStage?.carryPct ?? 0);
  const [pending, startTransition] = useTransition();
  const [genPending, startGenTransition] = useTransition();

  // Resolves to the real next-round id, creating a Round Robin round first if
  // one doesn't exist yet — so the cut/carry controls work immediately.
  const ensureNextStageId = async (): Promise<string> => {
    if (nextStage) return nextStage.id;
    const id = await addStage("Round Robin");
    return id ?? stageId;
  };

  const commitCarry = (nextEnabled: boolean, nextPct: number) => {
    setCarryEnabled(nextEnabled);
    setCarryPct(nextPct);
    startTransition(async () => {
      const id = await ensureNextStageId();
      await setStageCarry(id, nextEnabled, nextPct);
    });
  };

  const roundLabel = nextStage ? `Round ${nextStage.position + 1}` : "the next round";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Asked outright rather than left as an unchecked box. In a points
          league whether a strong round still counts is the central decision of
          the format, and nobody finds it by accident halfway down a panel. */}
      {carry.ask && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "12px 14px",
            borderRadius: 10,
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>{carry.question}</span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>{carry.detail}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => commitCarry(true, carryPct > 0 ? carryPct : 100)}
            >
              Yes, carry them forward
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => commitCarry(false, 0)}
            >
              No, each round starts fresh
            </button>
          </div>
        </div>
      )}

      {carry.inert ? (
        // Offering a switch that does nothing is worse than not offering it:
        // strokeStandings are built from the returned cards and never read the
        // carried total, so turning this on for a stroke round changes nothing.
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          {carry.detail}
        </p>
      ) : (
      <>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={carryEnabled} onChange={(e) => commitCarry(e.target.checked, carryPct)} />
          Carry forward points into {roundLabel}
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={carryPct}
          disabled={!carryEnabled}
          onChange={(e) => commitCarry(carryEnabled, parseInt(e.target.value, 10))}
          style={{ flex: 1, minWidth: 120 }}
        />
        <span className="tag tag-accent" style={{ minWidth: 48, textAlign: "center" }}>{carryPct}%</span>
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: "0 0 0 2px" }}>
        {carryEnabled
          ? `At ${carryPct}%, a player on 12 pts here starts ${roundLabel} with ${(12 * carryPct) / 100} pts.`
          : `Off — ${roundLabel} starts scoring from zero; no points carry over from this round.`}
      </p>
      </>
      )}

      <div style={{ borderTop: "1px solid var(--color-divider)", margin: "4px 0", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <CutControl
          formId={stageId}
          getStageId={ensureNextStageId}
          roundLabel={roundLabel}
          enabled={nextStage?.cutEnabled ?? false}
          mode={nextStage?.cutMode ?? "count"}
          count={nextStage?.cutCount ?? 16}
          percent={nextStage?.cutPercent ?? 50}
          confirmedCount={confirmedCount}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={genPending}
            onClick={() =>
              startGenTransition(async () => {
                const id = await ensureNextStageId();
                await generateNextRound(id);
              })
            }
          >
            <i className="ph ph-arrows-clockwise" /> {nextStage?.matchCount ? "Regenerate" : "Generate"} {roundLabel} pairings
          </button>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {nextStage?.cutEnabled
              ? `Builds ${roundLabel}'s matches from this round's current standings — run it once this round is complete.`
              : `Builds ${roundLabel}'s matches for the full field, from the current flights.`}
            {!!nextStage?.matchCount && " Re-running replaces that round's matches."}
          </span>
        </div>
        {nextStage && nextStage.matchCount === 0 && (
          <span className="tag tag-neutral" style={{ alignSelf: "flex-start" }}>
            <i className="ph ph-clock" /> {roundLabel} not generated yet
          </span>
        )}
      </div>
    </div>
  );
}

function StageCard({
  stage,
  isFirst,
  nextStage,
  rrMatchesPerPlayer,
  scoring,
  tiebreakers,
  qual,
  confirmedCount,
  venues,
  chainWarnings,
  chainsRounds,
}: {
  stage: StageView;
  isFirst: boolean;
  nextStage: StageView | undefined;
  rrMatchesPerPlayer: number;
  scoring: ScoringValues;
  tiebreakers: TiebreakerKey[];
  qual: QualValues;
  confirmedCount: number;
  venues: Array<{ id: string; name: string }>;
  /** Ways this round doesn't fit the one before it. */
  chainWarnings: string[];
  /** False for a single-round tournament, which has no next round. */
  chainsRounds: boolean;
}) {
  const [deadline, setDeadline] = useState(stage.deadline);
  const [basis, setBasis] = useState(stage.scoringBasis);
  const [format, setFormat] = useState(stage.format);
  const [holes, setHoles] = useState(stage.holes);
  const [courseId, setCourseId] = useState<string | null>(stage.courseId);
  const [nine, setNine] = useState(stage.nine === "back" ? "back" : "front");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [formatInfoOpen, setFormatInfoOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const commitFormat = (v: string) => {
    setFormat(v);
    startTransition(() => setStageFormat(stage.id, v));
  };
  const commitHoles = (v: number) => {
    setHoles(v);
    startTransition(() => setStageHoles(stage.id, v));
  };
  // Venue and nine travel together: the action takes both, and a round that
  // changes course usually needs its nine restated for the new card.
  const commitVenue = (nextCourse: string | null, nextNine: string) => {
    setCourseId(nextCourse);
    setNine(nextNine);
    startTransition(() => void setStageCourse(stage.id, nextCourse, holes === 9 ? nextNine : "full"));
  };
  const commitBasis = (next: string) => {
    setBasis(next);
    startTransition(() => setStageScoringBasis(stage.id, next));
  };

  const activeFormat = GOLF_FORMATS.find((f) => f.name === format);
  // Every format in the catalog is listed, but only those runnable end to end
  // can be picked. Showing the rest greyed out with the reason is deliberate:
  // hiding them entirely makes the app look like it can't do team golf, while
  // letting them be selected hands someone a round with nowhere to enter a
  // card. A round already set to something unselectable still shows it.
  const formatOptions: { name: string; disabled: boolean; note?: string }[] = [
    ...GOLF_FORMATS.filter((f) => f.playable || f.name === format).map((f) => ({
      name: f.name,
      disabled: false,
    })),
    ...GOLF_FORMATS.filter((f) => !f.playable && f.name !== format).map((f) => ({
      name: f.name,
      disabled: true,
      note: f.pendingReason,
    })),
  ];
  // A legacy label from before the catalog was restricted still needs to show.
  if (!GOLF_FORMATS.some((f) => f.name === format)) {
    formatOptions.unshift({ name: format, disabled: false });
  }
  const activePending = GOLF_FORMATS.find((f) => f.name === format && !f.playable);

  // Whether to put the carry-forward question in front of the organizer, and
  // whether the control can do anything at all for this round's scoring.
  const carryPrompt = carryForwardPrompt({
    chainsRounds,
    hasNextRound: !!nextStage,
    format,
    scoringBasis: basis,
    answered: nextStage?.carryAsked ?? false,
    locked: false,
  });

  // Round Robin description is derived (no hard-coded round count).
  const description =
    stage.type === "Round Robin"
      ? `Players compete against everyone in their flight — ${rrMatchesPerPlayer} ${rrMatchesPerPlayer === 1 ? "match" : "matches"} each.`
      : stage.description;

  // Carry-forward and the cut line describe what happens *into the next
  // round*. A single-round tournament has no next round, so offering them
  // asks an organizer to configure something that cannot happen — which is
  // what the shape question exists to stop.
  const showTransition = stage.type === "Round Robin" && chainsRounds;
  const notGenerated = !isFirst && stage.type === "Round Robin" && stage.matchCount === 0;

  // One rich, always-legible summary line for the collapsed toggle — covers
  // every setting on this card (including what happens into the next round),
  // so there's a single place to both see and change everything, and nothing
  // is invisible just because it hasn't been customized yet.
  const transitionParts: string[] = [];
  if (nextStage?.carryEnabled) transitionParts.push(`carries ${nextStage.carryPct}%`);
  if (nextStage?.cutEnabled) {
    transitionParts.push(nextStage.cutMode === "percent" ? `cuts to top ${nextStage.cutPercent}%` : `cuts to top ${nextStage.cutCount}`);
  }
  const summaryParts: string[] = [];
  if (deadline) summaryParts.push(`Due ${deadline}`);
  if (basis !== "gross") {
    summaryParts.push(basis === "net" ? "Net scoring" : basis === "stableford" ? "Stableford" : "Gross + net");
  }
  if (stage.type === "Qualification Stage") {
    summaryParts.push(qual.mode === "overall" ? `Top ${qual.overall} overall` : `Top ${qual.perFlight} per flight`);
  }
  if (showTransition) {
    summaryParts.push(
      nextStage
        ? `Into Round ${nextStage.position + 1}: ${transitionParts.length ? transitionParts.join(" · ") : "no cut or carry-forward"}`
        : "No round after this yet",
    );
  }
  const summaryLine = summaryParts.length ? summaryParts.join(" · ") : "Standard settings";

  // A rotating accent per round so a page of several rounds is scannable at a
  // glance instead of every card reading identically — the round number does
  // the differentiating (not the type icon, which repeats for every
  // Round Robin stage anyway).
  const roundColor = ROUND_PALETTE[stage.position % ROUND_PALETTE.length];

  return (
    <div className="card elev-sm" style={{ gap: 14, borderLeft: `3px solid ${roundColor}` }}>
      {chainWarnings.length > 0 && (
        // Shown on the later round of the pair, because that is where the
        // carry-forward or cut setting causing it actually lives. Advisory
        // rather than blocking: plenty of real tournaments do deliberately odd
        // things, and an organizer who understands the trade shouldn't be
        // stopped by an app that doesn't.
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "10px 12px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <i className="ph ph-warning" />
            {chainWarnings.length === 1 ? "Check this round follows on" : "Check how this round follows on"}
          </span>
          {chainWarnings.map((w, i) => (
            <p key={i} className="text-muted" style={{ fontSize: 12, margin: 0 }}>{w}</p>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div
          style={{
            width: 44,
            height: 44,
            flex: "none",
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: `color-mix(in srgb, ${roundColor} 18%, transparent)`,
            color: roundColor,
            fontFamily: "var(--font-heading)",
            fontWeight: 700,
            fontSize: 19,
          }}
          title={stage.type}
        >
          {stage.position + 1}
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 16 }}>
              Round {stage.position + 1} · {stage.type}
            </span>
            <span className="tag tag-neutral">{isFirst ? "Active" : "Upcoming"}</span>
            {notGenerated && (
              <span className="tag tag-neutral"><i className="ph ph-clock" /> Not generated yet</span>
            )}
          </div>
        </div>
        <div className="field" style={{ width: 200 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
            Format
            <button
              type="button"
              onClick={() => setFormatInfoOpen((o) => !o)}
              title="About this round"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-neutral-500)", display: "inline-flex" }}
            >
              <i className="ph ph-info" style={{ fontSize: 13 }} />
            </button>
          </label>
          <select className="input" value={format} disabled={pending} onChange={(e) => commitFormat(e.target.value)}>
            {formatOptions.map((o) => (
              <option key={o.name} value={o.name} disabled={o.disabled}>
                {o.disabled && o.note ? `${o.name} — ${o.note}` : o.name}
              </option>
            ))}
          </select>
          {activePending && (
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              This round is set to {activePending.name}, which can be configured but not yet
              scored — {activePending.pendingReason}.
            </p>
          )}
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Holes</label>
          <div className="seg" style={{ width: "100%" }}>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name={`holes-${stage.id}`} checked={holes === 18} disabled={pending} onChange={() => commitHoles(18)} />18
            </label>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name={`holes-${stage.id}`} checked={holes === 9} disabled={pending} onChange={() => commitHoles(9)} />9
            </label>
          </div>
        </div>

        {/* Which nine, when the round is 9 holes. Front and back have their own
            pars and stroke indexes, so a net round on the back allocates shots
            completely differently — this is not cosmetic. */}
        {holes === 9 && (
          <div className="field" style={{ width: 130 }}>
            <label>Which nine</label>
            <select
              className="input"
              value={nine}
              disabled={pending}
              onChange={(e) => commitVenue(courseId, e.target.value)}
            >
              <option value="front">Front nine</option>
              <option value="back">Back nine</option>
            </select>
          </div>
        )}

        {/* Only where the tournament rotates venues. One course means the
            whole event is played there and asking would be noise. */}
        {venues.length > 1 && (
          <div className="field" style={{ minWidth: 170 }}>
            <label>Course</label>
            <select
              className="input"
              value={courseId ?? ""}
              disabled={pending}
              onChange={(e) => commitVenue(e.target.value || null, nine)}
            >
              <option value="">Same as the tournament</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        )}
        <button
          type="button"
          className="btn btn-icon"
          title="Remove stage"
          disabled={pending}
          onClick={() => startTransition(() => removeStage(stage.id))}
        >
          <i className="ph ph-trash" />
        </button>
      </div>

      {formatInfoOpen && (
        <div className="text-muted" style={{ fontSize: 12, margin: "-8px 0 0 60px", display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={{ margin: 0 }}>{description}</p>
          {activeFormat && (
            <p style={{ margin: 0 }}>
              <b style={{ color: "var(--color-accent-300)" }}>{activeFormat.name}</b> — {activeFormat.desc}
            </p>
          )}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setCustomizeOpen((o) => !o)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: "var(--color-bg)",
            border: "1px solid var(--color-divider)",
            borderRadius: "var(--radius-md)",
            padding: "10px 14px",
            cursor: "pointer",
            textAlign: "left",
            color: "var(--color-text)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, flex: "none", color: "var(--color-text)" }}>
            <i className={customizeOpen ? "ph ph-caret-down" : "ph ph-caret-right"} style={{ color: "var(--color-accent-300)" }} />
            <i className="ph ph-sliders" style={{ color: "var(--color-accent-300)" }} />
            Customize this round
          </span>
          {!customizeOpen && (
            <span className="text-muted" style={{ fontSize: 12, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {summaryLine}
            </span>
          )}
        </button>

        {customizeOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div className="field" style={{ width: 320 }}>
                <label>Result calculation</label>
                <div className="seg" style={{ width: "100%" }}>
                  {BASIS_OPTIONS.map((o) => (
                    <label key={o.key} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                      <input type="radio" name={`basis-${stage.id}`} checked={basis === o.key} disabled={pending} onChange={() => commitBasis(o.key)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field" style={{ width: 190 }}>
                <label>Completion deadline</label>
                <input
                  className="input"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  onBlur={() => startTransition(() => setStageDeadline(stage.id, deadline))}
                />
              </div>
            </div>

            {showTransition && (
              <div>
                <SectionLabel>Cut line &amp; carry-forward — before the next round</SectionLabel>
                <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                  Carry points forward and/or cut the field before it moves on from this round.
                </p>
                <NextRoundTransition key={nextStage?.id ?? "none"} stageId={stage.id} nextStage={nextStage} confirmedCount={confirmedCount} carry={carryPrompt} />
              </div>
            )}

            {stage.type === "Qualification Stage" && (
              <div>
                <SectionLabel>Qualification cut</SectionLabel>
                <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                  How many players advance from this cut — top N per flight, or top N overall.
                </p>
                <QualControl mode={qual.mode} perFlight={qual.perFlight} overall={qual.overall} />
              </div>
            )}

            {stage.type === "Round Robin" && (
              <div>
                <SectionLabel>Match Points &amp; tiebreakers</SectionLabel>
                {format === "Match Play" ? (
                  <>
                    <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
                      Points for match results in round-robin play, and the tiebreakers that settle level
                      standings. Shared by all round-robin rounds scored as Match Play.
                    </p>
                    <ScoringClient initial={scoring} tiebreakers={tiebreakers} />
                  </>
                ) : (
                  <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                    This round is scored as Stroke Play — ties break by{" "}
                    {basis === "stableford" ? "highest Stableford points" : "lowest net, then lowest gross"}.
                    Match Points &amp; tiebreakers only apply to Match Play rounds.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function StagesClient({
  stages,
  rrMatchesPerPlayer,
  scoring,
  tiebreakers,
  qual,
  confirmedCount,
  venues = [],
  chainsRounds = true,
}: {
  stages: StageView[];
  rrMatchesPerPlayer: number;
  scoring: ScoringValues;
  tiebreakers: TiebreakerKey[];
  qual: QualValues;
  confirmedCount: number;
  /** Courses this tournament may be played on; more than one shows the picker. */
  venues?: Array<{ id: string; name: string }>;
  /** Whether rounds feed each other — false for a single-round tournament. */
  chainsRounds?: boolean;
}) {
  const [newType, setNewType] = useState(STAGE_TYPES[0]);
  const [pending, startTransition] = useTransition();

  const rrStages = stages.filter((s) => s.type === "Round Robin");

  // Where the rounds don't fit together. Rounds chain — standings carry
  // forward, cuts pick the next field from the last round's results — and that
  // silently assumes consecutive rounds measure the same thing. Once any round
  // can be any format, they often don't.
  const chain = chainIssues(
    stages.map((s) => ({
      position: s.position,
      format: s.format,
      scoringBasis: s.scoringBasis,
      carryForwardEnabled: s.carryEnabled,
      cutEnabled: s.cutEnabled,
    })),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {stages.map((s, i) => {
        const rrIdx = rrStages.findIndex((r) => r.id === s.id);
        const nextStage = rrIdx >= 0 ? rrStages[rrIdx + 1] : undefined;
        return (
          <StageCard
            key={s.id}
            stage={s}
            isFirst={i === 0}
            nextStage={nextStage}
            rrMatchesPerPlayer={rrMatchesPerPlayer}
            scoring={scoring}
            tiebreakers={tiebreakers}
            qual={qual}
            confirmedCount={confirmedCount}
            venues={venues}
            chainWarnings={issuesForRound(chain, s.position).map((w) => w.message)}
            chainsRounds={chainsRounds}
          />
        );
      })}
      {stages.length === 0 && (
        <div className="card elev-sm">
          <span className="text-muted" style={{ fontSize: 13 }}>
            No rounds yet — add your first round below (start with a Round Robin).
          </span>
        </div>
      )}

      <div className="card elev-sm" style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className="card-title" style={{ fontSize: 15 }}>Add a round</span>
        <select className="input" style={{ width: "auto", minWidth: 190 }} value={newType} onChange={(e) => setNewType(e.target.value)}>
          {STAGE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => startTransition(async () => { await addStage(newType); })}
        >
          <i className="ph ph-plus" /> Add round
        </button>
        <span className="text-muted" style={{ fontSize: 12 }}>
          Sequence any number of rounds: round robin → single match → qualification → bracket.
        </span>
      </div>
    </div>
  );
}
