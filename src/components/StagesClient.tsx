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
import { GOLF_FORMATS, SCORED_FORMAT_NAMES } from "@/lib/formats";
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
  cutEnabled: boolean;
  cutMode: string;
  cutCount: number;
  cutPercent: number;
  matchCount: number;
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

const ICONS: Record<string, string> = {
  "Round Robin": "ph ph-arrows-clockwise",
  "Qualification Stage": "ph ph-flag-checkered",
  "Single Match Stage": "ph ph-sword",
  "Bracket Stage": "ph ph-tree-structure",
};

const STAGE_TYPES = ["Round Robin", "Single Match Stage", "Qualification Stage", "Bracket Stage"];

const BASIS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "gross", label: "Gross" },
  { key: "net", label: "Net" },
  { key: "both", label: "Both" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="card-kicker" style={{ display: "block" }}>{children}</span>;
}

function StageCard({
  stage,
  isFirst,
  rrMatchesPerPlayer,
  scoring,
  tiebreakers,
  qual,
  confirmedCount,
}: {
  stage: StageView;
  isFirst: boolean;
  rrMatchesPerPlayer: number;
  scoring: ScoringValues;
  tiebreakers: TiebreakerKey[];
  qual: QualValues;
  confirmedCount: number;
}) {
  const [deadline, setDeadline] = useState(stage.deadline);
  const [basis, setBasis] = useState(stage.scoringBasis);
  const [format, setFormat] = useState(stage.format);
  const [holes, setHoles] = useState(stage.holes);
  const [carryEnabled, setCarryEnabled] = useState(stage.carryEnabled);
  const [carryPct, setCarryPct] = useState(stage.carryPct);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [formatInfoOpen, setFormatInfoOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [genPending, startGenTransition] = useTransition();

  const commitFormat = (v: string) => {
    setFormat(v);
    startTransition(() => setStageFormat(stage.id, v));
  };
  const commitHoles = (v: number) => {
    setHoles(v);
    startTransition(() => setStageHoles(stage.id, v));
  };
  const commitCarry = (nextEnabled: boolean, nextPct: number) => {
    setCarryEnabled(nextEnabled);
    setCarryPct(nextPct);
    startTransition(() => setStageCarry(stage.id, nextEnabled, nextPct));
  };
  const commitBasis = (next: string) => {
    setBasis(next);
    startTransition(() => setStageScoringBasis(stage.id, next));
  };

  const activeFormat = GOLF_FORMATS.find((f) => f.name === format);
  // Only formats with a real scoring engine are selectable; a round already set
  // to a legacy label (e.g. from before this restriction) still shows it.
  const formatOptions = SCORED_FORMAT_NAMES.includes(format) ? SCORED_FORMAT_NAMES : [format, ...SCORED_FORMAT_NAMES];

  // Round Robin description is derived (no hard-coded round count).
  const description =
    stage.type === "Round Robin"
      ? `Players compete against everyone in their flight — ${rrMatchesPerPlayer} ${rrMatchesPerPlayer === 1 ? "match" : "matches"} each.`
      : stage.description;

  const showCutBlock = !isFirst && stage.type === "Round Robin";
  const notGenerated = showCutBlock && stage.matchCount === 0;

  // Summary of anything non-default, shown when the customize panel is collapsed
  // so nothing is hidden — just tucked away until you need to change it.
  const badges: string[] = [];
  if (basis !== "gross") badges.push(basis === "net" ? "Net scoring" : "Gross + net");
  if (deadline) badges.push(`Due ${deadline}`);
  if (!isFirst && carryEnabled) badges.push(`Carries ${carryPct}%`);
  if (showCutBlock && stage.cutEnabled) {
    badges.push(stage.cutMode === "percent" ? `Cuts to top ${stage.cutPercent}%` : `Cuts to top ${stage.cutCount}`);
  }
  if (stage.type === "Qualification Stage") {
    badges.push(qual.mode === "overall" ? `Top ${qual.overall} overall` : `Top ${qual.perFlight} per flight`);
  }

  return (
    <div className="card elev-sm" style={{ gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div
          style={{
            width: 44,
            height: 44,
            flex: "none",
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: "var(--color-accent-900)",
            color: "var(--color-accent-200)",
          }}
        >
          <i className={ICONS[stage.type] ?? "ph ph-stack"} style={{ fontSize: 22 }} />
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
            {formatOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
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
            background: "none",
            border: "none",
            color: "var(--color-accent-300)",
            cursor: "pointer",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "2px",
          }}
        >
          <i className={customizeOpen ? "ph ph-caret-down" : "ph ph-caret-right"} />
          <i className="ph ph-sliders" /> Customize this round
        </button>
        {!customizeOpen && badges.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {badges.map((b) => (
              <span key={b} className="tag tag-outline" style={{ fontSize: 11 }}>{b}</span>
            ))}
          </div>
        )}

        {customizeOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div className="field" style={{ width: 220 }}>
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

            {stage.type === "Round Robin" && (
              <div>
                <SectionLabel>Match Points &amp; tiebreakers</SectionLabel>
                <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
                  Points for match results in round-robin play, and the tiebreakers that settle level
                  standings. Shared by all round-robin rounds.
                </p>
                <ScoringClient initial={scoring} tiebreakers={tiebreakers} />
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

            {!isFirst && (
              <div>
                <SectionLabel>Carry forward points</SectionLabel>
                <div
                  style={{
                    marginTop: 6,
                    padding: "12px 16px",
                    border: "1px solid var(--color-divider)",
                    borderRadius: "var(--radius-md)",
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    flexWrap: "wrap",
                    background: "var(--color-bg)",
                  }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={carryEnabled} onChange={(e) => commitCarry(e.target.checked, carryPct)} />
                    Carry forward points from the previous stage
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
                <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0 2px" }}>
                  {carryEnabled
                    ? `At ${carryPct}%, a player on 12 pts from the previous stage starts this stage with ${(12 * carryPct) / 100} pts.`
                    : "Disabled — every player starts this stage at zero."}
                </p>
              </div>
            )}

            {showCutBlock && (
              <div>
                <SectionLabel>Field cut entering this round</SectionLabel>
                <div
                  style={{
                    marginTop: 6,
                    padding: "12px 16px",
                    border: "1px solid var(--color-divider)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--color-bg)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <CutControl
                    stageId={stage.id}
                    enabled={stage.cutEnabled}
                    mode={stage.cutMode}
                    count={stage.cutCount}
                    percent={stage.cutPercent}
                    confirmedCount={confirmedCount}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={genPending}
                      onClick={() => startGenTransition(() => generateNextRound(stage.id))}
                    >
                      <i className="ph ph-arrows-clockwise" /> {stage.matchCount > 0 ? "Regenerate" : "Generate"} Round {stage.position + 1} pairings
                    </button>
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {stage.cutEnabled
                        ? "Builds this round's matches from the previous round's current standings — run it once that round is complete."
                        : "Builds this round's matches for the full field, from the previous round's flights."}
                      {stage.matchCount > 0 && " Re-running replaces this round's matches."}
                    </span>
                  </div>
                </div>
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
}: {
  stages: StageView[];
  rrMatchesPerPlayer: number;
  scoring: ScoringValues;
  tiebreakers: TiebreakerKey[];
  qual: QualValues;
  confirmedCount: number;
}) {
  const [newType, setNewType] = useState(STAGE_TYPES[0]);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {stages.map((s, i) => (
        <StageCard
          key={s.id}
          stage={s}
          isFirst={i === 0}
          rrMatchesPerPlayer={rrMatchesPerPlayer}
          scoring={scoring}
          tiebreakers={tiebreakers}
          qual={qual}
          confirmedCount={confirmedCount}
        />
      ))}
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
          onClick={() => startTransition(() => addStage(newType))}
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
