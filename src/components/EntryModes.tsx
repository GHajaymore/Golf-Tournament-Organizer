"use client";
import { useState } from "react";
import { ScoreEntryClient, type EntryMatch } from "@/components/ScoreEntryClient";
import { StrokePlayEntry } from "@/components/StrokePlayEntry";

interface StrokeData {
  players: Array<{ id: string; name: string; handicap: number }>;
  pars: number[];
  holes: number;
  stageId: string;
  cardsByPlayer: Record<string, (number | null)[]>;
}

export function EntryModes({
  matches,
  isStaff,
  stroke,
}: {
  matches: EntryMatch[];
  isStaff: boolean;
  stroke: StrokeData;
}) {
  const [mode, setMode] = useState<"match" | "stroke">("match");

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div className="page-kicker">Scoring</div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Score entry</h2>
          <div className="seg">
            <label className="seg-opt">
              <input type="radio" name="entrytop" checked={mode === "match"} onChange={() => setMode("match")} />
              Match play
            </label>
            <label className="seg-opt">
              <input type="radio" name="entrytop" checked={mode === "stroke"} onChange={() => setMode("stroke")} />
              Stroke play
            </label>
          </div>
        </div>
      </div>

      {mode === "match" ? (
        <ScoreEntryClient matches={matches} isStaff={isStaff} hideHeader />
      ) : (
        <StrokePlayEntry
          players={stroke.players}
          pars={stroke.pars}
          holes={stroke.holes}
          stageId={stroke.stageId}
          cardsByPlayer={stroke.cardsByPlayer}
        />
      )}
    </>
  );
}
