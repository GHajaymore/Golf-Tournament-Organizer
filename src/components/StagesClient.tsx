"use client";
import { useState, useTransition } from "react";
import { setStageDeadline, setStageCarry, setStageScoringBasis, addStage, removeStage } from "@/app/actions/tournament";

export interface StageView {
  id: string;
  position: number;
  type: string;
  description: string;
  deadline: string;
  scoringBasis: string;
  carryEnabled: boolean;
  carryPct: number;
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

function StageCard({
  stage,
  isFirst,
  rrMatchesPerPlayer,
}: {
  stage: StageView;
  isFirst: boolean;
  rrMatchesPerPlayer: number;
}) {
  const [deadline, setDeadline] = useState(stage.deadline);
  const [basis, setBasis] = useState(stage.scoringBasis);
  const [enabled, setEnabled] = useState(stage.carryEnabled);
  const [pct, setPct] = useState(stage.carryPct);
  const [pending, startTransition] = useTransition();

  // Round Robin description is derived (no hard-coded round count).
  const description =
    stage.type === "Round Robin"
      ? `Players compete against everyone in their flight — ${rrMatchesPerPlayer} ${rrMatchesPerPlayer === 1 ? "match" : "matches"} each.`
      : stage.description;

  const commitCarry = (nextEnabled: boolean, nextPct: number) => {
    setEnabled(nextEnabled);
    setPct(nextPct);
    startTransition(() => setStageCarry(stage.id, nextEnabled, nextPct));
  };
  const commitBasis = (next: string) => {
    setBasis(next);
    startTransition(() => setStageScoringBasis(stage.id, next));
  };

  return (
    <>
      <div className="card elev-sm" style={{ flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
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
          </div>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>{description}</div>
        </div>
        <div className="field" style={{ width: 190 }}>
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
        <div className="field" style={{ width: 180 }}>
          <label>Completion deadline</label>
          <input
            className="input"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            onBlur={() => startTransition(() => setStageDeadline(stage.id, deadline))}
          />
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
      {!isFirst && (
        <>
          <div
            style={{
              marginTop: -4,
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
              <input type="checkbox" checked={enabled} onChange={(e) => commitCarry(e.target.checked, pct)} /> Carry forward
              points from previous stage
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={pct}
              disabled={!enabled}
              onChange={(e) => commitCarry(enabled, parseInt(e.target.value, 10))}
              style={{ flex: 1, minWidth: 120 }}
            />
            <span className="tag tag-accent" style={{ minWidth: 48, textAlign: "center" }}>{pct}%</span>
          </div>
          <p className="text-muted" style={{ fontSize: 12, margin: "0 0 0 2px" }}>
            {enabled
              ? `At ${pct}%, a player on 12 pts from the previous stage starts this stage with ${(12 * pct) / 100} pts.`
              : "Disabled — every player starts this stage at zero."}
          </p>
        </>
      )}
    </>
  );
}

export function StagesClient({
  stages,
  rrMatchesPerPlayer,
}: {
  stages: StageView[];
  rrMatchesPerPlayer: number;
}) {
  const [newType, setNewType] = useState(STAGE_TYPES[0]);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {stages.map((s, i) => (
        <StageCard key={s.id} stage={s} isFirst={i === 0} rrMatchesPerPlayer={rrMatchesPerPlayer} />
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
