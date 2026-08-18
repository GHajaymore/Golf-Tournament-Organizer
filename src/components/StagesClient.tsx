"use client";
import React, { useState, useTransition } from "react";
import {
  setStageDeadline,
  setStageCarry,
  setStageScoringBasis,
  setStageFormat,
  setStageHoles,
  setStagePlayedOn,
  addStage,
  removeStage,
  generateNextRound,
} from "@/app/actions/tournament";
import { setStageCourse } from "@/app/actions/courses";
import { GOLF_FORMATS } from "@/lib/formats";
import { isTeamFormat } from "@/lib/side-style";
import { INTERVAL_OPTIONS, roundDates, shortDate } from "@/lib/domain/round-dates";
import FieldInfo from "@/components/FieldInfo";
import { CUT_SCOPE_HELP, ROUND_CUT_HELP, QUALIFICATION_CUT_HELP } from "@/lib/domain/cut";
import { chainIssues, issuesForRound, carryForwardPrompt, type CarryPrompt } from "@/lib/format-chain";
import {
  STAGE_TYPE_INFO,
  STAGE_TYPES,
  stageTypeInfo,
  generatesPairings,
  nextPlayingStage,
  MAX_ROUNDS_AT_ONCE,
  type StageTypeKey,
} from "@/lib/stage-types";
import { ScoringClient } from "./ScoringClient";
import { RoundTeamScoring, type RoundScoringInfo } from "./RoundTeamScoring";
import { MatchTiebreakControl } from "./MatchTiebreakControl";
import type { MatchTiebreakKey } from "@/lib/domain/match-tiebreak";
import { SingleMatchRulePicker } from "@/components/SingleMatchRulePicker";
import { ThirdPlaceControl } from "@/components/ThirdPlaceControl";
export interface ThirdPlaceView {
  on: boolean;
  problem: string;
  aName: string;
  bName: string;
  made: boolean;
}
import type { SingleMatchView } from "@/lib/services/single-match";
import { QualControl } from "./QualControl";
import { CutControl } from "./CutControl";
import { RoundDeadlineControl } from "./RoundDeadlineControl";
import { setStageOptDeadline } from "@/app/actions/attendance";
import type { TiebreakerKey } from "@/lib/domain";

export interface StageView {
  id: string;
  position: number;
  type: string;
  description: string;
  format: string;
  holes: number;
  /** ISO date this round is played, or "" for no fixed day. */
  playedOn: string;
  deadline: string;
  scoringBasis: string;
  carryEnabled: boolean;
  carryPct: number;
  /** Whether the organizer has answered the carry-forward question either way. */
  carryAsked: boolean;
  cutEnabled: boolean;
  cutMode: string;
  cutCount: number;
  cutPercent: number;
  /** overall | perFlight — whether the cut applies across the field or inside
   *  each flight. */
  cutScope: string;
  /** true = closed by hand, false = extended past the date, null = follow it. */
  deadlineOverride: boolean | null;
  /** Last day players may change their weekly in/out. "" = open. */
  optDeadline: string;
  /** Resolved sign-up counts for this round; null when the league question
   *  is switched off. */
  attendance: { in: number; out: number; inByDefault: number } | null;
  matchCount: number;
  /** Venue for this round; null means the tournament's own course. */
  courseId: string | null;
  /** full | front | back — which nine, when the round is 9 holes. */
  nine: string;
  /** How this round prices its sides, or null for an individual format. */
  teamScoring: RoundScoringInfo | null;
}

export interface ScoringValues {
  winPts: number;
  tiePts: number;
  lossPts: number;
  holeRatioPts: number;
  bonusPts: number;
  /** The most a player can take from one match. Zero is no limit. */
  maxPerMatch: number;
}

export interface QualValues {
  mode: string;
  perFlight: number;
  overall: number;
}


/** Rotating per-round accent so a page of several round cards reads as distinct at a glance. */
const ROUND_PALETTE = ["var(--color-accent)", "var(--color-accent-2)", "var(--color-accent-400)", "var(--color-accent-2-400)"];

const BASIS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "gross", label: "Gross" },
  { key: "net", label: "Net" },
  { key: "both", label: "Both" },
  { key: "stableford", label: "Stableford" },
];

/** Whether a stored deadline is something a date input can display. */
function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="card-kicker" style={{ display: "block" }}>{children}</span>;
}

/**
 * A titled group of settings inside a round.
 *
 * The settings panel had grown into a flat column of eight sections carrying
 * equal weight — when the round is played, what it decides, how ties break —
 * so an organizer looking for one of them had to read all of them. These are
 * different KINDS of decision, made at different times by different people:
 * the day and the scoring window are the day's admin, the per-type settings
 * are what the round is for, and the tiebreakers are rules set once and
 * rarely touched.
 *
 * Renders nothing at all when it has no children, so a stage type that has
 * no decisions of its own does not show an empty heading — the gating stays
 * on the sections themselves rather than being duplicated here.
 */
function SettingsGroup({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  const kids = React.Children.toArray(children).filter(Boolean);
  if (kids.length === 0) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h4
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.01em",
            color: "var(--color-text)",
          }}
        >
          {title}
        </h4>
        {blurb && (
          <p className="text-muted" style={{ fontSize: 11.5, margin: "3px 0 0", lineHeight: 1.5 }}>
            {blurb}
          </p>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          paddingLeft: 12,
          borderLeft: "2px solid var(--color-divider)",
        }}
      >
        {kids}
      </div>
    </section>
  );
}

/**
 * Configures what happens between this round and the next one — carry-forward
 * and the cut line — right from the round you're currently looking at. Both
 * controls are always live: if the next round doesn't exist yet, touching
 * either one creates it automatically (via ensureNextStageId) instead of
 * requiring a separate "Add round" step first. Keyed by the next stage's id
 * (or "none") so its local state re-syncs whenever a round gets added/removed.
 */
