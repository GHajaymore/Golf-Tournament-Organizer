"use client";
import { useState } from "react";
import { ScoreImport } from "./ScoreImport";
import { ClearScores } from "./ClearScores";
import { ScoreEntryClient, type EntryMatch } from "@/components/ScoreEntryClient";
import { StrokePlayEntry } from "@/components/StrokePlayEntry";
import type { CardBrand } from "@/components/ScorecardTable";
import { RoundApproval } from "@/components/RoundApproval";
import { RoundVenue } from "@/components/RoundVenue";
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
  /** The committee's override for how this round's scores are recorded, or ""
   *  to take the input its format declares. */
  scoreInput: string;
  /** gross | net | both | stableford — how this round is won, and so which
   *  totals its card reports. */
  scoringBasis: string;
  /**
   * The venue for this round, when one is set on the round itself. "" means it
   * inherits — the tournament's sole venue, then the event's own course.
   */
  courseId: string;
  /**
   * The card this round will actually be scored against, and whether that
   * card exists.
   *
   * Resolved on the server, where the whole chain is visible: the match's
   * venue, then the round's, then the tournament's, then the event. A screen
   * that worked it out again from `courseId` would be a second reader of the
   * same rule, and the two would disagree the first time the chain changed.
   */
  venue: { name: string; courseId: string; hasCard: boolean } | null;
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
  brand,
  venueIsHome = false,
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
  /** The club's mark, for the head of the stroke card. */
  brand?: CardBrand | null;
  /** Whether this tournament is played on the club's own course. Decides
   *  whether the club's mark heads the card or the course does. */
  venueIsHome?: boolean;
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
            {/**
              * How the scores are TYPED IN, which is not what the round is.
              *
              * These said "Match play" and "Stroke play", which are the names
              * of two formats — so on a Match Play round the screen appeared
              * to offer changing it to Stroke Play, and on a Stroke Play round
              * the same control looked like it was already wrong. It changes
              * neither: it picks which screen you enter on, it is per round,
              * it lives in the browser, and it writes nothing.
              *
              * Named after what each one asks you for instead. A round's real
              * format is stated beside it, so the two can never be confused
              * for one another again.
              */}
            <div className="seg" role="radiogroup" aria-label="How to enter the scores">
              <label className="seg-opt">
                <input type="radio" name="entrytop" checked={mode === "match"} onChange={() => setMode("match")} />
                Match by match
              </label>
              <label className="seg-opt">
                <input type="radio" name="entrytop" checked={mode === "stroke"} onChange={() => setMode("stroke")} />
                Whole field
              </label>
            </div>
            {(courseName || eventDates) && (
              <span className="text-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                <i className="ph ph-map-pin" style={{ marginRight: 4 }} />
                {/* The round's real format leads, because the control above
                    used to be the only thing on this screen naming a format
                    and it was naming the wrong one. */}
                {[round?.format, courseName, eventDates].filter(Boolean).join(" · ")}
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

      {/* Where this round was played, and its card if the venue has none.
          Stroke mode only: match play asks the same question per match, one
          screen down, because two members of a league really do play their
          match wherever suits them. Two pickers for one answer is worse than
          none. */}
      {mode === "stroke" && (
        <RoundVenue
          /* `venue-` prefixed, NOT the bare stage id.
             ScoreEntryClient and StrokePlayEntry are siblings of this in the
             same fragment and are already keyed on the stage id. Two siblings
             sharing a key is undefined, and what React actually did was leave
             the previous instance mounted: switching rounds stacked one more
             copy of this card each time, so a three-round tournament showed
             three identical "no card yet" warnings. */
          key={`venue-${round.stageId}`}
          stageId={round.stroke.stageId}
          courseId={round.courseId}
          venues={venues}
          library={courseLibrary}
          venue={round.venue}
          canEdit={isStaff}
        />
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
          scoreInput={round.scoreInput}
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
          brand={brand}
          scoringBasis={round.scoringBasis}
          format={round.format}
          courseName={round.venue?.name || courseName}
          venueIsHome={venueIsHome}
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
