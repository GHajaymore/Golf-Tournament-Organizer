"use client";
import { useState, useTransition } from "react";
import { regenGroups } from "@/app/actions/tournament";
import type { FormationRule } from "@/lib/domain";

const RULES: Array<{ key: FormationRule; label: string; icon: string; desc: string }> = [
  {
    key: "balanced",
    label: "Balanced skill",
    icon: "ph ph-scales",
    desc: "Sort by handicap, then snake-draft across groups so each group holds a comparable spread of abilities.",
  },
  {
    key: "handicap",
    label: "By handicap",
    icon: "ph ph-chart-bar",
    desc: "Snake-draft strictly by handicap — the fairest spread of low and high handicaps per group.",
  },
  {
    key: "seeding",
    label: "By seeding",
    icon: "ph ph-list-numbers",
    desc: "Snake-draft by seed/ranking instead of handicap, for events seeded from prior results.",
  },
  {
    key: "manual",
    label: "Manual",
    icon: "ph ph-hand-pointing",
    desc: "Groups follow roster order; reassign players by hand (drag-and-drop reassignment in a future release).",
  },
];

export function GroupingControls({
  currentRule,
  groupCount,
  playerCount,
}: {
  currentRule: FormationRule;
  groupCount: number;
  playerCount: number;
}) {
  const [rule, setRule] = useState<FormationRule>(currentRule);
  const [pending, startTransition] = useTransition();
  const active = RULES.find((r) => r.key === rule) ?? RULES[0];

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Formation rule</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {RULES.map((r) => {
              const on = r.key === rule;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRule(r.key)}
                  className="btn"
                  style={{
                    border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`,
                    color: on ? "var(--color-accent)" : "var(--color-text)",
                  }}
                >
                  <i className={r.icon} /> {r.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {groupCount} groups · {playerCount} players
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => startTransition(() => regenGroups(rule))}
          >
            <i className="ph ph-shuffle" /> {pending ? "Generating…" : "Generate groups"}
          </button>
        </div>
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: "12px 0 0" }}>{active.desc}</p>
      <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
        Generating rebuilds the round-robin schedule and clears any entered round-robin scores.
      </p>
    </div>
  );
}
