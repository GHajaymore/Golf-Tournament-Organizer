"use client";
import { useState } from "react";

interface RRMatch {
  a: string;
  b: string;
  status: string;
  tagClass: string;
}
interface RRGroup {
  id: string;
  name: string;
  rounds: Array<{ n: number; matches: RRMatch[] }>;
}

export function RoundRobinClient({ groups }: { groups: RRGroup[] }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const group = groups.find((g) => g.id === groupId) ?? groups[0];

  return (
    <div className="card elev-sm">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="card-title">Schedule preview — Group {group?.name ?? "—"}</span>
        <select className="input" style={{ width: "auto" }} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              Group {g.name}
            </option>
          ))}
        </select>
      </div>
      {group?.rounds.map((rd) => (
        <div key={rd.n} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-neutral-400)", marginBottom: 4 }}>
            Round {rd.n}
          </div>
          {rd.matches.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 13,
                padding: "7px 10px",
                background: "var(--color-bg)",
                borderRadius: 6,
                marginBottom: 5,
              }}
            >
              <span style={{ flex: 1 }}>{m.a}</span>
              <span className="text-muted" style={{ fontSize: 11, padding: "0 10px" }}>vs</span>
              <span style={{ flex: 1, textAlign: "right" }}>{m.b}</span>
              <span className={`tag ${m.tagClass}`} style={{ marginLeft: 10 }}>{m.status}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
