"use client";
import { useMemo, useState } from "react";
import { formGroups, type FormationRule, type Player } from "@/lib/domain";

const ALGORITHMS: Array<{ key: FormationRule; label: string; icon: string; desc: string }> = [
  { key: "random", label: "Random", icon: "ph ph-shuffle", desc: "Completely random groups — shuffle and deal." },
  { key: "handicap", label: "Balanced handicap", icon: "ph ph-chart-bar", desc: "Spread handicaps so each group has a comparable mix." },
  { key: "balanced", label: "Balanced skill", icon: "ph ph-scales", desc: "Combine handicap and ranking so group strengths are even." },
  { key: "seeding", label: "Seeded", icon: "ph ph-list-numbers", desc: "Pair by tournament seed/ranking." },
];

const avg = (nums: number[]) =>
  nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0;

export function FoursomeMaker({ players }: { players: Player[] }) {
  const [algo, setAlgo] = useState<FormationRule>("random");
  const [size, setSize] = useState(4);
  const [seed, setSeed] = useState(1);

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const rng = useMemo(() => {
    let s = seed || 1;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }, [seed]);

  const groups = useMemo(
    () => formGroups(players, algo, { mode: "perFlight", value: size }, (i) => `fs-${i}`, rng),
    [players, algo, size, rng],
  );

  // Composition summary, e.g. "7 foursomes · 1 twosome".
  const sizes = groups.map((g) => g.playerIds.length);
  const counts = sizes.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  const sizeName: Record<number, string> = { 2: "twosome", 3: "threesome", 4: "foursome" };
  const summary = Object.entries(counts)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([s, n]) => `${n} ${sizeName[Number(s)] ?? `${s}-ball`}${n > 1 ? "s" : ""}`)
    .join(" · ");

  const active = ALGORITHMS.find((a) => a.key === algo) ?? ALGORITHMS[0];

  return (
    <>
      <div className="card elev-sm" style={{ marginBottom: 16, gap: 14 }}>
        <div>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Pairing algorithm</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ALGORITHMS.map((a) => {
              const on = a.key === algo;
              return (
                <button key={a.key} type="button" onClick={() => setAlgo(a.key)} className="btn" style={{ border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`, color: on ? "var(--color-accent)" : "var(--color-text)" }}>
                  <i className={a.icon} /> {a.label}
                </button>
              );
            })}
          </div>
          <p className="text-muted" style={{ fontSize: 12, margin: "10px 0 0" }}>{active.desc}</p>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ width: 200 }}>
            <label>Group size</label>
            <div className="seg" style={{ width: "100%" }}>
              {[2, 3, 4].map((n) => (
                <label className="seg-opt" key={n} style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="fssize" checked={size === n} onChange={() => setSize(n)} />{n}
                </label>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <span className="text-muted" style={{ fontSize: 12 }}>{groups.length} groups · {summary}</span>
          {algo === "random" && (
            <button type="button" className="btn btn-primary" onClick={() => setSeed((s) => s + 1)}>
              <i className="ph ph-shuffle" /> Reshuffle
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            <i className="ph ph-printer" /> Print
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {groups.map((g, i) => {
          const gp = g.playerIds.map((id) => byId.get(id)!).filter(Boolean);
          return (
            <div key={g.id} className="card elev-sm" style={{ gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Group {i + 1}</span>
                <span className="text-muted" style={{ fontSize: 11 }}>avg {avg(gp.map((p) => p.handicap))}</span>
              </div>
              {gp.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0", borderBottom: "1px solid var(--color-divider)" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{p.handicap}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
