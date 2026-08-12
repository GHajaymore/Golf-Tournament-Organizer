"use client";
import { useMemo, useState, useTransition } from "react";
import { regenGroups } from "@/app/actions/tournament";
import { formGroups, flightCountFor, type FormationRule, type Player } from "@/lib/domain";

const RULES: Array<{ key: FormationRule; label: string; icon: string; desc: string }> = [
  {
    key: "balanced",
    label: "Balanced skills",
    icon: "ph ph-scales",
    desc: "Combines handicap and ranking to make each flight's total strength as even as possible — the most competitively balanced flights.",
  },
  {
    key: "handicap",
    label: "By handicap",
    icon: "ph ph-chart-bar",
    desc: "Snake-drafts strictly by handicap, so every flight holds a comparable spread of low to high handicaps.",
  },
  {
    key: "seeding",
    label: "By seeding",
    icon: "ph ph-list-numbers",
    desc: "Distributes by tournament seed/ranking (1, 8, 9, 16…) so top seeds are spread across flights, not clumped together.",
  },
  {
    key: "random",
    label: "Random",
    icon: "ph ph-shuffle",
    desc: "Shuffles the whole field and deals players evenly across the flights.",
  },
  {
    key: "manual",
    label: "Manual",
    icon: "ph ph-hand-pointing",
    desc: "Chunks the roster in order, then lets you drag players between flights below — or move them from the menu on each row.",
  },
];

// Small deterministic RNG so the "random" preview stays stable between renders.
function seededRng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const avg = (nums: number[]) =>
  nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0;

export function GroupingControls({
  players,
  currentRule,
  currentMode,
  currentValue,
  locked = false,
}: {
  players: Player[];
  currentRule: FormationRule;
  currentMode: "auto" | "count" | "perFlight";
  currentValue: number;
  /** Setup is frozen (live/completed and not unlocked). The action refuses
   *  anyway; disabling here stops that refusal reaching the user as a crash. */
  locked?: boolean;
}) {
  const [rule, setRule] = useState<FormationRule>(currentRule);
  const [mode, setMode] = useState<"auto" | "count" | "perFlight">(currentMode);
  const [value, setValue] = useState<number>(currentValue || (currentMode === "perFlight" ? 4 : 8));
  const [pending, startTransition] = useTransition();
  /** Number of scored matches a regenerate would destroy, once refused. */
  const [confirmScored, setConfirmScored] = useState<number | null>(null);
  /** A refusal from the action. Shown rather than swallowed — the action used
   *  to rewrite an unrecognised rule to "balanced" and return ok, which is how
   *  a draw could come back under a rule nobody picked. */
  const [error, setError] = useState("");

  const config = { mode, value: value || undefined };
  const flightCount = flightCountFor(players.length, config);
  const active = RULES.find((r) => r.key === rule) ?? RULES[0];

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const preview = useMemo(
    () => formGroups(players, rule, config, (i) => `preview-${i}`, seededRng(7)),
    [players, rule, mode, value], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="card elev-sm" style={{ marginBottom: 16, gap: 14 }}>
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
        <p className="text-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>{active.desc}</p>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Flight size</label>
          <div className="seg">
            <label className="seg-opt"><input type="radio" name="fmode" checked={mode === "auto"} onChange={() => setMode("auto")} />Auto</label>
            <label className="seg-opt"><input type="radio" name="fmode" checked={mode === "count"} onChange={() => setMode("count")} />Set flights</label>
            <label className="seg-opt"><input type="radio" name="fmode" checked={mode === "perFlight"} onChange={() => setMode("perFlight")} />Players / flight</label>
          </div>
        </div>
        {mode !== "auto" && (
          <div className="field" style={{ width: 140 }}>
            <label>{mode === "count" ? "Number of flights" : "Players per flight"}</label>
            <input
              className="input"
              type="number"
              min={mode === "count" ? 1 : 2}
              value={value}
              onChange={(e) => setValue(parseInt(e.target.value, 10) || 0)}
            />
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {flightCount} flights · {players.length} players
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || players.length === 0 || locked}
            title={locked ? "Configuration is locked. Unlock the tournament to regenerate flights." : undefined}
            onClick={() =>
              startTransition(async () => {
                setError("");
                const res = await regenGroups(rule, mode, value);
                // Refused because rebuilding would throw away real results —
                // surface what's at stake instead of failing silently.
                if (res.needsConfirm) setConfirmScored(res.scoredMatches ?? 0);
                else if (!res.ok) setError(res.error ?? "Couldn't generate flights.");
              })
            }
          >
            <i className="ph ph-shuffle" /> {pending ? "Generating…" : "Generate flights"}
          </button>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 12.5, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      {confirmScored !== null && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-danger)",
            background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 13 }}>
            <b>
              <i className="ph ph-warning" /> This will delete {confirmScored} scored match
              {confirmScored === 1 ? "" : "es"}.
            </b>
            <div className="text-muted" style={{ marginTop: 4 }}>
              Regenerating flights rebuilds the whole round-robin schedule, so results already entered for
              this round are discarded and can&rsquo;t be recovered.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await regenGroups(rule, mode, value, true);
                  setConfirmScored(null);
                  if (!res.ok) setError(res.error ?? "Couldn't generate flights.");
                })
              }
            >
              Delete {confirmScored} match{confirmScored === 1 ? "" : "es"} and regenerate
            </button>
            <button type="button" className="btn" disabled={pending} onClick={() => setConfirmScored(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span className="card-kicker">Preview</span>
          <span className="text-muted" style={{ fontSize: 12 }}>What “Generate flights” will produce</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
          {preview.map((g, i) => {
            const flightPlayers = g.playerIds.map((id) => byId.get(id)!).filter(Boolean);
            return (
              <div key={g.id} style={{ border: "1px solid var(--color-divider)", borderRadius: "var(--radius-md)", padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Flight {i + 1}</span>
                  <span className="text-muted" style={{ fontSize: 11 }}>avg {avg(flightPlayers.map((p) => p.handicap))}</span>
                </div>
                {flightPlayers.map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{p.handicap}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
        Generating rebuilds the round-robin schedule and clears any entered round-robin scores.
      </p>
    </div>
  );
}
