"use client";
import { useState } from "react";
import { ScoreImport } from "./ScoreImport";
import { ClearScores } from "./ClearScores";
import { ScoreEntryClient, type EntryMatch } from "@/components/ScoreEntryClient";
import { StrokePlayEntry } from "@/components/StrokePlayEntry";
import { RoundApproval } from "@/components/RoundApproval";
import { VoiceAsk } from "./VoiceAsk";
import { entryModeFor } from "@/lib/formats";
import type { VoiceContext } from "@/lib/domain/voice-query";
import type { VenueCourse } from "./VenuePrompt";

export interface EntryRound {
  stageId: string;
  label: string;
  /** The round's format. Decides which ways a match may be written down. */
  format: string;
  /** Whether the scheduler draws pairings for this round's type. False for a
   *  medal round, which is entered as cards and never has matches. */
  drawsPairings: boolean;
  matches: EntryMatch[];
  netMode: boolean;
  stroke: {
    holes: number;
    stageId: string;
    cardsByPlayer: Record<string, (number | null)[]>;
    /** Where each returned card sits between "entered" and "approved". */
    cardStatus: Record<string, string>;
    /** This round's tee sheet — who shares a card. Empty if none is drawn. */
    teeGroups: Array<{ name: string; time: string; playerIds: string[] }>;
    /** Handicap strokes per hole, per player, allocated on the server so the
     *  dots on the card agree with how the round is actually scored. */
    shotsByPlayer: Record<string, number[]>;
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
  courseName = "",
  eventDates = "",
  voice,
  openCourse = false,
  courseLibrary = [],
  cardScanAvailable = true,
}: {
  rounds: EntryRound[];
  activeIndex: number;
  /** False when this club's plan doesn't include reading a card from a photo.
   *  Passed down so the control renders locked rather than disappearing —
   *  a feature nobody can see is a feature nobody asks for. */
  cardScanAvailable?: boolean;
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
  /** Where and when — a scorecard without its course and date is a page of
   *  numbers with no provenance, and it's the first thing a committee checks
   *  when a card is queried. */
  courseName?: string;
  eventDates?: string;
  /** Present only for someone playing in this tournament — an organizer
   *  entering the field's cards has no handicap or opponent to ask about. */
  voice?: VoiceContext;
  /** True when the tournament has no fixed venue and each match names its own. */
  openCourse?: boolean;
  /** This club's saved courses, offered before anyone types a card by hand. */
  courseLibrary?: VenueCourse[];
}) {
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [roundIdx, setRoundIdx] = useState(activeIndex);
  const round = rounds[roundIdx] ?? rounds[0];

  // Per round, not once for the screen.
  //
  // The mode was set from the active round at mount and then never revisited,
  // so switching the dropdown to a medal round left match entry on screen —
  // and match entry for a round the scheduler draws no pairings for says "No
  // matches yet: generate flights", which is a dead end. The organizer's own
  // choice still wins, but it wins for the round they made it on.
  const [modeByRound, setModeByRound] = useState<Record<number, "match" | "stroke">>({});
  const naturalMode: "match" | "stroke" = !round
    ? defaultMode
    : !round.drawsPairings
      ? "stroke"
      : entryModeFor(round.format) === "stroke"
        ? "stroke"
        : "match";
  const mode = modeByRound[roundIdx] ?? naturalMode;
  const setMode = (m: "match" | "stroke") => setModeByRound((prev) => ({ ...prev, [roundIdx]: m }));

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
            {(courseName || eventDates) && (
              <span className="text-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                <i className="ph ph-map-pin" style={{ marginRight: 4 }} />
                {[courseName, eventDates].filter(Boolean).join(" · ")}
              </span>
            )}
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

      {/* Before the cards, not buried under them: the questions this answers
          are the ones asked walking to the tee, not after the round. */}
      {voice && (
        <div className="card elev-sm" style={{ marginBottom: 16 }}>
          <VoiceAsk context={{ ...voice, currentRound: roundIdx + 1 }} />
        </div>
      )}

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
          openCourse={openCourse}
          courseLibrary={courseLibrary}
        />
      ) : (
        <StrokePlayEntry
          key={round.stageId}
          cardScanAvailable={cardScanAvailable}
          players={players}
          pars={pars}
          yards={yards}
          strokeIndex={strokeIndex}
          holes={round.stroke.holes}
          stageId={round.stroke.stageId}
          cardsByPlayer={round.stroke.cardsByPlayer}
          cardStatus={round.stroke.cardStatus}
          teeGroups={round.stroke.teeGroups}
          shotsByPlayer={round.stroke.shotsByPlayer}
        />
      )}

      {/* The committee's step, staff only. Sits under entry because that is
          where the cards are, and because approving is the thing you do once
          the group in front of you has finished. */}
      {mode === "stroke" && isStaff && (
        <RoundApproval
          stageId={round.stroke.stageId}
          isAdmin={isAdmin}
          cards={Object.entries(round.stroke.cardsByPlayer).map(([playerId, strokes]) => ({
            id: playerId,
            playerId,
            playerName: players.find((p) => p.id === playerId)?.name ?? "Unknown player",
            status: round.stroke.cardStatus[playerId] ?? "entered",
            strokes,
            holes: round.stroke.holes,
          }))}
        />
      )}
    </>
  );
}