function NextRoundTransition({
  stageId,
  nextStage,
  confirmedCount,
  flightCount = 1,
  carry,
}: {
  /** The current round's id — where a newly-created next round gets appended after. */
  stageId: string;
  nextStage: StageView | undefined;
  confirmedCount: number;
  /** Number of flights, so a per-flight cut can say what it really advances. */
  flightCount?: number;
  /** Whether to put the carry-forward question in front of the organizer. */
  carry: CarryPrompt;
}) {
  const [carryEnabled, setCarryEnabled] = useState(nextStage?.carryEnabled ?? false);
  const [carryPct, setCarryPct] = useState(nextStage?.carryPct ?? 0);
  const [pending, startTransition] = useTransition();
  const [genPending, startGenTransition] = useTransition();

  // Resolves to the real next-round id, creating a Round Robin round first if
  // one doesn't exist yet — so the cut/carry controls work immediately.
  const ensureNextStageId = async (): Promise<string> => {
    if (nextStage) return nextStage.id;
    const id = await addStage("Round Robin");
    return id ?? stageId;
  };

  const commitCarry = (nextEnabled: boolean, nextPct: number) => {
    setCarryEnabled(nextEnabled);
    setCarryPct(nextPct);
    startTransition(async () => {
      const id = await ensureNextStageId();
      await setStageCarry(id, nextEnabled, nextPct);
    });
  };

  const roundLabel = nextStage ? `Round ${nextStage.position + 1}` : "the next round";
  // A stroke-play / medal next round draws no pairings — the field returns
  // cards — so it is "generated" by handing the survivors a card, not by
  // building matches. Before it exists, assume a Round Robin (what gets created).
  const nextDrawsPairings = nextStage ? generatesPairings(nextStage.type) : true;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Asked outright rather than left as an unchecked box. In a points
          league whether a strong round still counts is the central decision of
          the format, and nobody finds it by accident halfway down a panel. */}
      {carry.ask && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "12px 14px",
            borderRadius: 10,
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>{carry.question}</span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>{carry.detail}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => commitCarry(true, carryPct > 0 ? carryPct : 100)}
            >
              Yes, carry them forward
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => commitCarry(false, 0)}
            >
              No, each round starts fresh
            </button>
          </div>
        </div>
      )}

      {carry.inert ? (
        // Offering a switch that does nothing is worse than not offering it:
        // strokeStandings are built from the returned cards and never read the
        // carried total, so turning this on for a stroke round changes nothing.
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          {carry.detail}
        </p>
      ) : (
      <>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          {/* Ticking the box carries the whole total unless a share has
              already been chosen. It used to commit whatever the slider said,
              which on a round nobody had touched was 0 — so the switch read as
              on, the sentence underneath admitted "a player on 12 pts here
              starts Round 2 with 0 pts", and the organizer had turned on a
              feature that does nothing. The "Yes, carry them forward" answer
              directly above already defaults to 100 for the same reason. */}
          <input
            type="checkbox"
            checked={carryEnabled}
            onChange={(e) => commitCarry(e.target.checked, e.target.checked && carryPct === 0 ? 100 : carryPct)}
          />
          Carry forward points into {roundLabel}
          <FieldInfo label="carrying points forward">
            <p>
              At 100% a player takes their whole total into {roundLabel}, so a strong first round
              still counts at the end. At 50% it is halved — the lead narrows but does not vanish.
              At 0% every player starts level and the earlier round decides only who is still in.
            </p>
            <p>
              This only works between rounds measuring the same thing. Carrying match points into a
              stroke-play round produces a number that means nothing, and the app says so when the
              rounds don&rsquo;t line up.
            </p>
          </FieldInfo>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={carryPct}
          disabled={!carryEnabled}
          onChange={(e) => commitCarry(carryEnabled, parseInt(e.target.value, 10))}
          style={{ flex: 1, minWidth: 120 }}
        />
        <span className="tag tag-accent" style={{ minWidth: 48, textAlign: "center" }}>{carryPct}%</span>
      </div>
      <p className="text-muted" style={{ fontSize: 12, margin: "0 0 0 2px" }}>
        {carryEnabled
          ? `At ${carryPct}%, a player on 12 pts here starts ${roundLabel} with ${(12 * carryPct) / 100} pts.`
          : `Off — ${roundLabel} starts scoring from zero; no points carry over from this round.`}
      </p>
      </>
      )}

      <div style={{ borderTop: "1px solid var(--color-divider)", margin: "4px 0", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <CutControl
          formId={stageId}
          getStageId={ensureNextStageId}
          roundLabel={roundLabel}
          enabled={nextStage?.cutEnabled ?? false}
          mode={nextStage?.cutMode ?? "count"}
          count={nextStage?.cutCount ?? 16}
          percent={nextStage?.cutPercent ?? 50}
          scope={nextStage?.cutScope ?? "overall"}
          confirmedCount={confirmedCount}
          flightCount={flightCount}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={genPending}
            onClick={() =>
              startGenTransition(async () => {
                const id = await ensureNextStageId();
                await generateNextRound(id);
              })
            }
          >
            <i className="ph ph-arrows-clockwise" /> {nextStage?.matchCount ? "Regenerate" : "Generate"} {roundLabel}
            {nextDrawsPairings ? " pairings" : ""}
          </button>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {nextDrawsPairings
              ? nextStage?.cutEnabled
                ? `Builds ${roundLabel}'s matches from this round's current standings — run it once this round is complete.`
                : `Builds ${roundLabel}'s matches for the full field, from the current flights.`
              : nextStage?.cutEnabled
                ? `Gives each player who advances a card for ${roundLabel} — run it once this round is complete.`
                : `Gives every player a card for ${roundLabel}.`}
            {nextDrawsPairings && !!nextStage?.matchCount && " Re-running replaces that round's matches."}
          </span>
        </div>
        {nextDrawsPairings && nextStage && nextStage.matchCount === 0 && (
          <span className="tag tag-neutral" style={{ alignSelf: "flex-start" }}>
            <i className="ph ph-clock" /> {roundLabel} not generated yet
          </span>
        )}
      </div>
    </div>
  );
}

