"use client";
import { useState } from "react";
import { ScoreImport } from "./ScoreImport";
import { ClearScores } from "./ClearScores";
import { ScoreEntryClient, type EntryMatch } from "@/components/ScoreEntryClient";
import { StrokePlayEntry } from "@/components/StrokePlayEntry";

export interface EntryRound {
  stageId: string;
  label: string;
  /** The round's format. Decides which ways a match may be written down. */
  format: string;
  matches: EntryMatch[];
  netMode: boolean;
  stroke: {
    holes: number;
    stageId: string;
    cardsByPlayer: Record<string, (number | null)[]>;
  };
}

export function EntryModes({
  rounds,
  activeIndex,
  players,
  pars,
  yards,
  strokeIndex,
  isStaff,
  defaultMode = "match",
  courseKnown = true,
  isAdmin = false,
  venues = [],
}: {
  rounds: EntryRound[];
  activeIndex: number;
  players: Array<{ id: string; name: string; handicap: number }>;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  isStaff: boolean;
  defaultMode?: "match" | "stroke";
  /** Whether real par/stroke-index data backs this event. */
  courseKnown?: boolean;
  /** Organizer, not assistant — gates the Reopen control. */
  isAdmin?: boolean;
  /** Courses this tournament may be played on. */
  venues?: Array<{ id: string; name: string }>;
}) {
  const [mode, setMode] = useState<"match" | "stroke">(defaultMode);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [roundIdx, setRoundIdx] = useState(activeIndex);
  const round = rounds[roundIdx] ?? rounds[0];

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div className="page-kicker">Manage</div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Score entry</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {rounds.length > 1 && (
              <select
                className="input"
                style={{ width: "auto" }}
                value={roundIdx}
                onChange={(e) => setRoundIdx(parseInt(e.target.value, 10))}
              >
                {rounds.map((r, i) => (
                  <option key={r.stageId} value={i}>{r.label}</option>
                ))}
              </select>
            )}
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
            {isStaff && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setImporting((v) => !v)}
                title="Bring in a whole round from a spreadsheet"
              >
                <i className="ph ph-upload-simple" /> {importing ? "Close import" : "Import scores"}
              </button>
            )}
            {isStaff && !clearing && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setClearing(true)}
                title="Remove this round's scores without touching the draw"
              >
                <i className="ph ph-eraser" /> Clear scores
              </button>
            )}
          </div>
        </div>
      </div>

      {clearing && isStaff && (
        <div style={{ marginBottom: 16 }}>
          <ClearScores
            key={round.stageId}
            stageId={round.stageId}
            roundLabel={round.label}
            players={players.map((p) => ({ id: p.id, name: p.name }))}
            onClose={() => setClearing(false)}
          />
        </div>
      )}

      {importing && isStaff && (
        <div style={{ marginBottom: 16 }}>
          <ScoreImport
            stageId={round.stageId}
            format={round.format}
            holes={round.stroke.holes}
            field={players.map((p) => ({ id: p.id, name: p.name }))}
            onDone={() => setImporting(false)}
          />
        </div>
      )}

      {mode === "match" ? (
        <ScoreEntryClient
          key={round.stageId}
          matches={round.matches}
          format={round.format}
          isStaff={isStaff}
          hideHeader
          pars={pars}
          yards={yards}
          strokeIndex={strokeIndex}
          netMode={round.netMode}
          courseKnown={courseKnown}
          isAdmin={isAdmin}
          venues={venues}
        />
      ) : (
        <StrokePlayEntry
          key={round.stageId}
          players={players}
          pars={pars}
          yards={yards}
          strokeIndex={strokeIndex}
          holes={round.stroke.holes}
          stageId={round.stroke.stageId}
          cardsByPlayer={round.stroke.cardsByPlayer}
        />
      )}
    </>
  );
}
