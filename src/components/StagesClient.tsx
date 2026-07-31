"use client";
import { useState, useTransition } from "react";
import { setStageDeadline, setStageCarry } from "@/app/actions/tournament";

export interface StageView {
  id: string;
  position: number;
  type: string;
  description: string;
  deadline: string;
  carryEnabled: boolean;
  carryPct: number;
}

const ICONS: Record<string, string> = {
  "Round Robin": "ph ph-arrows-clockwise",
  "Qualification Stage": "ph ph-flag-checkered",
  "Single Match Stage": "ph ph-sword",
  "Bracket Stage": "ph ph-tree-structure",
};

function StageCard({ stage }: { stage: StageView }) {
  const [deadline, setDeadline] = useState(stage.deadline);
  const [enabled, setEnabled] = useState(stage.carryEnabled);
  const [pct, setPct] = useState(stage.carryPct);
  const [, startTransition] = useTransition();
  const isFirst = stage.position === 0;

  const commitCarry = (nextEnabled: boolean, nextPct: number) => {
    setEnabled(nextEnabled);
    setPct(nextPct);
    startTransition(() => setStageCarry(stage.id, nextEnabled, nextPct));
  };

  return (
    <>
      <div className="card elev-sm" style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 16 }}>
              Stage {stage.position + 1} · {stage.type}
            </span>
            <span className="tag tag-neutral">{isFirst ? "Active" : "Upcoming"}</span>
          </div>
          <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>{stage.description}</div>
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>Completion deadline</label>
          <input
            className="input"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            onBlur={() => startTransition(() => setStageDeadline(stage.id, deadline))}
          />
        </div>
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
              background: "var(--color-bg)",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
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
              style={{ flex: 1 }}
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

export function StagesClient({ stages }: { stages: StageView[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {stages.map((s) => (
        <StageCard key={s.id} stage={s} />
      ))}
    </div>
  );
}