function StageCard({
  stage,
  isFirst,
  standing,
  nextStage,
  rrMatchesPerPlayer,
  scoring,
  tiebreakers,
  matchTiebreakers,
  qual,
  confirmedCount,
  flightCount,
  venues,
  chainWarnings,
  chainsRounds,
  expanded,
  onToggle,
  singleMatch,
  thirdPlace,
}: {
  stage: StageView;
  /** For a Single Match Stage: the rule, and who it currently resolves to. */
  singleMatch?: SingleMatchView | null;
  /** For a Bracket Stage: whether it plays off for third, and who would. */
  thirdPlace?: ThirdPlaceView | null;
  isFirst: boolean;
  /** Whether this round's configuration is open. */
  expanded: boolean;
  onToggle: () => void;
  /**
   * Where this round sits relative to the one being played.
   *
   * Was `isFirst ? "Active" : "Upcoming"`, which is only true on day one: once
   * Round 1 finished, this screen still called it Active and Round 2 Upcoming
   * while the dashboard, score entry and the leaderboard had all moved on. Two
   * screens disagreeing about which round is live is the kind of thing an
   * organizer resolves by trusting the wrong one.
   */
  standing: "played" | "active" | "upcoming";
  nextStage: StageView | undefined;
  rrMatchesPerPlayer: number;
  scoring: ScoringValues;
  tiebreakers: TiebreakerKey[];
  /** How an all-square match is decided, in order. */
  matchTiebreakers: MatchTiebreakKey[];
  qual: QualValues;
  confirmedCount: number;
  /** Flights the field is split into — decides what a per-flight cut advances. */
  flightCount: number;
  venues: Array<{ id: string; name: string }>;
  /** Ways this round doesn't fit the one before it. */
  chainWarnings: string[];
  /** False for a single-round tournament, which has no next round. */
  chainsRounds: boolean;
}) {
  const [deadline, setDeadline] = useState(stage.deadline);
  const [basis, setBasis] = useState(stage.scoringBasis);
  const [format, setFormat] = useState(stage.format);
  const [holes, setHoles] = useState(stage.holes);
  const [playedOn, setPlayedOn] = useState(stage.playedOn);
  const [courseId, setCourseId] = useState<string | null>(stage.courseId);
  // "full" is a real answer for a 9-hole round now ("not fixed"), so it has to
  // survive here. Collapsing anything-but-back to "front" silently discarded
  // the organizer's choice the moment the card re-rendered.
  const [nine, setNine] = useState(
    stage.nine === "back" || stage.nine === "full" ? stage.nine : "front",
  );
  // Carry-forward is the one setting an organizer can't afford to miss, and it
  // lives inside this panel — which is exactly the "unchecked box halfway down
  // a collapsed panel" the prompt exists to fix. Asking the question is no use
  // if the question is hidden, so an unanswered prompt opens the panel.
  const [customizeOpen, setCustomizeOpen] = useState(
    () =>
      carryForwardPrompt({
        chainsRounds,
        hasNextRound: !!nextStage,
        format: stage.format,
        scoringBasis: stage.scoringBasis,
        answered: nextStage?.carryAsked ?? false,
        locked: false,
      }).ask,
  );
  const [formatInfoOpen, setFormatInfoOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const commitFormat = (v: string) => {
    setFormat(v);
    startTransition(() => setStageFormat(stage.id, v));
  };
  const commitPlayedOn = (v: string) => {
    setPlayedOn(v);
    startTransition(() => setStagePlayedOn(stage.id, v));
  };

  const commitHoles = (v: number) => {
    setHoles(v);
    startTransition(() => setStageHoles(stage.id, v));
  };
  // Venue and nine travel together: the action takes both, and a round that
  // changes course usually needs its nine restated for the new card.
  const commitVenue = (nextCourse: string | null, nextNine: string) => {
    setCourseId(nextCourse);
    setNine(nextNine);
    startTransition(() => void setStageCourse(stage.id, nextCourse, holes === 9 ? nextNine : "full"));
  };
  const commitBasis = (next: string) => {
    setBasis(next);
    startTransition(() => setStageScoringBasis(stage.id, next));
  };

  const activeFormat = GOLF_FORMATS.find((f) => f.name === format);
  // Every format in the catalog is listed, but only those runnable end to end
  // can be picked. Showing the rest greyed out with the reason is deliberate:
  // hiding them entirely makes the app look like it can't do team golf, while
  // letting them be selected hands someone a round with nowhere to enter a
  // card. A round already set to something unselectable still shows it.
  const formatOptions: { name: string; disabled: boolean; note?: string }[] = [
    ...GOLF_FORMATS.filter((f) => f.playable || f.name === format).map((f) => ({
      name: f.name,
      disabled: false,
    })),
    ...GOLF_FORMATS.filter((f) => !f.playable && f.name !== format).map((f) => ({
      name: f.name,
      disabled: true,
      note: f.pendingReason,
    })),
  ];
  // A legacy label from before the catalog was restricted still needs to show.
  if (!GOLF_FORMATS.some((f) => f.name === format)) {
    formatOptions.unshift({ name: format, disabled: false });
  }
  const activePending = GOLF_FORMATS.find((f) => f.name === format && !f.playable);

  // Whether to put the carry-forward question in front of the organizer, and
  // whether the control can do anything at all for this round's scoring.
  const carryPrompt = carryForwardPrompt({
    chainsRounds,
    hasNextRound: !!nextStage,
    format,
    scoringBasis: basis,
    answered: nextStage?.carryAsked ?? false,
    locked: false,
  });

  // Round Robin description is derived (no hard-coded round count).
  const description =
    stage.type === "Round Robin"
      ? `Players compete against everyone in their flight — ${rrMatchesPerPlayer} ${rrMatchesPerPlayer === 1 ? "match" : "matches"} each.`
      : stage.description;

  // Carry-forward and the cut line describe what happens *into the next
  // round*. A single-round tournament has no next round, so offering them
  // asks an organizer to configure something that cannot happen — which is
  // what the shape question exists to stop.
  //
  // And only once the next round actually EXISTS. These controls used to
  // create one silently the moment either was touched, so an organizer
  // reading the options ended up with a round they never asked for — and a
  // round that then had to be found and deleted. A round is added
  // deliberately, from "Add round"; nothing here conjures one.
  const showTransition = stage.type === "Round Robin" && chainsRounds;
  const notGenerated = !isFirst && stage.type === "Round Robin" && stage.matchCount === 0;

  // One rich, always-legible summary line for the collapsed toggle — covers
  // every setting on this card (including what happens into the next round),
  // so there's a single place to both see and change everything, and nothing
  // is invisible just because it hasn't been customized yet.
  const transitionParts: string[] = [];
  if (nextStage?.carryEnabled) transitionParts.push(`carries ${nextStage.carryPct}%`);
  if (nextStage?.cutEnabled) {
    transitionParts.push(nextStage.cutMode === "percent" ? `cuts to top ${nextStage.cutPercent}%` : `cuts to top ${nextStage.cutCount}`);
  }
  const summaryParts: string[] = [];
  if (deadline) summaryParts.push(`Due ${deadline}`);
  if (basis !== "gross") {
    summaryParts.push(basis === "net" ? "Net scoring" : basis === "stableford" ? "Stableford" : "Gross + net");
  }
  if (stage.type === "Qualification Stage") {
    summaryParts.push(qual.mode === "overall" ? `Top ${qual.overall} overall` : `Top ${qual.perFlight} per flight`);
  }
  if (showTransition) {
    summaryParts.push(
      nextStage
        ? `Into Round ${nextStage.position + 1}: ${transitionParts.length ? transitionParts.join(" · ") : "no cut or carry-forward"}`
        : "No round after this yet",
    );
  }
  const summaryLine = summaryParts.length ? summaryParts.join(" · ") : "Standard settings";

  // A rotating accent per round so a page of several rounds is scannable at a
  // glance instead of every card reading identically — the round number does
  // the differentiating (not the type icon, which repeats for every
  // Round Robin stage anyway).
  const roundColor = ROUND_PALETTE[stage.position % ROUND_PALETTE.length];

  return (
    <div className="card elev-sm" style={{ gap: 14, borderLeft: `3px solid ${roundColor}` }}>
      {chainWarnings.length > 0 && (
        // Shown on the later round of the pair, because that is where the
        // carry-forward or cut setting causing it actually lives. Advisory
        // rather than blocking: plenty of real tournaments do deliberately odd
        // things, and an organizer who understands the trade shouldn't be
        // stopped by an app that doesn't.
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "10px 12px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <i className="ph ph-warning" />
            {chainWarnings.length === 1 ? "Check this round follows on" : "Check how this round follows on"}
          </span>
          {chainWarnings.map((w, i) => (
            <p key={i} className="text-muted" style={{ fontSize: 12, margin: 0 }}>{w}</p>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div
          style={{
            width: 44,
            height: 44,
            flex: "none",
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: `color-mix(in srgb, ${roundColor} 18%, transparent)`,
            color: roundColor,
            fontFamily: "var(--font-heading)",
            fontWeight: 700,
            fontSize: 19,
          }}
          title={stage.type}
        >
          {stage.position + 1}
        </div>
        {/* The whole card in one line when it is closed. A ten-week league
            used to render ten copies of every control on this screen — about
            six hundred lines of form — and adding a run of weeks in one click
            made that far worse. Closed, a round is a row you can scan; open,
            it is everything it always was. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          style={{
            flex: 1,
            minWidth: 160,
            textAlign: "left",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--color-text)",
            font: "inherit",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 16 }}>
              Round {stage.position + 1}
              {stage.playedOn ? ` · ${shortDate(stage.playedOn)}` : ` · ${stage.type}`}
            </span>
            <span className="tag tag-neutral">
              {standing === "active" ? "Active" : standing === "played" ? "Played" : "Upcoming"}
            </span>
            {notGenerated && (
              <span className="tag tag-neutral"><i className="ph ph-clock" /> Not generated yet</span>
            )}
            <i
              className={expanded ? "ph ph-caret-up" : "ph ph-caret-down"}
              style={{ fontSize: 13, color: "var(--color-neutral-500)" }}
            />
          </div>
          {!expanded && (
            // Everything the closed row needs to be useful: what it plays,
            // over how many holes, and the settings summary the card already
            // computed for the "Customize" panel.
            <div className="text-muted" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
              {stage.format} · {stage.holes} holes · {summaryLine}
            </div>
          )}
        </button>
        {/* `display: contents` rather than a conditional render: these fields
            are flex children of the header row, and wrapping them in an
            ordinary div when open would change the layout. Contents makes the
            wrapper vanish from the box tree; none takes the lot away. */}
        <div style={{ display: expanded ? "contents" : "none" }}>
        <div className="field" style={{ width: 200 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
            Format
            <button
              type="button"
              onClick={() => setFormatInfoOpen((o) => !o)}
              title="About this round"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-neutral-500)", display: "inline-flex" }}
            >
              <i className="ph ph-info" style={{ fontSize: 13 }} />
            </button>
          </label>
          {/* Grouped, because this is where team golf actually lives and a flat
              list of fifteen names does not say which of them need a partner.
              An organizer scanning for "how do we play four-ball" now finds a
              heading rather than having to recognise the name. */}
          <select className="input" value={format} disabled={pending} onChange={(e) => commitFormat(e.target.value)}>
            <optgroup label="Played on your own">
              {formatOptions.filter((o) => !isTeamFormat(o.name)).map((o) => (
                <option key={o.name} value={o.name} disabled={o.disabled}>
                  {o.disabled && o.note ? `${o.name} — ${o.note}` : o.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Played as a side">
              {formatOptions.filter((o) => isTeamFormat(o.name)).map((o) => (
                <option key={o.name} value={o.name} disabled={o.disabled}>
                  {o.disabled && o.note ? `${o.name} — ${o.note}` : o.name}
                </option>
              ))}
            </optgroup>
          </select>
          {activePending && (
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
              This round is set to {activePending.name}, which can be configured but not yet
              scored — {activePending.pendingReason}.
            </p>
          )}
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Holes</label>
          <div className="seg" style={{ width: "100%" }}>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name={`holes-${stage.id}`} checked={holes === 18} disabled={pending} onChange={() => commitHoles(18)} />18
            </label>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name={`holes-${stage.id}`} checked={holes === 9} disabled={pending} onChange={() => commitHoles(9)} />9
            </label>
          </div>
        </div>

        {/* The day this round is played — and, when a week is rained off, the
            one field the committee needs. Changing it moves this round only;
            the rest of the season and every score already entered stay put. */}
        <div className="field" style={{ width: 172 }}>
          <label>
            Played on
            <FieldInfo label="the day this round is played">
              <p>
                The day the field actually goes out. A fixed-day league plays <i>on</i> a day; the
                deadline below is for rounds where players arrange their own match and must finish
                by a date.
              </p>
              <p>
                <b>Rained off?</b> Change the date here. It moves this round alone — the other
                weeks and any scores already entered are untouched.
              </p>
            </FieldInfo>
          </label>
          <input
            className="input"
            type="date"
            value={playedOn}
            disabled={pending}
            onChange={(e) => commitPlayedOn(e.target.value)}
            aria-label={`Date round ${stage.position + 1} is played`}
          />
          {playedOn && (
            <span className="text-muted" style={{ fontSize: 11.5, marginTop: 3, display: "block" }}>
              {shortDate(playedOn)}
            </span>
          )}
        </div>

        {/* Which nine, when the round is 9 holes. Front and back have their own
            pars and stroke indexes, so a net round on the back allocates shots
            completely differently — this is not cosmetic. */}
        {holes === 9 && (
          <div className="field" style={{ width: 168 }}>
            <label>Which nine</label>
            <select
              className="input"
              value={nine}
              disabled={pending}
              onChange={(e) => commitVenue(courseId, e.target.value)}
            >
              <option value="front">Front nine</option>
              <option value="back">Back nine</option>
              {/* Front and back was a forced choice, and plenty of rounds
                  genuinely have no answer: a shotgun start puts groups on
                  both nines at once, and a round rotating venues has a
                  different front nine on each. "full" already means "use the
                  whole card" everywhere downstream, so this needs no new
                  state — it just stops the screen insisting on a fact the
                  organizer may not have. */}
              <option value="full">Not fixed — shotgun or mixed</option>
            </select>
          </div>
        )}

        {/* Only where the tournament rotates venues. One course means the
            whole event is played there and asking would be noise. */}
        {venues.length > 1 && (
          <div className="field" style={{ minWidth: 170 }}>
            <label>Course</label>
            <select
              className="input"
              value={courseId ?? ""}
              disabled={pending}
              onChange={(e) => commitVenue(e.target.value || null, nine)}
            >
              <option value="">Same as the tournament</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        )}
        <button
          type="button"
          className="btn btn-icon"
          title="Remove stage"
          disabled={pending}
          onClick={() => startTransition(() => removeStage(stage.id))}
        >
          <i className="ph ph-trash" />
        </button>
        </div>
      </div>

      {expanded && formatInfoOpen && (
        <div className="text-muted" style={{ fontSize: 12, margin: "-8px 0 0 60px", display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={{ margin: 0 }}>{description}</p>
          {activeFormat && (
            <p style={{ margin: 0 }}>
              <b style={{ color: "var(--color-accent-300)" }}>{activeFormat.name}</b> — {activeFormat.desc}
            </p>
          )}
        </div>
      )}

      {/* Everything below is the round's configuration, folded away when the
          card is closed. The chain warnings above stay visible either way:
          "this round doesn't follow on from the last one" is the one thing an
          organizer must see without opening anything. */}
      <div style={{ display: expanded ? "contents" : "none" }}>

      {/* What the format costs the sides in strokes. On the round,
          beside the format it belongs to — this used to live on the
          Teams screen behind a second round selector, so an organizer
          chose Four-Ball here and discovered what it played off
          somewhere else, with nothing on either screen saying so. */}
      {stage.teamScoring && (
        <div>
          <SectionLabel>
            Handicaps for {stage.teamScoring.name}
            <FieldInfo label="team handicaps">
              <p>
                What each side plays off in this round. The allowance is the share of a
                player&rsquo;s course handicap that counts; some formats also split it between
                partners, and some let you choose how many balls count on a hole.
              </p>
              <p>Every one of these is the format&rsquo;s recommendation until you change it.</p>
            </FieldInfo>
          </SectionLabel>
          <div style={{ marginTop: 6 }}>
            <RoundTeamScoring stageId={stage.id} info={stage.teamScoring} />
          </div>
        </div>
      )}
      <div>
        <button
          type="button"
          onClick={() => setCustomizeOpen((o) => !o)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: "var(--color-bg)",
            border: "1px solid var(--color-divider)",
            borderRadius: "var(--radius-md)",
            padding: "10px 14px",
            cursor: "pointer",
            textAlign: "left",
            color: "var(--color-text)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, flex: "none", color: "var(--color-text)" }}>
            <i className={customizeOpen ? "ph ph-caret-down" : "ph ph-caret-right"} style={{ color: "var(--color-accent-300)" }} />
            <i className="ph ph-sliders" style={{ color: "var(--color-accent-300)" }} />
            Customize this round
          </span>
          {!customizeOpen && (
            <span className="text-muted" style={{ fontSize: 12, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {summaryLine}
            </span>
          )}
        </button>

        {customizeOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div className="field" style={{ width: 320 }}>
                <label>
                  Result calculation
                  <FieldInfo label="result calculation">
                    <p>
                      <b>Gross</b> ranks the strokes actually taken. <b>Net</b> takes handicap
                      strokes off first, so a 20-handicap can win. <b>Both</b> keeps two orders of
                      merit from one card.
                    </p>
                    <p>
                      <b>Stableford</b> scores points per hole instead of counting strokes, so a
                      blow-up costs one hole rather than the round. It is set here, on a stroke-play
                      round, rather than picked as its own format &mdash; there is one engine, and
                      offering two doors to it would leave one of them not opening.
                    </p>
                  </FieldInfo>
                </label>
                <div className="seg" style={{ width: "100%" }}>
                  {BASIS_OPTIONS.map((o) => (
                    <label key={o.key} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                      <input type="radio" name={`basis-${stage.id}`} checked={basis === o.key} disabled={pending} onChange={() => commitBasis(o.key)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field" style={{ width: 190 }}>
                <label>Completion deadline</label>
                {/* A date input, so it opens the platform calendar rather than
                    asking someone to guess a format. The native picker follows
                    `color-scheme`, which the app shell now sets from the club's
                    appearance, so it isn't a white popup on a dark page. */}
                <input
                  className="input"
                  type="date"
                  value={isIsoDate(deadline) ? deadline : ""}
                  disabled={pending}
                  onChange={(e) => {
                    setDeadline(e.target.value);
                    startTransition(() => setStageDeadline(stage.id, e.target.value));
                  }}
                />
                {/* Deadlines were free text, so older rounds hold things like
                    "Sat 14 Jun" that a date input cannot show. Rather than
                    render an empty box and let the next save quietly erase it,
                    the old value stays visible until someone picks a date. */}
                {deadline && !isIsoDate(deadline) && (
                  <p className="text-muted" style={{ fontSize: 11, margin: "4px 0 0", lineHeight: 1.4 }}>
                    Currently &ldquo;{deadline}&rdquo; — pick a date to replace it.
                  </p>
                )}
              </div>
            </div>

            {/* Weekly sign-up, when the league asks the question. The counts
                keep the organizer honest about Wednesday: "18 in" where five
                are only in by default is a different tee sheet from 18 who
                said so. */}
            {stage.attendance && (
              <div className="field" style={{ maxWidth: 420 }}>
                <label>Sign-up deadline</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="input"
                    type="date"
                    style={{ width: 170 }}
                    defaultValue={isIsoDate(stage.optDeadline) ? stage.optDeadline : ""}
                    disabled={pending}
                    onChange={(e) => startTransition(() => void setStageOptDeadline(stage.id, e.target.value))}
                  />
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {stage.attendance.in} in
                    {stage.attendance.inByDefault > 0 && ` (${stage.attendance.inByDefault} by default)`}
                    {" · "}
                    {stage.attendance.out} out
                  </span>
                </div>
                <p className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 0", lineHeight: 1.4 }}>
                  Players may answer until the end of this day; after it, changes go through you.
                </p>
              </div>
            )}


            <SettingsGroup
              title="On the day"
              blurb="When this round is played and whether scores can still go in."
            >
            {/* Directly under the date, because it is the thing that overrules
                it. Kept out of the collapsed summary: closing a round early is
                a decision made on the day, not part of setting one up. */}
            <div>
              <SectionLabel>Scoring window</SectionLabel>
              <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                Whether scores can still be entered for this round.
              </p>
              <RoundDeadlineControl
                stageId={stage.id}
                roundLabel={`Round ${stage.position + 1}`}
                deadline={deadline}
                override={stage.deadlineOverride}
                locked={pending}
              />
            </div>

            </SettingsGroup>

            <SettingsGroup
              title="What this round decides"
              blurb="Only what this kind of round actually settles. A round with nothing of its own to decide shows nothing here."
            >
            {showTransition && (
              <div>
                <SectionLabel>
                  Cut line &amp; carry-forward — before the next round
                  <FieldInfo label="the cut line and carry-forward">
                    <p>{ROUND_CUT_HELP}</p>
                    <p>{CUT_SCOPE_HELP}</p>
                  </FieldInfo>
                </SectionLabel>
                <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                  Carry points forward and/or cut the field before it moves on from this round.
                </p>
                <NextRoundTransition key={nextStage?.id ?? "none"} stageId={stage.id} nextStage={nextStage} confirmedCount={confirmedCount} flightCount={flightCount} carry={carryPrompt} />
              </div>
            )}

            {/* One match, paired by a rule rather than by hand. Sits with the
                other per-type settings because that is what it is: how this
                kind of round decides what it contains. */}
            {stage.type === "Single Match Stage" && singleMatch && (
              <div>
                <SectionLabel>The match</SectionLabel>
                <SingleMatchRulePicker
                  stageId={stage.id}
                  rule={singleMatch.rule}
                  ruleLabel={singleMatch.ruleLabel}
                  problem={singleMatch.resolution.problem}
                  aName={singleMatch.aName}
                  bName={singleMatch.bName}
                  matchId={singleMatch.matchId}
                  stale={singleMatch.stale}
                  rounds={singleMatch.rounds}
                  players={singleMatch.players}
                  locked={false}
                />
              </div>
            )}

            {stage.type === "Bracket Stage" && thirdPlace && (
              <div>
                <SectionLabel>Third and fourth</SectionLabel>
                <ThirdPlaceControl
                  stageId={stage.id}
                  on={thirdPlace.on}
                  problem={thirdPlace.problem}
                  aName={thirdPlace.aName}
                  bName={thirdPlace.bName}
                  made={thirdPlace.made}
                />
              </div>
            )}

            {stage.type === "Qualification Stage" && (
              <div>
                <SectionLabel>
                  Qualification cut
                  <FieldInfo label="the qualification cut">
                    <p>{QUALIFICATION_CUT_HELP}</p>
                    <p>{CUT_SCOPE_HELP}</p>
                  </FieldInfo>
                </SectionLabel>
                <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                  How many players advance from this cut — top N per flight, or top N overall.
                </p>
                <QualControl mode={qual.mode} perFlight={qual.perFlight} overall={qual.overall} />
              </div>
            )}

            </SettingsGroup>

            <SettingsGroup
              title="Tiebreakers"
              blurb="Set once and rarely touched. Two separate questions — the numbers say which is which."
            >
            {stage.type === "Round Robin" && (
              <div>
                {/* Two different questions that were sharing one heading, which
                    is why nobody could find the second one. The first settles
                    ONE MATCH that finished all square; the second settles TWO
                    PLAYERS level on points once every match is in. They apply
                    at different moments and neither substitutes for the other,
                    so they are now separately titled and separately boxed. */}
                {format === "Match Play" && (
                  <div style={{ marginBottom: 18 }}>
                    <SectionLabel>
                      1. A match finishes all square
                      <FieldInfo label="deciding a halved match">
                        <p>
                          This decides a single match on the day — who takes the point when two players
                          finish level after the last hole. It has nothing to do with the standings.
                        </p>
                      </FieldInfo>
                    </SectionLabel>
                    <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
                      Who takes the point when a match ends level. Tried in order; a halved match stays
                      halved if none of them separates the two.
                    </p>
                    <MatchTiebreakControl selected={matchTiebreakers} holes={holes} locked={pending} />
                  </div>
                )}

                <div>
                  <SectionLabel>
                    {format === "Match Play" ? "2. Players finish level on the leaderboard" : "Players finish level on the leaderboard"}
                    <FieldInfo label="deciding the standings">
                      <p>
                        This ranks the STANDINGS once every match is in — a different question from the
                        one above, asked at a different time. Add as many Toughest N steps as you like
                        and set N on each.
                      </p>
                    </FieldInfo>
                  </SectionLabel>
                  <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
                    {format === "Match Play"
                      ? "How the table is ordered when players are level on points. Shared by every round-robin round scored as Match Play."
                      : `This round is scored as Stroke Play, so ties break by ${
                          basis === "stableford" ? "highest Stableford points" : "lowest net, then lowest gross"
                        }, then by the steps below.`}
                  </p>
                  <ScoringClient initial={scoring} tiebreakers={tiebreakers} />
                </div>
              </div>
            )}
            </SettingsGroup>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export function StagesClient({
  stages,
  rrMatchesPerPlayer,
  scoring,
  tiebreakers,
  matchTiebreakers = [],
  qual,
  confirmedCount,
  flightCount = 1,
  venues = [],
  chainsRounds = true,
  handicapWarning = null,
  activeStageId = null,
  singleMatches,
  thirdPlaces,
}: {
  stages: StageView[];
  rrMatchesPerPlayer: number;
  scoring: ScoringValues;
  tiebreakers: TiebreakerKey[];
  /** How an all-square match is decided, in order. Empty leaves it halved. */
  matchTiebreakers?: MatchTiebreakKey[];
  qual: QualValues;
  confirmedCount: number;
  /** Flights the field is split into — decides what a per-flight cut advances. */
  flightCount?: number;
  /** Courses this tournament may be played on; more than one shows the picker. */
  venues?: Array<{ id: string; name: string }>;
  /** Whether rounds feed each other — false for a single-round tournament. */
  chainsRounds?: boolean;
  /** Set when net scoring is running on unrated tees. */
  handicapWarning?: string | null;
  /** The round actually being played, decided on the server so this screen
   *  and every other one name the same round. */
  activeStageId?: string | null;
  /**
   * Resolved Single Match Stage views, by stage id.
   *
   * Only the stages that are one — every other kind has no entry, which is why
   * the lookup is optional rather than a map that has to be complete.
   */
  singleMatches?: Record<string, SingleMatchView>;
  /** Third-place views, by Bracket Stage id. */
  thirdPlaces?: Record<string, ThirdPlaceView>;
}) {
  /**
   * Which round is open. One at a time, and none when there are several.
   *
   * A tournament with one or two rounds opens the first: there is nothing to
   * scroll past, and making somebody click to see the only round would be
   * officious. A league opens none, because ten expanded rounds is the wall
   * this replaced.
   */
  const [openRound, setOpenRound] = useState<string | null>(
    stages.length > 0 && stages.length <= 2 ? stages[0].id : null,
  );
  const [newType, setNewType] = useState<StageTypeKey>(STAGE_TYPES[0]);
  // Resets to 1 after each add: "add 10 weeks" is a deliberate act, and
  // leaving the box on 10 would make the next click a nasty surprise.
  const [howMany, setHowMany] = useState(1);
  // Settings that apply to EVERY round in the run. They live here rather than
  // being warned about afterwards, because the alternative to configuring ten
  // rounds up front is configuring ten cards one at a time.
  const [bulkFormat, setBulkFormat] = useState("");
  const [bulkHoles, setBulkHoles] = useState(18);
  const [startDate, setStartDate] = useState("");
  const [interval, setInterval] = useState(7);
  const [pending, startTransition] = useTransition();

  const activeIndex = stages.findIndex((s) => s.id === activeStageId);

  // Where the rounds don't fit together. Rounds chain — standings carry
  // forward, cuts pick the next field from the last round's results — and that
  // silently assumes consecutive rounds measure the same thing. Once any round
  // can be any format, they often don't.
  const chain = chainIssues(
    stages.map((s) => ({
      position: s.position,
      format: s.format,
      scoringBasis: s.scoringBasis,
      carryForwardEnabled: s.carryEnabled,
      cutEnabled: s.cutEnabled,
    })),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Net scoring without a Course Rating and Slope is an approximation,
          and an organizer should know that before the results are published
          rather than after somebody queries them. */}
      {handicapWarning && (
        <div
          className="card elev-sm"
          style={{ gap: 6, borderLeft: "3px solid var(--color-accent)" }}
        >
          <span className="card-title" style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <i className="ph ph-flag" /> Handicaps are approximate
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>{handicapWarning}</p>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            Add them under the course on <a href="/event">Event setup</a>.
          </p>
        </div>
      )}
      {stages.map((s, i) => {
        // The next round of any format — a Round Robin whose next round is a
        // stroke-play final must know a round follows it, so the cut and
        // carry-forward controls appear and it stops saying "No round after
        // this yet". Keyed off the play order, not the round-robin chain.
        const nextStage = nextPlayingStage(stages, s.position);
        return (
          <StageCard
            key={s.id}
            stage={s}
            singleMatch={singleMatches?.[s.id] ?? null}
            thirdPlace={thirdPlaces?.[s.id] ?? null}
            expanded={openRound === s.id}
            onToggle={() => setOpenRound((cur) => (cur === s.id ? null : s.id))}
            isFirst={i === 0}
            standing={
              activeStageId === s.id
                ? "active"
                : activeIndex >= 0 && i < activeIndex
                  ? "played"
                  : "upcoming"
            }
            nextStage={nextStage}
            rrMatchesPerPlayer={rrMatchesPerPlayer}
            scoring={scoring}
            tiebreakers={tiebreakers}
            matchTiebreakers={matchTiebreakers}
            qual={qual}
            confirmedCount={confirmedCount}
            flightCount={flightCount}
            venues={venues}
            chainWarnings={issuesForRound(chain, s.position).map((w) => w.message)}
            chainsRounds={chainsRounds}
          />
        );
      })}
      {stages.length === 0 && (
        <div className="card elev-sm">
          <span className="text-muted" style={{ fontSize: 13 }}>
            No rounds yet — add your first round below (start with a Round Robin).
          </span>
        </div>
      )}

      {/* Was a bare select of four raw enum strings — "Single Match Stage"
          told an organizer nothing about what it would do, and the medal
          round every club plays wasn't on the list at all. Each option now
          says what the app will actually generate, because that is the whole
          difference between the types. */}
      <div className="card elev-sm" style={{ gap: 12 }}>
        <div>
          <span className="card-title" style={{ fontSize: 15 }}>Add a round</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
            Sequence as many as you like. The <em>type</em> decides what gets drawn — pairings, a
            cut, or a bracket. How it&apos;s scored is the <em>format</em> on each round, chosen
            separately, so a Stableford or four-ball round is a round of one of these types.
          </p>
        </div>

        {/* Two groups rather than five equal cards. Nearly every round an
            organizer adds is one the field plays; a cut and a bracket are
            structure, added once if at all. Showing them as peers made the
            common choice a five-way decision every time. */}
        <span className="card-kicker">Rounds the field plays</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 8 }}>
          {STAGE_TYPE_INFO.filter((t) => t.isPlayingRound && t.key !== "Single Match Stage" && t.key !== "Bracket Stage").map((t) => {
            const selected = newType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setNewType(t.key)}
                disabled={pending}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  color: "var(--color-text)",
                  background: selected
                    ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                    : "color-mix(in srgb, var(--color-text) 3%, transparent)",
                  border: `1px solid ${selected ? "var(--color-accent)" : "color-mix(in srgb, var(--color-text) 12%, transparent)"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <i className={t.icon} style={{ fontSize: 15, color: "var(--color-accent-400)" }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
                  {t.blurb}
                </div>
              </button>
            );
          })}
        </div>

        <span className="card-kicker" style={{ marginTop: 4 }}>Structure</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 8 }}>
          {STAGE_TYPE_INFO.filter((t) => !t.isPlayingRound || t.key === "Single Match Stage" || t.key === "Bracket Stage").map((t) => {
            const selected = newType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setNewType(t.key)}
                disabled={pending}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  color: "var(--color-text)",
                  background: selected
                    ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                    : "color-mix(in srgb, var(--color-text) 3%, transparent)",
                  border: `1px solid ${selected ? "var(--color-accent)" : "color-mix(in srgb, var(--color-text) 12%, transparent)"}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <i className={t.icon} style={{ fontSize: 15, color: "var(--color-accent-400)" }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 11.5, marginTop: 3, lineHeight: 1.45 }}>
                  {t.blurb}
                </div>
              </button>
            );
          })}
        </div>

        {/* Everything below applies to every round in the run. Set here rather
            than flagged as homework: the alternative to configuring ten rounds
            up front is configuring ten cards one at a time, which is the very
            thing "how many" exists to avoid. */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
            <span className="text-muted">How many?</span>
            <input
              className="input"
              type="number"
              min={1}
              max={MAX_ROUNDS_AT_ONCE}
              value={howMany}
              disabled={pending}
              onChange={(e) => setHowMany(Math.max(1, Math.min(MAX_ROUNDS_AT_ONCE, parseInt(e.target.value, 10) || 1)))}
              style={{ width: 72, textAlign: "center" }}
              aria-label="How many rounds to add"
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
            <span className="text-muted">Format</span>
            <select
              className="input"
              value={bulkFormat}
              disabled={pending}
              onChange={(e) => setBulkFormat(e.target.value)}
              style={{ minWidth: 150 }}
              aria-label="Format for every round added"
            >
              <option value="">Default for this event</option>
              <optgroup label="Played on your own">
                {GOLF_FORMATS.filter((f) => f.playable && !isTeamFormat(f.name)).map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </optgroup>
              <optgroup label="Played as a side">
                {GOLF_FORMATS.filter((f) => f.playable && isTeamFormat(f.name)).map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </optgroup>
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
            <span className="text-muted">Holes</span>
            <select
              className="input"
              value={bulkHoles}
              disabled={pending}
              onChange={(e) => setBulkHoles(parseInt(e.target.value, 10) === 9 ? 9 : 18)}
              style={{ width: 82 }}
              aria-label="Holes for every round added"
            >
              <option value={18}>18</option>
              <option value={9}>9</option>
            </select>
          </label>

          {/* A fixed-day league plays ON a day; it does not "play by" one.
              Leaving this blank keeps the old behaviour of no fixed date. */}
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
            <span className="text-muted">First round played</span>
            <input
              className="input"
              type="date"
              value={startDate}
              disabled={pending}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: 160 }}
              aria-label="Date the first round is played"
            />
          </label>

          {howMany > 1 && startDate && (
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
              <span className="text-muted">Then</span>
              <select
                className="input"
                value={interval}
                disabled={pending}
                onChange={(e) => setInterval(parseInt(e.target.value, 10))}
                style={{ minWidth: 160 }}
                aria-label="How often the rounds repeat"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.days} value={o.days}>{o.label}</option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await addStage(newType, {
                  count: howMany,
                  format: bulkFormat || undefined,
                  holes: bulkHoles,
                  startDate: startDate || undefined,
                  intervalDays: interval,
                });
                setHowMany(1);
                setStartDate("");
              })
            }
          >
            <i className="ph ph-plus" />{" "}
            {howMany === 1
              ? `Add ${stageTypeInfo(newType).label.toLowerCase()}`
              : `Add ${howMany} ${stageTypeInfo(newType).label.toLowerCase()}s`}
          </button>
          {/* The consequence, stated before the click rather than discovered
              after it. Pairings are the thing an organizer is most often
              surprised by, in both directions. */}
          <span className="text-muted" style={{ fontSize: 12 }}>
            {generatesPairings(newType)
              ? "Draws a full set of pairings once flights are generated."
              : "No pairings are drawn — the field returns cards."}
          </span>
        </div>

        {/* Said before the click, not discovered after it. Deliberately NOT a
            blocked button: "have you looked at everything" cannot be defined
            honestly, and the defaults above are real choices, so refusing to
            proceed would only teach people to click through a gate. What it
            does instead is name exactly what is shared and what is not. */}
        {howMany > 1 && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>
              All {howMany} rounds will be created the same
            </span>
            <p style={{ margin: "5px 0 0", fontSize: 12, lineHeight: 1.6 }}>
              They share the format, holes{startDate ? " and dates" : ""} set above. Everything
              else — the handicap allowance, the cut line, carry-forward, round codes — is set on
              each round, so changing one of those afterwards means editing {howMany} cards.
              {" "}Worth setting the format here rather than there.
            </p>
            {startDate && (
              <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 11.5, lineHeight: 1.55 }}>
                {interval === 0
                  ? `All ${howMany} on ${shortDate(startDate)}.`
                  : `${shortDate(startDate)}, then ${INTERVAL_OPTIONS.find((o) => o.days === interval)?.label.toLowerCase()} — last round ${shortDate(roundDates(startDate, howMany, interval)[howMany - 1])}.`}
                {" "}Any one of them can be moved later if it rains off.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
