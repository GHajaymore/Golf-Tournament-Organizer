"use client";
import { useMemo, useState, useTransition } from "react";
import { computeStrokeCard, toParText } from "@/lib/domain";
import { saveScorecard } from "@/app/actions/tournament";

interface StrokePlayer {
  id: string;
  name: string;
  handicap: number;
}

export function StrokePlayEntry({
  players,
  pars,
  holes,
  stageId,
  cardsByPlayer,
}: {
  players: StrokePlayer[];
  pars: number[];
  holes: number;
  stageId: string;
  cardsByPlayer: Record<string, (number | null)[]>;
}) {
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [cards, setCards] = useState<Record<string, (number | null)[]>>(() => {
    const init: Record<string, (number | null)[]> = {};
    for (const p of players) init[p.id] = cardsByPlayer[p.id] ?? new Array(holes).fill(null);
    return init;
  });
  const [pending, startTransition] = useTransition();

  const player = players.find((p) => p.id === playerId);
  const strokes = cards[playerId] ?? new Array(holes).fill(null);
  const card = useMemo(
    () => computeStrokeCard(strokes, pars, player?.handicap ?? 0),
    [strokes, pars, player],
  );
  const parTotal = pars.slice(0, holes).reduce((a, b) => a + b, 0);

  const setHole = (i: number, val: string) => {
    const n = parseInt(val, 10);
    const next = [...strokes];
    next[i] = Number.isFinite(n) && n > 0 ? n : null;
    setCards((prev) => ({ ...prev, [playerId]: next }));
  };
  const save = () => startTransition(() => saveScorecard(stageId, playerId, strokes));

  if (!player) {
    return <div className="card elev-sm"><span className="text-muted" style={{ fontSize: 13 }}>No players yet.</span></div>;
  }

  const holeIdx = Array.from({ length: holes }, (_, i) => i);

  return (
    <div className="card elev-sm">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Player</label>
          <select className="input" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.name} (hcp {p.handicap})</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 18, textAlign: "center" }}>
          <div><div className="card-kicker">Gross</div><div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{card.gross || "—"}</div></div>
          <div><div className="card-kicker">Net</div><div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{card.played ? card.net : "—"}</div></div>
          <div><div className="card-kicker">To par</div><div style={{ fontFamily: "var(--font-heading)", fontSize: 22, color: "var(--color-accent-200)" }}>{card.played ? toParText(card.toPar) : "—"}</div></div>
        </div>
      </div>

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table className="table" style={{ fontSize: 12, minWidth: 640 }}>
          <thead>
            <tr>
              <th>Hole</th>
              {holeIdx.map((i) => (<th key={i} style={{ textAlign: "center" }}>{i + 1}</th>))}
              <th style={{ textAlign: "center" }}>Tot</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-muted">Par</td>
              {holeIdx.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-400)" }}>{pars[i] ?? "-"}</td>))}
              <td style={{ textAlign: "center", fontWeight: 600 }}>{parTotal}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 500 }}>Score</td>
              {holeIdx.map((i) => (
                <td key={i} style={{ textAlign: "center", padding: 2 }}>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={strokes[i] ?? ""}
                    onChange={(e) => setHole(i, e.target.value)}
                    style={{ width: 34, textAlign: "center", padding: "4px 2px", minHeight: 30 }}
                  />
                </td>
              ))}
              <td style={{ textAlign: "center", fontWeight: 600 }}>{card.gross || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--color-divider)", flexWrap: "wrap", gap: 8 }}>
        <span className="text-muted" style={{ fontSize: 12 }}>
          Front {card.front || "—"} · Back {card.back || "—"} · {card.played}/{holes} holes
        </span>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          <i className="ph ph-check" /> Save scorecard
        </button>
      </div>
    </div>
  );
}
