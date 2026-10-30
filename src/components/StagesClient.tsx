"use client";
import { figureOr, readWhole } from "@/lib/domain/decimal-text";
import React, { useEffect, useState, useTransition } from "react";
import { useGolfTerms } from "./GolfTermsProvider";
// Aliased: several components here hold a local `roundLabel` string built from
// it, and shadowing the import would read as a bug rather than as a value.
import { roundLabel as roundLabelOf, roundNumber as roundNumberOf } from "@/lib/domain/round-label";
import { formatChoicesFor, naturalFormatFor } from "@/lib/domain/round-choices";
import {
  setStageDeadline,
  setStageCarry,
  setStageScoringBasis,
  setStageScoreInput,
  setStageMatchKeptBy,
  setStageFormat,
  setStageHoles,
  setStagePlayedOn,
  addStage,
  removeStage,
  generateNextRound,
} from "@/app/actions/tournament";
import { setStageCourse } from "@/app/actions/courses";
import { GOLF_FORMATS, declaredInput, inputChoices, entryModeFor, formatTagline, isManualFormat } from "@/lib/formats";
import { MATCH_ENTRY_MODES } from "@/lib/domain/match-entry";
import { MATCH_KEPT_BY, keptByScoreInput, matchKeptBy, type MatchKeptBy } from "@/lib/domain/match-kept-by";
import { roundStanding } from "@/lib/domain/round-standing";
import { RescoreWarning, RESCORE_CONSEQUENCE } from "./RescoreWarning";
import { SaveState, useSaveStatus } from "./SaveState";
import { roundShapeMismatch } from "@/lib/domain/round-shape";
import { INTERVAL_OPTIONS, dueBeforePlayed, roundDates, shortDate } from "@/lib/domain/round-dates";
import { CoursePicker } from "@/components/CoursePicker";
import type { PickedCardNote } from "@/lib/domain/picked-card";
import FieldInfo from "@/components/FieldInfo";
import { CUT_SCOPE_HELP, ROUND_CUT_HELP, QUALIFICATION_CUT_HELP, cutTieRuleOf } from "@/lib/domain/cut";
import { cutRuleOf, cutRuleWords } from "@/lib/domain/cut-ready";
import {
  chainIssues,
  issuesForRound,
  carryForwardPrompt,
  standingsUnit,
  type CarryPrompt,
} from "@/lib/format-chain";
import {
  STAGE_TYPE_INFO,
  // STAGE_TYPES is gone with the round type this screen used to preselect.
  stageTypeInfo,
  generatesPairings,
  addRoundConsequence,
  seededFromQualifiers,
  nextPlayingStage,
  isStructuralStage,
  MAX_ROUNDS_AT_ONCE,
  isIndividualStrokeRound,
  isPlayingRound,
  isKnockoutRound,
  isHeadToHead,
  type StageTypeKey,
} from "@/lib/stage-types";
import { PointsControl, TableTiebreakControl, pointsInWords } from "./ScoringClient";
import { matchTieInWords, tableTieInWords } from "@/lib/domain/tie-words";
import { RoundTeamScoring, type RoundScoringInfo } from "./RoundTeamScoring";
import { RoundHandicaps } from "./RoundHandicaps";
import { RoundAllowance, type RoundAllowanceInfo } from "./RoundAllowance";
import type { RoundHandicapView } from "@/lib/services/round-handicap";
import { MatchTiebreakControl } from "./MatchTiebreakControl";
import type { MatchTiebreakKey } from "@/lib/domain/match-tiebreak";
import { SingleMatchRulePicker } from "@/components/SingleMatchRulePicker";
import { ThirdPlaceControl } from "@/components/ThirdPlaceControl";
import { RoundClosedControl } from "@/components/RoundClosedControl";
import { isStablefordRound, individualTieBreak, isStablefordFormat } from "@/lib/domain/week-basis";
export interface ThirdPlaceView {
  on: boolean;
  problem: string;
  aName: string;
  bName: string;
  made: boolean;
}
import type { SingleMatchView } from "@/lib/services/single-match";
import { QualControl } from "./QualControl";
import { BracketModePicker } from "./BracketModePicker";
import { BRACKET_MODES, type BracketMode } from "@/lib/domain/bracket";
import { CutControl } from "./CutControl";
import { RoundDeadlineControl } from "./RoundDeadlineControl";
import { setStageOptDeadline } from "@/app/actions/attendance";
import type { TiebreakerKey } from "@/lib/domain";
import { Icon } from "./Icon";
import { SidePanel } from "./SidePanel";
import { countbackSegments } from "@/lib/domain/stroke-countback";
import { useFormatting } from "./CurrencyProvider";
import { holesPlayed } from "@/lib/domain/handicap";

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
  /**
   * The committee's override for how scores are RECORDED, or "" to use the
   * input the format declares. See `GolfFormat.inputs`.
   */
  scoreInput: string;
  /** How players keep this round's matches, or "" for the round's default. See `matchKeptBy`. */
  matchKeptBy: string;
  /** The organizer has declared this round over. See `RoundClosedControl`. */
  closed: boolean;
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
  /** ties | playoff | countback — how a tie for the last place is settled. */
  cutTies: string;
  /** true = closed by hand, false = extended past the date, null = follow it. */
  deadlineOverride: boolean | null;
  /** Last day players may change their weekly in/out. "" = open. */
  optDeadline: string;
  /** Resolved sign-up counts for this round; null when the league question
   *  is switched off. */
  attendance: {
    in: number;
    out: number;
    inByDefault: number;
    /**
     * Whether the PLAYER is the one who answers, on their own phone.
     *
     * False under `captains`, where the captain sends the pairs in and the
     * club records them. The sentence under this control said "Players may
     * answer until the end of this day" in every mode that tracks attendance
     * — telling a captains league about a window its players are never
     * offered, and describing a deadline that binds nobody.
     */
    playersAnswer: boolean;
  } | null;
  matchCount: number;
  /** Venue for this round; null means the tournament's own course. */
  courseId: string | null;
  /** full | front | back — which nine, when the round is 9 holes. */
  nine: string;
  /** How this round prices its sides, or null for an individual format. */
  teamScoring: RoundScoringInfo | null;
  /** What an individual net round plays at, or null where the round has no such line. */
  allowance: RoundAllowanceInfo | null;
  /**
   * What each player plays off in this round, resolved — the roster's handicap,
   * the committee's decision for the round, or what the round was scored
   * against once its cards came in. Empty for a round the field does not play.
   */
  handicaps: RoundHandicapView[];
}

/** A knockout's arrangement as the Rounds screen shows it. */
export interface Arrangement {
  mode: BracketMode;
  /** What the second draw is called in this mode, or "" — `drawBrackets`. */
  secondLabel: string;
  /** Organizer only, as `setBracketMode` is. */
  canChange: boolean;
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
/** The round NUMBER in the same rotation, in the text steps, so it reads 7:1. */
const ROUND_TEXT = ["var(--color-accent-200)", "var(--color-accent-2-200)", "var(--color-accent-100)", "var(--color-accent-2-100)"];

/**
 * WHAT THE BASIS CAN SAY, and `stableford` is deliberately not offered.
 *
 * The basis is an ALLOCATION — whether handicap strokes are applied — and the
 * FORMAT is the unit. That is Ajay's ruling of 2026-09-20, and `weekBasis`
 * implements it by reading the format first. A round wanting points sets its
 * format to Stableford or Modified Stableford, both of which are selectable, and
 * then says gross or net here.
 *
 * `legacy` keeps the LABEL without offering the option. Rounds written before the
 * ruling hold `scoringBasis: "stableford"` — a unit in the allocation field — and
 * they still read correctly: `weekBasis` resolves that value to points on
 * purpose, "kept, so nothing already stored changes meaning", and the summary
 * line a few hundred lines below looks a label up here. Dropping the entry
 * outright would print the raw string at an organizer instead.
 *
 * So this closes the thing `decisions-2026-09-20` asked for in its own words —
 * "the app should also stop being able to express the contradiction" — from the
 * writing side only. Nothing stored changes, and nothing stored stops working.
 */
const BASIS_OPTIONS: Array<{ key: string; label: string; legacy?: true }> = [
  { key: "gross", label: "Gross" },
  { key: "net", label: "Net" },
  { key: "both", label: "Both" },
  { key: "stableford", label: "Stableford", legacy: true },
];

/** The ones an organizer may choose today. See `BASIS_OPTIONS`. */
const BASIS_CHOICES = BASIS_OPTIONS.filter((o) => !o.legacy);

/**
 * SETUP IS LOCKED — provided once by `StagesClient`, read by each card.
 *
 * The actions behind most controls on this screen refuse a locked tournament
 * by THROWING (`assertUnlocked`), which takes the page down to "Application
 * error". The page computed the lock and only showed a banner with it, so on a
 * live tournament every one of them was offered and every one crashed (swept
 * 2026-09-27: 24 controls). A context rather than a prop threaded through
 * three layers of cards.
 *
 * NOT everything here is behind the lock, and those stay open: a round's date,
 * its course and tees, "round finished", and the round's handicaps — and, since
 * Ajay's call of 2026-09-27 that RUNNING an event is not setting it up: adding
 * a round, drawing the next round (the server refuses a redraw of a round that
 * already has scores), the completion deadline and scoring window, and making
 * the single match or the play-off for third. Gate a new control on this only
 * when its action calls `assertUnlocked`.
 */
const SetupLocked = React.createContext(false);

/**
 * WHAT DAY IT IS, FROM THE SERVER — provided to every card the way the lock is.
 *
 * A round's scoring window is "open" or "closed" by the day, and this screen
 * is rendered on the server and again in the browser. Each asked its own
 * clock, so for the hours a club's evening is already tomorrow on the server
 * the two drew different words for one round — a hydration mismatch on this
 * screen (2026-10-11, `no-client-screen-draws-from-its-own-clock.test.ts`).
 */
const ServerToday = React.createContext("");

/**
 * WHETHER THE TOURNAMENT HAS BEEN LAUNCHED — provided once, read by each card.
 *
 * The controls that are about PLAY (is this round over, the scoring window) and
 * the round's Played / Active chip were on every card from the moment it was
 * added. Walked as a new organizer on 2026-10-16: an unplayed draft offered
 * "This round is finished" with a paragraph about making the result official,
 * "Open — scores can be entered" three weeks before the round, and an undated
 * Round 1 chipped "Played". They appear once the tournament is live, or once
 * the round itself has a result or has been closed — scoring can happen before
 * launch where a result already exists, so the round's own facts count too.
 */
const Launched = React.createContext(false);

/** Whether a stored deadline is something a date input can display. */
function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

/**
 * ONE TIE QUESTION, ONE LINE (2026-10-16): the question, the rule in use in
 * words, and Change where there is a choice — which opens the control in place
 * and closes on Done. See "Ties" on the round card, and the review panel's
 * brief in docs/tiebreak-brief-2026-10-16.md.
 */
/**
 * DRAW THIS ROUND, ON THIS ROUND, ONCE THE TOURNAMENT IS LIVE (2026-10-16).
 * A round that follows another — a second round robin, a round after a cut —
 * is drawn from the field (or the survivors) when the committee is ready. It
 * was a button on the round BEFORE, shown from the day the tournament was made.
 */
function DrawRound({ stage, label }: { stage: StageView; label: string }) {
  const [pending, startTransition] = useTransition();
  const [refused, setRefused] = useState<string | null>(null);
  const pairings = generatesPairings(stage.type);
  const drawn = stage.matchCount > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ minHeight: 44 }}
          // Not gated on the lock: drawing a round is running the event. The server
          // refuses — in words, shown below — a redraw of a round with scores in.
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setRefused(null);
              const res = await generateNextRound(stage.id);
              if (!res.ok) setRefused(res.error);
            })
          }
        >
          <Icon name="arrows-clockwise" /> {pairings ? `${drawn ? "Redraw" : "Draw"} ${label}'s matches` : `Give out ${label}'s cards`}
        </button>
        {(stage.cutEnabled || drawn) && (
          <span className="text-muted" style={{ fontSize: 13 }}>
            {stage.cutEnabled ? "From the standings once the round before is complete." : "Redrawing replaces its matches."}
          </span>
        )}
      </div>
      {refused && (
        <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> Not drawn. {refused}
        </p>
      )}
    </div>
  );
}

function TieRow({ question, rule, children }: { question: string; rule: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6, borderTop: "1px solid var(--color-divider)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minHeight: 44 }}>
        <span style={{ flex: "1 1 260px", minWidth: 0, fontSize: 14, lineHeight: 1.45 }}>
          <b>{question}</b> <span className="text-muted">→ {rule}</span>
        </span>
        {children && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: 44, fontSize: 13 }}
            aria-expanded={open}
            aria-label={`${open ? "Done with" : "Change"}: ${question}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Done" : "Change"}
          </button>
        )}
      </div>
      {children && open && <div style={{ paddingBottom: 6 }}>{children}</div>}
    </div>
  );
}

/**
 * How scores are recorded, in a secretary's words (2026-10-16, the review panel):
 * "Hole-by-hole result — what Match Play produces" and "Hole-by-hole scores —
 * counts for handicapping" read as one option twice.
 */
const SCORE_WORDS: Record<string, string> = {
  "hole-results": "Who won each hole",
  "gross-cards": "Every stroke (counts for handicap)",
  "match-result": "Final result only",
};

/** Formats every golfer knows by name: no line under the picker explaining them. */
const WELL_KNOWN_FORMATS = new Set(["Stroke Play", "Match Play", "Stableford"]);

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
 * when scores are due is the day's admin, what the round decides is what the
 * round is FOR, and the tiebreakers are rules set once and rarely touched.
 *
 * Used at two levels now. "What this round decides" is a group at ROUND level,
 * because the per-type settings are the round's whole point and were two
 * clicks from invisible inside "Customize this round"; the rest are groups
 * inside that panel. Same component either way — the level is the claim about
 * how central the decision is, and it should be visible in one place.
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
  /** ReactNode rather than string so a group can carry its own FieldInfo,
   *  which is where the "why does this work like that" explanation belongs
   *  once a group heading is the only heading above the controls. */
  title: React.ReactNode;
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
          <p className="text-muted" style={{ fontSize: 13, margin: "3px 0 0", lineHeight: 1.5 }}>
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
 * and the cut line — right from the round you're currently looking at.
 *
 * When there IS no next round it says so and offers a button, rather than
 * creating one silently on the first click. Keyed by the next stage's id
 * (or "none") so its local state re-syncs whenever a round gets added/removed.
 */
function NextRoundTransition({
  stageId,
  nextStage,
  allStages,
  confirmedCount,
  flightCount = 1,
  carry,
}: {
  /** The current round's id — where a newly-created next round gets appended after. */
  stageId: string;
  nextStage: StageView | undefined;
  /** Every stage, so the next round can be numbered the way the app numbers rounds. */
  allStages: StageView[];
  confirmedCount: number;
  /** Number of flights, so a per-flight cut can say what it really advances. */
  flightCount?: number;
  /** Whether to put the carry-forward question in front of the organizer. */
  carry: CarryPrompt;
}) {
  const [carryEnabled, setCarryEnabled] = useState(nextStage?.carryEnabled ?? false);
  const [carryPct, setCarryPct] = useState(nextStage?.carryPct ?? 0);
  const [pending, startTransition] = useTransition();
  // Every control in this section is behind the lock — see `SetupLocked`.
  const locked = React.useContext(SetupLocked);
  /**
   * Why the round would not build. Null until the server refuses.
   *
   * The action returned nothing, so pressing Generate on a round whose
   * qualifying had not been played looked identical to success: the spinner
   * stopped and the round was still empty. The refusal it now returns is the
   * only warning an organizer gets before a cut ranks the field on zero.
   */

  // The next round is guaranteed to exist by the time anything below runs —
  // the no-next-round case returns early. Kept as a function because the cut
  // control takes a getter rather than an id.
  const ensureNextStageId = async (): Promise<string> => nextStage?.id ?? stageId;

  const commitCarry = (nextEnabled: boolean, nextPct: number) => {
    setCarryEnabled(nextEnabled);
    setCarryPct(nextPct);
    startTransition(async () => {
      const id = await ensureNextStageId();
      await setStageCarry(id, nextEnabled, nextPct);
    });
  };

  // No next round yet, so there is nothing to cut INTO and nothing to carry
  // INTO. These controls used to stay live and create a Round Robin round the
  // moment either was touched, which meant an organizer who opened the section
  // to read the options came away with a round they never asked for and then
  // had to find and delete. Adding a round is a decision, so it gets a button
  // and a name rather than happening as a side effect of a click somewhere
  // else. The statement stays — it is true and worth reading — and only the
  // controls that would have conjured a round are withheld.
  if (!nextStage) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 9,
          padding: "11px 13px",
          borderRadius: "var(--radius-md)",
          background: "color-mix(in srgb, var(--color-text) 3%, transparent)",
        }}
      >
        <span className="text-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          <Icon name="info" /> No round after this yet. A cut and a carry-forward both need
          somewhere to go, so add the next round first and they will appear here.
        </span>
        <div>
          <button
            type="button"
            className="btn"
            // Not gated on the lock: adding a round is running the event, and
            // `addStage` allows it on a live tournament (2026-09-27).
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await addStage("Round Robin");
              })
            }
          >
            <Icon name="plus" /> Add the next round
          </button>
        </div>
      </div>
    );
  }

  // From the tournament's own count, not `position + 1`, which counts a cut as
  // a round and so named this one differently from every other screen.
  const roundLabel = roundLabelOf(allStages, nextStage.id);
  // A stroke-play / medal next round draws no pairings — the field returns
  // cards — so it is "generated" by handing the survivors a card, not by
  // building matches. Before it exists, assume a Round Robin (what gets created).
  /**
   * A bracket takes its field from Qualification, not from a cut here.
   *
   * Both controls below were offered for one anyway, and neither did anything.
   * The cut saved, displayed as saved, printed on the published rules sheet as
   * "Top 8 advance" — and the draw went on seeding two per flight, because it
   * reads the event's qualification settings. Generate then handed every
   * "survivor" an empty stroke-play card for a knockout round.
   *
   * Offering a setting that does nothing is worse than not offering it: the
   * organizer believes they have set the thing, and the sheet agrees with them.
   */
  const nextIsSeeded = nextStage ? seededFromQualifiers(nextStage.type) : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* ONE ROW FOR ONE DECISION (2026-10-16; the review panel, on Ajay's "I still
          see redundancies"). Whether points carry into the next round was asked
          three times over: a prompt card with Yes / No, then a tick-box, a slider
          and a sentence about the same thing. Now one choice — Start fresh, Carry
          all, Carry part — with the share only under Carry part. Still ASKED where
          it matters (`carry.ask`): nothing is chosen until the organizer chooses. */}
      {carry.inert ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {carry.detail}
        </p>
      ) : (
        <div className="field" style={{ gap: 6 }}>
          <span className="field-caption">
            Points into {roundLabel}
            <FieldInfo label="carrying points forward">
              <p>{carry.detail}</p>
              <p>
                Carry all and a player takes their whole total into {roundLabel}, so a strong round still
                counts at the end. Carry part and it is cut to the share you choose — the lead narrows but
                does not vanish. Start fresh and every player begins {roundLabel} level.
              </p>
            </FieldInfo>
          </span>
          <div className="seg" role="radiogroup" aria-label={`Points into ${roundLabel}`} style={{ flexWrap: "wrap" }}>
            {(
              [
                ["fresh", "Start fresh"],
                ["all", "Carry all"],
                ["part", "Carry part"],
              ] as const
            ).map(([key, label]) => {
              const chosen = carry.ask
                ? false
                : key === "fresh"
                  ? !carryEnabled
                  : key === "all"
                    ? carryEnabled && carryPct === 100
                    : carryEnabled && carryPct !== 100;
              return (
                <label key={key} className="seg-opt" style={{ minHeight: 44 }}>
                  <input
                    type="radio"
                    name={`carry-${stageId}`}
                    checked={chosen}
                    disabled={pending || locked}
                    onChange={() =>
                      key === "fresh"
                        ? commitCarry(false, 0)
                        : key === "all"
                          ? commitCarry(true, 100)
                          : commitCarry(true, carryPct > 0 && carryPct < 100 ? carryPct : 50)
                    }
                  />
                  {label}
                </label>
              );
            })}
          </div>
          {carry.ask && (
            <p style={{ fontSize: 13, margin: 0 }}>
              <b>{carry.question}</b> <span className="text-muted">Until you choose, {roundLabel} starts fresh.</span>
            </p>
          )}
          {!carry.ask && carryEnabled && carryPct !== 100 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <input
                type="range"
                min={5}
                max={95}
                step={5}
                value={carryPct}
                disabled={locked}
                onChange={(e) => commitCarry(true, parseInt(e.target.value, 10))}
                style={{ flex: 1, minWidth: 120, minHeight: 44 }}
                aria-label={`Share of points carried into ${roundLabel}`}
                aria-valuetext={`${carryPct}%`}
              />
              <span className="tag tag-accent" style={{ minWidth: 48, textAlign: "center" }}>{carryPct}%</span>
            </div>
          )}
          {!carry.ask && carryEnabled && (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              A player on 12 pts here starts {roundLabel} on {(12 * carryPct) / 100}.
            </p>
          )}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--color-divider)", margin: "4px 0", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Before a bracket there is no cut to make: its field is its qualifiers,
            set on the bracket's own card (2026-10-16 — the sentence saying so went). */}
        {nextIsSeeded ? null : (
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
            locked={locked}
          />
        )}
        {/* DRAWING THE NEXT ROUND IS NOT SETTING THIS ONE UP (2026-10-16; Ajay: "is this
            needed here?"). "Generate Round 2 pairings" sat on Round 1's card from the
            day the tournament was made. It is a match-day job, so it is on the round it
            draws, once the tournament is live — see `DrawRound`. */}
      </div>
    </div>
  );
}

function StageCard({
  stage,
  isFirst,
  standing,
  nextStage,
  allStages,
  rrMatchesPerPlayer,
  scoring,
  tiebreakers,
  matchTiebreakers,
  qual,
  confirmedCount,
  flightCount,
  venues,
  homeVenue,
  chainWarnings,
  chainsRounds,
  expanded,
  onToggle,
  singleMatch,
  thirdPlace,
  canSetVenue = true,
  hasResult = false,
  sharedWithAll = null,
  arrangement = null,
  asPanel = false,
}: {
  /** The timeline (behind its switch): the open round's settings in the side panel, not unfolded inline. */
  asPanel?: boolean;
  /** How the knockout is arranged, and whether this viewer may change it — see "The draw". */
  arrangement?: Arrangement | null;
  stage: StageView;
  /**
   * What every playing round shares, when there are three or more and they
   * all agree — said once in `EveryRound`, so a closed row need not repeat it.
   */
  sharedWithAll?: { format: string; holes: number; basis: string } | null;
  /** Somebody has returned something for this round — see `roundsWithResults`. */
  hasResult?: boolean;
  /**
   * Whether the round's course and nine can be changed here — organizer only,
   * because `setStageCourse` is. Shown either way, so an assistant can read
   * where a round is played; disabled for them rather than a control that
   * fails on every change.
   */
  canSetVenue?: boolean;
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
  /**
   * Every stage in the tournament, so a round can be numbered the way the rest
   * of the app numbers rounds.
   *
   * This card had `stage` and read `stage.position + 1`, which counts a cut as
   * a round — so the round after a cut was one higher here than on the prizes
   * screen, in score entry and on the player's own dashboard.
   */
  allStages: StageView[];
  rrMatchesPerPlayer: number;
  scoring: ScoringValues;
  tiebreakers: TiebreakerKey[];
  /** How an all-square match is decided, in order. */
  matchTiebreakers: MatchTiebreakKey[];
  qual: QualValues;
  confirmedCount: number;
  /** Flights the field is split into — decides what a per-flight cut advances. */
  flightCount: number;
  venues: Array<{ id: string; name: string; cardNote?: PickedCardNote | null }>;
  /** The tournament's own course, named only when there is more than one. */
  homeVenue: string;
  /** Ways this round doesn't fit the one before it. */
  chainWarnings: string[];
  /** False for a single-round tournament, which has no next round. */
  chainsRounds: boolean;
}) {
  // The club's own date order — see `shortDate`.
  const { locale } = useFormatting();
  // And its golf words — "club, league and golf group competitions".
  const golfWords = useGolfTerms();
  // Gates only the controls whose action refuses a locked tournament — see
  // `SetupLocked` for the ones that deliberately stay open.
  const locked = React.useContext(SetupLocked);
  const today = React.useContext(ServerToday);
  const launched = React.useContext(Launched);
  /**
   * PLAY HAS BEGUN FOR THIS ROUND: it has a result or is closed, or the
   * tournament is live and the round's day has come (an undated round counts as
   * come). Per round, not per tournament (the tournament director on the review
   * panel): once a tournament was live, "This round is finished" appeared on a
   * round three weeks away — the same trap, later.
   */
  const dayHasCome = !stage.playedOn || !today || stage.playedOn <= today;
  // An UNDATED round is under way only when it is the round in play: a knockout three
  // weeks off showed "Scoring window · Open" the day the tournament went live (2026-10-16).
  const underWay = hasResult || stage.closed || (launched && (stage.playedOn ? dayHasCome : standing === "active"));
  /** "Round 3" — the tournament's own count; empty for a stage the field does not play. */
  const thisRound = roundLabelOf(allStages, stage.id);
  const [deadline, setDeadline] = useState(stage.deadline);
  // The date box's refusal, said under the box (a round removed in another tab, say).
  const [dueError, setDueError] = useState("");
  // The sign-up deadline's refusal, said under its own box. It used to be dropped (`void`).
  const [optError, setOptError] = useState("");
  const [basis, setBasis] = useState(stage.scoringBasis);
  const [scoreInput, setScoreInput] = useState(stage.scoreInput);
  const [format, setFormat] = useState(stage.format);
  const [holes, setHoles] = useState(stage.holes);
  const [playedOn, setPlayedOn] = useState(stage.playedOn);
  const [dateRefused, setDateRefused] = useState("");
  const [courseId, setCourseId] = useState<string | null>(stage.courseId);
  // "full" is a real answer for a 9-hole round now ("not fixed"), so it has to
  // survive here. Collapsing anything-but-back to "front" silently discarded
  // the organizer's choice the moment the card re-rendered.
  const [nine, setNine] = useState(
    stage.nine === "back" || stage.nine === "full" ? stage.nine : "front",
  );
  // Whether "which nine" may be left to each match — only in match play,
  // where score entry asks every match for its own. See the picker below.
  const nineMayStayOpen = GOLF_FORMATS.find((f) => f.name === format)?.family === "match";
  // Carry-forward is the one setting an organizer can't afford to miss, and it
  // lives inside this panel — which is exactly the "unchecked box halfway down
  // a collapsed panel" the prompt exists to fix. Asking the question is no use
  // if the question is hidden, so an unanswered prompt opens the panel.
  // Closed to begin with. It used to open itself for an unanswered carry-forward
  // question, which no longer lives in it ("Before the next round" is on the face
  // of a round robin since 2026-10-16 — the UI/UX designer and the tournament
  // director on the review panel both found the leftover).
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [formatInfoOpen, setFormatInfoOpen] = useState(false);
  /**
   * What a format change would re-score, once the action has refused it.
   *
   * Held rather than confirmed inline because the number is the whole point:
   * "this changes the result of 37 cards" is a different decision from
   * "change the format", and the organizer cannot make the first one until
   * the server has counted.
   */
  const [formatCards, setFormatCards] = useState<{ format: string; cards: number } | null>(null);
  /**
   * The other two settings that RE-SCORE a round rather than edit it.
   *
   * One piece of state for both, because only one of these controls can be
   * waiting on an answer at a time and two independent flags would let a
   * second warning open under the first. The format keeps its own above: its
   * warning has to put the dropdown back to the stored value on decline, which
   * these two also do but through different setters.
   */
  const [rescore, setRescore] = useState<
    | { kind: "holes"; holes: number; cards: number }
    | { kind: "basis"; basis: string; cards: number }
    | { kind: "venue"; course: string | null; nine: string; cards: number }
    | null
  >(null);
  /**
   * What deleting this round would take with it.
   *
   * Null until the server refuses. Deleting a round deletes its matches, its
   * cards and — through the cascade — its skins pot with every stake already
   * collected, and the trash icon used to do all of that on one click.
   */
  const [removeCost, setRemoveCost] = useState<{ cards: number; stakes: number } | null>(null);
  const [pending, startTransition] = useTransition();
  /**
   * One badge for the whole card, derived from the transition every control
   * already shares.
   *
   * Taken from `pending` rather than wired into each `commit*` handler on
   * purpose: there are eight of them today and a ninth will be added, and a
   * confirmation somebody has to remember to add is a confirmation that will
   * be missing exactly on the control nobody thought about.
   */
  const saveStatus = useSaveStatus(pending);

  const confirmRescore = () => {
    const p = rescore;
    if (!p) return;
    setRescore(null);
    startTransition(async () => {
      if (p.kind === "holes") await setStageHoles(stage.id, p.holes, true);
      else if (p.kind === "venue") {
        await setStageCourse(stage.id, p.course, p.nine, true);
      } else await setStageScoringBasis(stage.id, p.basis, true);
    });
  };
  const cancelRescore = () => {
    // Put the control back to what is actually stored, or it keeps showing a
    // value the round does not have — the same trap the format warning names.
    const p = rescore;
    setRescore(null);
    if (p?.kind === "holes") setHoles(stage.holes);
    else if (p?.kind === "basis") setBasis(stage.scoringBasis);
    else if (p?.kind === "venue") {
      setCourseId(stage.courseId);
      setNine(stage.nine);
    }
  };

  const commitFormat = (v: string) => {
    setFormat(v);
    // The action refuses when the round already holds cards, and says how
    // many. Changing a format re-scores every one of them: the strokes stay,
    // what they MEAN changes.
    startTransition(async () => {
      const res = await setStageFormat(stage.id, v);
      if (res && "needsConfirm" in res) setFormatCards({ format: v, cards: res.cards ?? 0 });
      // Refused outright: the picker goes back to what the round is.
      else if (res && !res.ok) setFormat(stage.format);
    });
  };
  const confirmFormat = () => {
    const pendingChange = formatCards;
    if (!pendingChange) return;
    setFormatCards(null);
    startTransition(async () => {
      await setStageFormat(stage.id, pendingChange.format, true);
    });
  };

  const commitPlayedOn = (v: string) => {
    const before = playedOn;
    setPlayedOn(v);
    setDateRefused("");
    startTransition(async () => {
      // Refused on the Par plan outside its seven-day window: the date goes
      // back to what is stored, and the reason is said beside the field.
      const res = await setStagePlayedOn(stage.id, v);
      if (res && !res.ok) {
        setPlayedOn(before);
        setDateRefused(res.error ?? "That date could not be saved.");
      }
    });
  };

  const commitHoles = (v: number) => {
    setHoles(v);
    // Refuses on a round that already holds cards, exactly as the format does
    // — eighteen to nine re-ranks the stroke index onto the nine played and
    // measures every card against a different denominator.
    startTransition(async () => {
      const res = await setStageHoles(stage.id, v);
      if (res?.needsConfirm) setRescore({ kind: "holes", holes: v, cards: res.cards ?? 0 });
    });
  };
  // Venue and nine travel together: the action takes both, and a round that
  // changes course usually needs its nine restated for the new card.
  const commitVenue = (nextCourse: string | null, nextNine: string) => {
    setCourseId(nextCourse);
    setNine(nextNine);
    /**
     * THE VENUE RE-SCORES THE ROUND LIKE THE THREE CONTROLS AROUND IT, and
     * `setStageCourse` has always refused a round holding cards and said how
     * many. The answer was thrown away with `void`: the dropdown showed the
     * new course, the server had saved nothing, and no warning appeared. The
     * one control of the four where the guard existed and nobody listened.
     */
    startTransition(async () => {
      const nine = holes === 9 ? nextNine : "full";
      const res = await setStageCourse(stage.id, nextCourse, nine);
      if (res?.needsConfirm) {
        setRescore({ kind: "venue", course: nextCourse, nine, cards: res.cards ?? 0 });
      }
    });
  };
  const commitBasis = (next: string) => {
    setBasis(next);
    // Gross, net and Stableford rank the same numbers three different ways,
    // and the countback now runs on whichever this says. See the action.
    startTransition(async () => {
      const res = await setStageScoringBasis(stage.id, next);
      if (res?.needsConfirm) setRescore({ kind: "basis", basis: next, cards: res.cards ?? 0 });
    });
  };
  const commitScoreInput = (next: string) => {
    setScoreInput(next);
    startTransition(() => setStageScoreInput(stage.id, next));
  };
  // How players keep the matches (`matchKeptBy`). A refusal — a round with
  // scores already in — is said beside the choice and the radio goes back.
  const [keptBy, setKeptBy] = useState(stage.matchKeptBy);
  const [keptByRefusal, setKeptByRefusal] = useState("");
  const commitKeptBy = (next: MatchKeptBy) => {
    const before = keptBy;
    setKeptBy(next);
    setKeptByRefusal("");
    startTransition(async () => {
      const res = await setStageMatchKeptBy(stage.id, next);
      if (!res.ok) {
        setKeptBy(before);
        setKeptByRefusal(res.error ?? "Couldn't change that.");
      }
    });
  };

  const activeFormat = GOLF_FORMATS.find((f) => f.name === format);
  /**
   * Whether this round's type and its format can produce a result together.
   *
   * Read off `format` — the value in the dropdown — rather than
   * `stage.format`, so the sentence appears the moment the organizer picks
   * the pair rather than after the save round-trips.
   */
  const shapeProblem = roundShapeMismatch(stage.type, format);
  const activePending = GOLF_FORMATS.find((f) => f.name === format && !f.playable);

  // Whether to put the carry-forward question in front of the organizer, and
  // whether the control can do anything at all for this round's scoring.
  const carryPrompt = carryForwardPrompt({
    chainsRounds,
    hasNextRound: !!nextStage,
    format,
    scoringBasis: basis,
    answered: nextStage?.carryAsked ?? false,
    locked,
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
  /**
   * A STROKE-PLAY CUT, SET WHERE THE ROUND IS (2026-10-04).
   *
   * The cut into a stroke round is Ajay's rule of 2026-09-26 — "top N and
   * ties", made when the organizer marks this round finished (`stroke-cut.ts`).
   * But the only cut control lived in "Before the next round", which is round
   * robins only, so a 36-hole championship with a cut could not be set up from
   * any screen: the engine was there, the audit test seeded the cut straight
   * into the database, and the guide told organizers to look for a section
   * their round never shows. Found mapping the championship path for the
   * organizer e2e specs.
   *
   * Offered on exactly the pairs `stroke-cut.ts` cuts — both rounds individual
   * stroke cards — so the screen never sets a cut the server will not make.
   */
  const showStrokeCut =
    chainsRounds && !showTransition && !!nextStage && isIndividualStrokeRound(stage) && isIndividualStrokeRound(nextStage);
  const notGenerated = launched && !isFirst && stage.type === "Round Robin" && stage.matchCount === 0;

  // TWO summaries, because they answer to two different places and one string
  // cannot be honest in both. The closed round row has to cover the whole card.
  // The "Customize this round" button must cover only what is INSIDE that
  // panel — what the round decides is now shown directly above it, and a
  // button summarising things visible above it is noise.
  const transitionParts: string[] = [];
  if (nextStage?.carryEnabled) transitionParts.push(`carries ${nextStage.carryPct}%`);
  if (nextStage?.cutEnabled) {
    // In the words the rules sheet prints (`cutRuleWords`): "top 8 in each flight
    // and ties" — a cut to "top 8" was the summary of a per-flight cut too.
    const strokeCut = isIndividualStrokeRound(stage) && isIndividualStrokeRound(nextStage);
    const tieRule = cutTieRuleOf(nextStage.cutTies);
    transitionParts.push(
      `cuts to ${cutRuleWords(cutRuleOf(nextStage), strokeCut && tieRule === "ties").toLowerCase()}${
        strokeCut && tieRule === "playoff" ? ", a tie by play-off" : strokeCut && tieRule === "countback" ? ", a tie by countback" : ""
      }`,
    );
  }
  /**
   * WHAT IS CHANGED FROM A CLUB'S USUAL ROUND, and nothing else (2026-10-16).
   * The Customize button summarises only what is inside it, and inside it now
   * are the things clubs vary — so a round nobody has customised says so.
   */
  /** Whether this round raises a tie question at all — every kind but a round scored by hand. */
  const roundRaisesTies = (isKnockoutRound(stage.type) || stage.type === "Single Match Stage" || stage.type === "Round Robin" || (isIndividualStrokeRound(stage) && !isManualFormat(format)) || (stage.type === "Stroke Play Round" && entryModeFor(format) === "team" && !isManualFormat(format)));
  const customizeParts: string[] = [];
  if (deadline) {
    customizeParts.push(
      `Due ${isIsoDate(deadline) ? shortDate(deadline, locale) : deadline}${dueBeforePlayed(deadline, playedOn) ? ", before the round is played" : ""}`,
    );
  }
  if (scoreInput && scoreInput !== declaredInput(format)) {
    customizeParts.push(MATCH_ENTRY_MODES.find((m) => m.key === scoreInput)?.label ?? "Scores recorded differently");
  }
  // How players keep the matches, when the organizer chose other than the round's own default.
  if (!keptByScoreInput(format)) {
    const keptNow = matchKeptBy({ type: stage.type, format, scoreInput, matchKeptBy: keptBy });
    const keptUsual = matchKeptBy({ type: stage.type, format, scoreInput, matchKeptBy: "" });
    if (keptNow && keptNow !== keptUsual) customizeParts.push(MATCH_KEPT_BY.find((m) => m.key === keptNow)?.label ?? "");
  }
  const changedHandicaps = stage.handicaps.filter((h) => h.override !== null).length;
  if (changedHandicaps > 0) customizeParts.push(`${changedHandicaps} handicap${changedHandicaps === 1 ? "" : "s"} set for the round`);
  /** The closed row's line: everything the round is, in one place. */
  const rowParts: string[] = [];
  /**
   * WHAT DECIDES THE ROUND, NAMED FOR ALL FOUR — gross included.
   *
   * This read `basis !== "gross"`, so the schema's default was the one value
   * the row never mentioned: a round decided on gross summarised as "Standard
   * settings", on the screen an organizer opens to check what a round is
   * settled on. Read off the seeded festival's gross scramble, 2026-09-20,
   * where it sat under ten rows that each named theirs.
   *
   * Silence is not a safe default for a scoring rule. It is the same fault as
   * the team board announcing "lowest net wins" over a gross round, one screen
   * earlier in the organizer's day: the app knowing the basis and not saying
   * it.
   */
  rowParts.push(
    // A Stableford round is off handicap whatever was stored — `basisFor`
    // (2026-09-28). It printed "Gross scoring" over a round scored off
    // handicap, which is report decision 9.
    isStablefordFormat(format)
      ? "Net scoring"
      : basis === "net"
        ? "Net scoring"
        : basis === "stableford"
          ? "Stableford"
          : basis === "gross"
            ? "Gross scoring"
            : "Gross + net",
  );

  /**
   * AND WHERE IT IS PLAYED, once the club has somewhere else to play.
   *
   * Silent on a one-venue tournament, where the course is the tournament's and
   * repeating it on every row is noise — the same rule the basis follows. The
   * moment a round moves, the venue is the fact that decides that round's
   * card: its pars, its stroke index, how many holes. This screen describes
   * the rounds and said nothing about it, so two rounds at two courses read
   * identically here.
   *
   * Found on the seeded club's first away round, 2026-09-20 — "Foursomes · 9
   * holes · Net scoring", with no way to tell it was the one played at
   * Ardmore. Both cards were listed at the top of the screen with a trust
   * warning each, which makes the omission worse rather than better: the
   * screen knew there were two.
   */
  if (venues.length > 1) {
    const played = venues.find((v) => v.id === stage.courseId)?.name ?? homeVenue;
    if (played) rowParts.push(played);
  }
  /**
   * WHAT GOES INTO THE NEXT ROUND, said on the closed row in a secretary's words
   * (2026-10-16, the review panel). Before a knockout it said "no cut or
   * carry-forward" while the knockout took the top 2 of each flight; and a medal's
   * cut before Round 3 showed on no closed row at all.
   */
  const nextIsDraw = !!nextStage && seededFromQualifiers(nextStage.type);
  if (nextStage && chainsRounds && (showTransition || nextIsDraw || transitionParts.length > 0)) {
    const into = nextIsDraw
      ? qual.mode === "overall"
        ? `top ${qual.overall} overall`
        : `top ${qual.perFlight} per flight`
      : transitionParts.length
        ? transitionParts.join(" · ")
        : "everyone, points start fresh";
    rowParts.push(`Into ${roundLabelOf(allStages, nextStage.id)}: ${into}`);
  } else if (showTransition && !nextStage) {
    rowParts.push("No round after this yet");
  }

  // What this kind of round settles. A Bracket Stage playing off for third and
  // a Single Match Stage resolving to a real pairing both used to read
  // "Standard settings" when closed — so the two settings hardest to reach on
  // this screen were also the only two the summary never mentioned.
  const decidesParts: string[] = [];
  if (stage.type === "Bracket Stage") {
    decidesParts.push(qual.mode === "overall" ? `Top ${qual.overall} overall` : `Top ${qual.perFlight} per flight`);
    // And the shape of the draw, which is half of what a knockout is.
    if (arrangement) decidesParts.push(BRACKET_MODES.find((m) => m.key === arrangement.mode)?.label ?? "");
  }
  if (stage.type === "Single Match Stage" && singleMatch) {
    decidesParts.push(singleMatch.ruleLabel);
  }
  if (stage.type === "Bracket Stage" && thirdPlace) {
    decidesParts.push(thirdPlace.on ? "Plays off for third" : "No play-off for third");
  }

  const summaryParts = [...rowParts, ...customizeParts, ...decidesParts];
  const summaryLine = summaryParts.length ? summaryParts.join(" · ") : "Standard settings";
  /** The row's line beside "Every round": the venue, the customised, what it decides — not the shared three. */
  const sameAsAllLine = [...rowParts.slice(1), ...customizeParts, ...decidesParts].join(" · ");

  // A rotating accent per round so a page of several rounds is scannable at a
  // glance instead of every card reading identically — the round number does
  // the differentiating (not the type icon, which repeats for every
  // Round Robin stage anyway).
  const roundColor = ROUND_PALETTE[stage.position % ROUND_PALETTE.length];
  const roundText = ROUND_TEXT[stage.position % ROUND_TEXT.length];

  /**
   * THE PLAY-BY DATE AND THE WEEKLY SIGN-UP, ON THE FACE WHERE THEY ARE THE
   * ROUND'S BUSINESS (the tournament director on the review panel, 2026-10-16):
   * "when must my match be played by?" is the commonest question a knockout
   * gets, and a league's sign-up count is what the secretary checks every
   * Wednesday. Folded into Customize they were found by nobody. A medal round,
   * played on its day, keeps the deadline in Customize.
   */
  const playByOnFace = isHeadToHead(stage.type);
  const whenDue = (
    <>
            {/* ONE FIELD, NOT A HEADING, A SENTENCE AND A LABEL FOR ONE DATE
                (2026-10-16; the review panel on Ajay's "redundancies"). */}
            <div>
              <div className="field" style={{ width: 190 }}>
                <span className="field-caption">
                  <label htmlFor={`deadline-${stage.id}`}>{playByOnFace ? "Play by" : "Cards in by"}</label>
                  <FieldInfo label="the play-by date">
                    <p>
                      For a round players arrange themselves — a knockout&rsquo;s matches, a week&rsquo;s
                      league game — the last day it may be played and its result entered.
                    </p>
                  </FieldInfo>
                </span>
                {/* A date input, so it opens the platform calendar rather than
                    asking someone to guess a format. The native picker follows
                    `color-scheme`, which the app shell now sets from the club's
                    appearance, so it isn't a white popup on a dark page. */}
                <input
                  id={`deadline-${stage.id}`}
                  className="input"
                  type="date"
                  value={isIsoDate(deadline) ? deadline : ""}
                  // Open while live: `setStageDeadline` is not behind the lock.
                  disabled={pending}
                  onChange={(e) => {
                    const date = e.target.value;
                    const before = deadline;
                    setDeadline(date);
                    startTransition(async () => {
                      const res = await setStageDeadline(stage.id, date);
                      setDueError(res.ok ? "" : res.error ?? "Couldn't save that.");
                      // A refused date is not left in the box as if it were kept.
                      if (!res.ok) setDeadline(before);
                    });
                  }}
                />
                {/* A deadline saved before the round was moved later stays
                    behind it, and cannot be met. Said here, beside the box that
                    changes it (2026-10-30, Ajay's "Due Fri, Oct 23" on a round
                    played on 6 Nov). */}
                {!dueError && dueBeforePlayed(deadline, playedOn) && (
                  <p className="form-error" role="alert" style={{ margin: "4px 0 0" }}>
                    This is before the round is played ({shortDate(playedOn, locale)}). Pick that day or later.
                  </p>
                )}
                {dueError && (
                  <p className="form-error" role="alert" style={{ margin: "4px 0 0" }}>
                    {dueError}
                  </p>
                )}
                {/* Deadlines were free text, so older rounds hold things like
                    "Sat 14 Jun" that a date input cannot show. Rather than
                    render an empty box and let the next save quietly erase it,
                    the old value stays visible until someone picks a date. */}
                {deadline && !isIsoDate(deadline) && (
                  <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.4 }}>
                    Currently &ldquo;{deadline}&rdquo; — pick a date to replace it.
                  </p>
                )}
              </div>
            </div>

            {/* Weekly sign-up, when the league asks the question. A different
                question from either date above — who is playing next week, not
                when this week's scores are due — so it stands on its own rather
                than being sandwiched between the two. The counts keep the
                organizer honest about Wednesday: "18 in" where five are only in
                by default is a different tee sheet from 18 who said so. */}
    </>
  );
  const signUp = (
    <>
            {stage.attendance && (
              <div className="field" style={{ maxWidth: 420 }}>
                <label htmlFor={`opt-deadline-${stage.id}`}>Sign-up deadline</label>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    id={`opt-deadline-${stage.id}`}
                    className="input"
                    type="date"
                    style={{ width: 170 }}
                    defaultValue={isIsoDate(stage.optDeadline) ? stage.optDeadline : ""}
                    disabled={pending}
                    onChange={(e) => {
                      const date = e.target.value;
                      startTransition(async () => {
                        const res = await setStageOptDeadline(stage.id, date);
                        setOptError(res.ok ? "" : res.error ?? "Couldn't save that.");
                      });
                    }}
                  />
                  <span className="text-muted" style={{ fontSize: 13 }}>
                    {stage.attendance.in} in
                    {stage.attendance.inByDefault > 0 && ` (${stage.attendance.inByDefault} by default)`}
                    {" · "}
                    {stage.attendance.out} out
                  </span>
                </div>
                {optError && (
                  <p className="form-error" role="alert" style={{ margin: "4px 0 0" }}>
                    {optError}
                  </p>
                )}
                <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.4 }}>
                  {stage.attendance.playersAnswer
                    ? "Players may answer until the end of this day; after it, changes go through you."
                    : "Players are never asked in this mode — you record the list the captains send in."}{" "}
                  {/* To THIS round's sheet, not to whichever one the tee sheet
                      screen would have picked for itself. A deadline set on
                      Round 6 that sends an organizer to Round 3 is a link that
                      changes the subject. */}
                  <a href={`/foursomes?round=${stage.id}`} style={{ color: "var(--color-accent-200)" }}>
                    Set who is playing
                  </a>
                  .
                </p>
              </div>
            )}

    </>
  );

  // The round's face, its format note and its body, named so they can be drawn in one of two
  // places: unfolded inline (today's screen), or in the side panel (the timeline, behind its
  // switch). One rendered copy either way — never the same controls twice.
  const face = (
    <>
        <div className="field" style={{ width: 200 }}>
          <span className="field-caption" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            Format
            <button
              type="button"
              onClick={() => setFormatInfoOpen((o) => !o)}
              title="About this round"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-neutral-500)", display: "inline-flex" }}
            >
              <Icon name="info" style={{ fontSize: 13 }} />
            </button>
          </span>
          {/* Grouped, because this is where team golf actually lives and a flat
              list of fifteen names does not say which of them need a partner.
              An organizer scanning for "how do we play four-ball" now finds a
              heading rather than having to recognise the name. */}
          {/* Named directly: the caption above holds the ⓘ button, so it
              cannot be the control's label without the button's name riding
              along. Same pattern as the date field below. */}
          <select
            className="input"
            aria-label={`Format for ${roundLabelOf(allStages, stage.id) || "this round"}`}
            value={format}
            disabled={pending || locked}
            onChange={(e) => commitFormat(e.target.value)}
          >
            {/* ONLY WHAT THIS KIND OF ROUND CAN BE SCORED IN — `formatChoicesFor`,
                the list the server also holds `setStageFormat` to. Every format
                was offered for every type, Match Play first on a stroke round. */}
            {(["own", "side"] as const).map((g) => {
              const opts = formatChoicesFor(stage.type, format).filter((c) => c.group === g);
              return opts.length === 0 ? null : (
                <optgroup key={g} label={g === "own" ? "Played on your own" : "Played as a side"}>
                  {opts.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {/* WHAT THIS FORMAT IS, in one line under the choice (Ajay,
              2026-09-28: "keep most of it in the information button"). The
              first sentence only — "Partners play one ball, alternating
              shots…" — is what a newcomer needs while choosing; the full
              description and the round notes stay behind the ⓘ. */}
          {/* ONLY WHERE THE NAME DOES NOT ALREADY SAY IT (2026-10-16, Ajay: "I still see
              redundancies"). Under Match Play it read "Head-to-head, hole-by-hole…" — what every
              golfer knows — and a side format's label in the picker already explains it. Kept for
              the ones a newcomer may not know (Skins, Nassau, Modified Stableford), as Ajay asked on
              2026-09-28: the first sentence shows, the rest stays behind the ⓘ. */}
          {activeFormat && !WELL_KNOWN_FORMATS.has(format) && (formatChoicesFor(stage.type, format).find((c) => c.name === format)?.label ?? format) === format && (
            <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.45 }}>
              {formatTagline(activeFormat.desc)}
            </p>
          )}
          {/* Beside the control that caused it, not in a toast that has gone
              by the time the organizer decides. The COUNT is the decision:
              "re-score 37 cards" is a different question from "change the
              format", and only the server can answer the first. */}
          {formatCards && (
            <RescoreWarning
              cards={formatCards.cards}
              consequence={RESCORE_CONSEQUENCE.format}
              keepLabel={stage.format}
              pending={pending}
              onConfirm={confirmFormat}
              onCancel={() => {
                // Put the dropdown back to what is actually stored, or it
                // keeps showing a format the round does not have.
                setFormat(stage.format);
                setFormatCards(null);
              }}
            />
          )}

          {/* THE OTHER TWO SETTINGS THAT RE-SCORE THE ROUND.
              The format warning above was the only one of the three, and the
              two controls beside it wrote straight through. See
              `enteredCardCount`, whose header already names this whole class:
              "asked before anything that RE-SCORES a round rather than edits
              it". Nothing is deleted by any of them, which is exactly why it
              is quiet — the strokes stay and the results move underneath. */}
          {rescore && (
            <RescoreWarning
              cards={rescore.cards}
              consequence={RESCORE_CONSEQUENCE[rescore.kind]}
              keepLabel={
                rescore.kind === "holes"
                  ? `${stage.holes} holes`
                  : rescore.kind === "venue"
                    ? venues.find((v) => v.id === stage.courseId)?.name ?? "the tournament's course"
                    : BASIS_OPTIONS.find((o) => o.key === stage.scoringBasis)?.label ??
                      stage.scoringBasis
              }
              pending={pending}
              onConfirm={confirmRescore}
              onCancel={cancelRescore}
            />
          )}

          {/* THE ROUND'S TYPE AND ITS FORMAT, DISAGREEING — said beside the
              two controls that set them.

              The type is chosen when the round is added and the format here,
              on a different visit, so the pair is easy to get wrong and
              impossible to see. Two named templates held it until 2026-09-10:
              a charity day drew twelve head-to-head matches for a Stableford
              outing, and every player's own card screen told them their score
              belonged to an opponent.

              A warning rather than a refusal, for the same reason
              `scoring-mismatch.ts` gives one level up: these are real controls
              an organizer sets on purpose, and rewriting one under them would
              be worse than saying so. `roundShapeMismatch` is the one rule,
              read by the templates' own sweep and by this. */}
          {shapeProblem && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                border: "1px solid var(--color-danger)",
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              <b style={{ color: "var(--color-danger)" }}>
                <Icon name="warning-circle" /> This round cannot be scored as set.
              </b>
              <div className="text-muted" style={{ marginTop: 4 }}>{shapeProblem.message}</div>
            </div>
          )}

          {/* Deleting a round is the one destructive control here that asked
              nothing at all, while the format dropdown above it refuses. The
              stake count is separate from the card count on purpose: cards can
              be re-entered from the paper, and money cannot. */}
          {removeCost && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                border: "1px solid var(--color-danger)",
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              <b style={{ color: "var(--color-danger)" }}>
                <Icon name="warning-circle" /> Deleting this round destroys{" "}
                {removeCost.cards > 0 && (
                  <>
                    {removeCost.cards} entered card{removeCost.cards === 1 ? "" : "s"}
                  </>
                )}
                {removeCost.cards > 0 && removeCost.stakes > 0 && " and "}
                {removeCost.stakes > 0 && (
                  <>
                    {removeCost.stakes} paid stake{removeCost.stakes === 1 ? "" : "s"}
                  </>
                )}
                .
              </b>
              <div className="text-muted" style={{ marginTop: 4 }}>
                {removeCost.stakes > 0
                  ? "The skins pot for this round goes with it, including the record of who has already paid in. That record is the only place the money is written down."
                  : "The matches and cards go with it. There is no undo."}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pending || locked}
                  onClick={() => {
                    setRemoveCost(null);
                    startTransition(() => void removeStage(stage.id, true));
                  }}
                >
                  Delete the round anyway
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setRemoveCost(null)}>
                  Keep it
                </button>
              </div>
            </div>
          )}
          {activePending && (
            <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
              This round is set to {activePending.name}, which can be configured but not yet
              scored — {activePending.pendingReason}.
            </p>
          )}
        </div>
        <div className="field" style={{ width: 110 }}>
          {/* A named group, not a caption tied to nothing (the UI/UX designer on the review panel). */}
          <span className="field-caption">Holes</span>
          <div className="seg" role="radiogroup" aria-label={`Holes for ${thisRound || "this round"}`} style={{ width: "100%" }}>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name={`holes-${stage.id}`} checked={holes === 18} disabled={pending || locked} onChange={() => commitHoles(18)} />18
            </label>
            <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
              <input type="radio" name={`holes-${stage.id}`} checked={holes === 9} disabled={pending || locked} onChange={() => commitHoles(9)} />9
            </label>
          </div>
        </div>

        {/* Not on a knockout (2026-10-16): its ties are played over weeks, and Play by
            is the date that matters — two dates for one question was a redundancy. */}
        {!isKnockoutRound(stage.type) && (
        <>
        {/* The day this round is played — and, when a week is rained off, the
            one field the committee needs. Changing it moves this round only;
            the rest of the season and every score already entered stay put. */}
        <div className="field" style={{ width: 172 }}>
          <span className="field-caption">
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
          </span>
          <input
            className="input"
            type="date"
            value={playedOn}
            disabled={pending}
            onChange={(e) => commitPlayedOn(e.target.value)}
            aria-label={`Date ${roundLabelOf(allStages, stage.id) || "this round"} is played`}
          />
          {playedOn && (
            <span className="text-muted" style={{ fontSize: 13, marginTop: 3, display: "block" }}>
              {shortDate(playedOn, locale)}
            </span>
          )}
          {dateRefused && (
            <span role="alert" style={{ fontSize: 13, marginTop: 4, display: "block", color: "var(--color-danger)" }}>
              {dateRefused} <a href="/organization#plan">See plans</a>
            </span>
          )}
        </div>
        </>
        )}

        {/* Which nine, when the round is 9 holes. Front and back have their own
            pars and stroke indexes, so a net round on the back allocates shots
            completely differently — this is not cosmetic. */}
        {holes === 9 && (
          <div className="field" style={{ width: 168 }}>
            <label htmlFor={`nine-${stage.id}`}>Which nine</label>
            <select
              id={`nine-${stage.id}`}
              className="input"
              /* A round scored from cards is scored as the FRONT nine when
                 nothing says otherwise (`applyNine`), so that is what this
                 shows for it — the screen states what the scorer does. */
              value={nineMayStayOpen || nine !== "full" ? nine : "front"}
              disabled={pending || !canSetVenue}
              onChange={(e) => commitVenue(courseId, e.target.value)}
            >
              <option value="front">Front nine</option>
              <option value="back">Back nine</option>
              {/* Front and back was a forced choice, and some rounds
                  genuinely have no one answer: matches going out on both
                  nines at once.

                  OFFERED ONLY WHERE SOMETHING ELSE SAYS WHICH (2026-10-10).
                  In match play each match states its own nine at score
                  entry, so the round can leave it open. A round scored from
                  cards has nowhere else to say it — every card was scored
                  off the front nine's pars and stroke index under a label
                  reading "Not fixed". */}
              {nineMayStayOpen && <option value="full">Not fixed — each match says which</option>}
            </select>
          </div>
        )}

        {/* Only where the tournament rotates venues. One course means the
            whole event is played there and asking would be noise. */}
        {venues.length > 1 && (
          <div style={{ minWidth: 200 }}>
            <CoursePicker
              label="Course"
              // Off: this chooses among the venues the TOURNAMENT already has
              // — "Same as the tournament" is the empty answer — rather than
              // asking where a round is played in general. Adding a venue is
              // Tournament details; moving one round to another of them is
              // this. Stated rather than defaulted, so the narrowness is a
              // decision somebody made.
              searchDirectory={false}
              options={venues}
              value={courseId ?? ""}
              disabled={pending || !canSetVenue}
              noneLabel="Same as the tournament"
              onChange={(id) => commitVenue(id || null, nine)}
            />
          </div>
        )}
        {/* Why those two are greyed out, ON the page — this app's rule is that
            a control's reason is not left to a tooltip. */}
        {!canSetVenue && (holes === 9 || venues.length > 1) && (
          <span className="text-muted" style={{ fontSize: 13, alignSelf: "center" }}>
            The organizer sets where this round is played.
          </span>
        )}
        <button
          type="button"
          className="btn btn-icon"
          // Named for the round, in the house word: a screen reader heard
          // "Remove stage" on a screen where every other word says round.
          title={`Delete ${thisRound || "this round"}`}
          aria-label={`Delete ${thisRound || "this round"}`}
          disabled={pending || locked}
          onClick={() =>
            startTransition(async () => {
              // The server refuses when the round holds results or money, and
              // says how much of each. An empty round still deletes on one press.
              const res = await removeStage(stage.id);
              if (res?.needsConfirm) setRemoveCost({ cards: res.cards ?? 0, stakes: res.stakes ?? 0 });
            })
          }
        >
          <Icon name="trash" />
        </button>
    </>
  );
  const formatInfo = (
    <>
      {expanded && formatInfoOpen && (
        <div className="text-muted" style={{ fontSize: 13, margin: "-8px 0 0 60px", display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={{ margin: 0 }}>{description}</p>
          {/* The whole description here; its first sentence also sits under
              the Format select. */}
          {activeFormat && (
            <p style={{ margin: 0 }}>
              <b style={{ color: "var(--color-accent-200)" }}>{activeFormat.name}</b> — {activeFormat.desc}
            </p>
          )}
        </div>
      )}
    </>
  );
  const body = (
    <>

      {/* OFF HANDICAP OR SCRATCH — on the face of the round, not in Customize
          (2026-10-16). It is the first thing a club decides about a competition
          after the format, and it was behind a fold labelled "Result
          calculation", so a new organizer's medal stayed gross because nobody
          found the choice. Ajay: "made it default as the usual golf clubs play
          and keep the customization in to customize section". The allowance
          that goes with Net sits directly under it. Not on a round scored by
          hand: the committee works its result out, so there is nothing here for
          the app to apply. */}
      {!isManualFormat(format) && (
      <div className="field" style={{ maxWidth: 420, width: "100%" }}>
        <span className="field-caption">
          Handicap
          <FieldInfo label="playing off handicap or scratch">
            <p>
              <b>Net</b> takes each player&rsquo;s handicap strokes off first, so a 20-handicap can
              win — how most club, league and {golfWords.golfGroup} competitions are played. <b>Gross</b> ranks the strokes actually
              taken, as a scratch championship does. <b>Both</b> keeps the two orders of merit from
              one card, for a competition that gives a gross and a net prize.
            </p>
          </FieldInfo>
        </span>
        {isStablefordFormat(format) ? (
          /* STABLEFORD IS PLAYED OFF HANDICAP — the way clubs run it
             (Ajay, 2026-09-28). A scratch competition is stroke play, so
             there is nothing to choose here, and a picker offering
             "Gross" would be offering a result the engine never gave. */
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
            Off handicap — points are worked out after each player&rsquo;s strokes, as
            Stableford is played everywhere. For a scratch competition, choose Stroke Play.
          </p>
        ) : (
          <>
            <div className="seg" role="radiogroup" aria-label={`Handicap for ${thisRound || "this round"}`} style={{ width: "100%" }}>
              {/* The choosable three. A round still HOLDING the legacy
                  `stableford` basis shows none of these checked, and the
                  summary line above still names it — see `BASIS_OPTIONS`. */}
              {BASIS_CHOICES.map((o) => (
                <label key={o.key} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name={`basis-${stage.id}`} checked={basis === o.key} disabled={pending || locked} onChange={() => commitBasis(o.key)} />
                  {o.label}
                </label>
              ))}
            </div>
            {/* Only where the choice needs words (2026-10-16): Gross and Net say themselves. */}
            {basis === "both" && (
              <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
                A gross and a net order of merit from the same cards.
              </p>
            )}
            {/* How strokes are given in a net match, said once (2026-10-16; the golf
                professional on the review panel: a medal states its allowance, a net
                match stated nothing). */}
            {basis === "net" && isHeadToHead(stage.type) && (
              <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.5 }}>
                The higher handicap gets the difference in strokes, on the hardest holes by stroke index.
              </p>
            )}
          </>
        )}
      </div>
      )}

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
            <RoundTeamScoring stageId={stage.id} info={stage.teamScoring} locked={locked} />
          </div>
        </div>
      )}

      {/* Who plays off what, in THIS round. Beside the allowance for the same
          reason the allowance is here: the two together are what a card is
          priced with, and an organizer who fixes a handicap on the roster
          should be able to see, on the round, that the round already has
          one. */}
      {/* An individual net round's allowance. A team round has it in the panel
          above; this is the same line for a medal or a Stableford, which had no
          control at all until 2026-10-13 — and a field under thirty may play at
          100% (Appendix C). */}
      {launched && !isFirst && !seededFromQualifiers(stage.type) && (
        <DrawRound stage={stage} label={thisRound || "this round"} />
      )}
      {stage.allowance && (
        // The line itself starts "Handicap allowance 95%"; a heading saying the same went (2026-10-16).
        <RoundAllowance stageId={stage.id} info={stage.allowance} locked={locked} />
      )}

      {/* What this kind of round settles — at ROUND level, not inside
          "Customize this round".

          These were two levels deep: expand the round, expand Customize, then
          scroll. They are not customizations. A Single Match Stage with no rule
          set is not a customized round, it is an unconfigured one, and its
          picker read "No pairing set" where nobody could see it; a Qualification
          Stage's whole job is the number in here; a third-place play-off is
          something plenty of clubs run every year. Sits beside "Handicaps
          for <format>", which is out here already for exactly this reason.

          The cut and carry-forward deliberately did NOT come with them: those
          are about the round AFTER this one, and they have their own heading
          inside the panel. */}
      <SettingsGroup title="What this round decides">
        {/* One match, paired by a rule rather than by hand. */}
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
              locked={locked}
            />
          </div>
        )}

        {/* ONLY WHERE CLOSING DECIDES SOMETHING, which is a round scored off
            CARDS.

            A bracket files no card at all — its results are BracketWinner rows
            keyed by slot — and a round measured in match points does not reach
            a stroke board, so closing either changes nobody's position. The
            first draft offered this on every non-bracket round and a plain
            Round Robin grew a panel for a lever that does nothing; the guard
            in `render.test.tsx` that says a round deciding nothing of its own
            must stay silent caught it, and was right to.

            Read off the round's own UNIT rather than its type, because a Round
            Robin set to Stroke Play is head-to-head by type and a medal in
            fact — `docs/deferred-register.md` is explicit that on this axis
            you assert the output, not the flag. */}
        {/* Beside the box that makes it, not behind "Customize": on a
            championship the cut is one of the two things this round decides. */}
        {showStrokeCut && nextStage && (
          <div>
            <SectionLabel>The cut</SectionLabel>
            {/* RANKED ON THE TOTAL, which is what `applyStrokeCut` does and what a
                36-hole cut is. This said "ranked on this round's scores", which
                told the organizer of a 54-hole championship that Round 1 would
                not count towards who plays Round 3 (2026-10-16). */}
            <p className="text-muted" style={{ fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>
              Who plays {roundLabelOf(allStages, nextStage.id)}, ranked on
              {roundNumberOf(allStages, stage.id) > 1 ? ` the total after ${thisRound}` : ` ${thisRound || "this round"}`}.
              A tie for the last place is settled the way you choose below. The cut is made when you
              mark this round finished.
            </p>
            <CutControl
              key={nextStage.id}
              formId={stage.id}
              getStageId={async () => nextStage.id}
              roundLabel={roundLabelOf(allStages, nextStage.id)}
              enabled={nextStage.cutEnabled}
              mode={nextStage.cutMode}
              count={nextStage.cutCount}
              percent={nextStage.cutPercent}
              scope={nextStage.cutScope}
              confirmedCount={confirmedCount}
              flightCount={flightCount}
              locked={locked}
              tiesGoThrough
              tieRule={nextStage.cutTies}
            />
          </div>
        )}

        {/* THE DRAW'S SHAPE, ON THE ROUND THAT IS THE DRAW (2026-10-16).
            One bracket, Main + plate, two or several flights was chosen only on
            the Bracket screen, which an organizer reaches after setting up —
            so a club wanting "a qualifying match: the winner into the winners'
            bracket, the loser into a consolation" built the rounds here and
            could not find the word for it (Ajay, describing exactly Main +
            plate). Same picker, same organizer-only and lock rules. */}
        {isKnockoutRound(stage.type) && arrangement && (
          <div>
            <BracketModePicker mode={arrangement.mode} secondLabel={arrangement.secondLabel} readOnly={!arrangement.canChange} locked={locked} embedded />
          </div>
        )}

        {stage.type === "Bracket Stage" && thirdPlace && (
          <div>

            <ThirdPlaceControl
              stageId={stage.id}
              on={thirdPlace.on}
              problem={thirdPlace.problem}
              aName={thirdPlace.aName}
              bName={thirdPlace.bName}
              made={thirdPlace.made}
              locked={locked}
            />
          </div>
        )}

        {/* ON THE BRACKET, because how many players a bracket takes is the
            bracket’s own business. This used to sit on a "Qualification Stage" —
            a stage the field never played, whose only job was to host this
            control and whose settings were the EVENT’s anyway. The stage went;
            the question it asked is real and stayed. */}
        {/* NOTHING TO CUT ON when the bracket is the first round: there is no
            qualifying round to rank anybody, so `loadEventState` puts the whole
            field in the draw. Offering "Top 2 per flight" here was offering a
            setting that — before 2026-09-26 — silently left half a club's
            entrants out of its knockout. */}
        {stage.type === "Bracket Stage" && (
          allStages.findIndex((s) => s.id === stage.id) === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5, maxWidth: "62ch" }}>
            This bracket is the first round, so everyone in the field goes into the draw, seeded in order —
            there is no qualifying round to cut from. Add a round before it to qualify into it instead.
          </p>
        ) : (
          <div>
            <SectionLabel>
              Qualification cut
              <FieldInfo label="the qualification cut">
                <p>{QUALIFICATION_CUT_HELP}</p>
                <p>{CUT_SCOPE_HELP}</p>
              </FieldInfo>
            </SectionLabel>
            <QualControl mode={qual.mode} perFlight={qual.perFlight} overall={qual.overall} locked={locked} flightCount={flightCount} fieldSize={confirmedCount} />
          </div>
          )
        )}
      </SettingsGroup>

      {/* BEFORE THE NEXT ROUND, ON THE FACE OF A ROUND ROBIN (2026-10-16).
          It was inside Customize. In a match-play event of groups — two round
          robins and a knockout, the shape Ajay asked to be walked — what carries
          into the next round, who survives a cut and drawing that round's
          matches are what the round is FOR, and the carry question used to open
          Customize by itself to be seen. A golf pro would not call any of it a
          customisation. */}
      {showTransition && (
        <SettingsGroup
          title={
            <>
              Before the next round
              <FieldInfo label="the cut line and carry-forward">
                <p>{ROUND_CUT_HELP}</p>
                <p>{CUT_SCOPE_HELP}</p>
              </FieldInfo>
            </>
          }

        >
          <NextRoundTransition key={nextStage?.id ?? "none"} stageId={stage.id} nextStage={nextStage} allStages={allStages} confirmedCount={confirmedCount} flightCount={flightCount} carry={carryPrompt} />
        </SettingsGroup>
      )}

      {playByOnFace && whenDue}
      {signUp}

      {/* ON THE DAY: the two controls about PLAY, once there is play to speak
          of (`underWay`). At setup they were noise with a trap in it — ticking
          "This round is finished" on an unplayed round leaves everybody without
          a place. A round that is already closed, or has a card, shows them
          whatever the tournament's status. */}
      {underWay && (
        <SettingsGroup title="On the day">
          {stage.type !== "Bracket Stage" &&
            standingsUnit(stage.format, stage.scoringBasis) !== "match points" && (
            <div>
              <SectionLabel>Is this round over?</SectionLabel>
              <RoundClosedControl
                stageId={stage.id}
                closed={stage.closed}
                pointsBoard={isStablefordRound(stage.scoringBasis, stage.format)}
              />
            </div>
          )}
          {/* Under the date it overrules, which is in Customize: closing a
              round's scoring early is a decision made on the day. */}
          <div>
            <SectionLabel>Scoring window</SectionLabel>
            <RoundDeadlineControl
              stageId={stage.id}
              roundLabel={thisRound}
              deadline={deadline}
              today={today}
              override={stage.deadlineOverride}
              // Open while live: closing or reopening scoring is a
              // decision made on the day (2026-09-27).
              locked={pending}
            />
          </div>
        </SettingsGroup>
      )}

      <div>
        <button
          type="button"
          aria-expanded={customizeOpen}
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
            minHeight: 44,
            cursor: "pointer",
            textAlign: "left",
            color: "var(--color-text)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, flex: "none", color: "var(--color-text)" }}>
            <Icon name={customizeOpen ? "ph ph-caret-down" : "ph ph-caret-right"} style={{ color: "var(--color-accent-200)" }} />
            <Icon name="sliders" style={{ color: "var(--color-accent-200)" }} />
            Customize this round
          </span>
          {/* Wraps rather than trailing off: it is the only thing the button says
              about what is inside, and on a phone the ellipsis hid all of it
              (the UI/UX designer on the review panel). */}
          {!customizeOpen && (
            <span className="text-muted" style={{ fontSize: 13, textAlign: "right", minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
              {[roundRaisesTies ? "Ties" : "", customizeParts.join(" · ")].filter(Boolean).join(" · ")}
            </span>
          )}
        </button>

        {/* In the page while closed, as a closed round card is: a draft in it
            survives closing, and the guards that read the card see every control. */}
        {(
          <div style={{ display: customizeOpen ? "flex" : "none", flexDirection: "column", gap: 16, marginTop: 12 }}>
            {/* TIES, FIRST UNDER CUSTOMIZE (2026-10-16). Ajay could not find the
                tiebreakers — on a phone, a tablet or a computer: they were at the
                foot of Customize inside ~2,000px of points and checkbox chains, and
                a knockout or a medal said nothing at all. One line per tie question,
                the rule in use in words, Change where there is a choice (the review
                panel: docs/tiebreak-brief-2026-10-16.md) — and, Ajay: "as part of
                the customize", so first in it, named on its closed bar. */}
            {roundRaisesTies && (
              <SettingsGroup
                title={stage.type === "Round Robin" ? "Ties and points" : "Ties"}
                blurb={stage.type === "Round Robin" ? "Ties and points are the same for every round robin in this tournament." : undefined}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {(isKnockoutRound(stage.type) || stage.type === "Single Match Stage") && (
                    <TieRow
                      question={`All square after ${holes}`}
                      rule={basis === "gross" ? "extra holes from the 1st, hole by hole" : "extra holes from the 1st, hole by hole, strokes given as in the round"}
                    />
                  )}
                  {stage.type === "Round Robin" && format === "Match Play" && (
                    <TieRow question={`A match all square after ${holes}`} rule={matchTieInWords(matchTiebreakers, holes)}>
                      <MatchTiebreakControl selected={matchTiebreakers} holes={holes} locked={pending || locked} />
                    </TieRow>
                  )}
                  {stage.type === "Round Robin" && (
                    <TieRow question="Level in the table" rule={tableTieInWords(tiebreakers, format === "Match Play" || entryModeFor(format) === "team" ? "" : individualTieBreak(basis, format))}>
                      <TableTiebreakControl tiebreakers={tiebreakers} locked={locked} />
                    </TieRow>
                  )}
                  {/* Points are scoring, not a tie rule; they share this group because they too
                      are set once for every round robin (2026-10-16). */}
                  {stage.type === "Round Robin" && (
                    <TieRow question="Points for a match" rule={pointsInWords(scoring)}>
                      <PointsControl initial={scoring} locked={locked} />
                    </TieRow>
                  )}
                  {stage.type === "Stroke Play Round" && !isManualFormat(format) && (isIndividualStrokeRound(stage) || entryModeFor(format) === "team") && (
                    <TieRow
                      question={`${entryModeFor(format) === "team" ? "Sides level" : "Level"} on ${chainsRounds && roundNumberOf(allStages, stage.id) > 1 ? "the total" : "the round"}`}
                      rule={`countback on ${chainsRounds && roundNumberOf(allStages, stage.id) > 1 ? "the last round's" : "the"} card — ${countbackInWords(holes)}; anybody still level shares the place`}
                    />
                  )}
                </div>
              </SettingsGroup>
            )}
            {/* Only where the format offers a choice at all — which is the
                "opt out, not opt in" rule made visible. Every other round
                takes a card and has nothing to decide, so it gets no control
                rather than a control with one option in it. */}
            {inputChoices(format).length > 1 && (
              <div className="field" style={{ maxWidth: 420, width: "100%" }}>
                <span className="field-caption">
                  How scores are recorded
                  <FieldInfo label="how scores are recorded">
                    <p>
                      Separate from <b>Handicap</b> on the round itself, and the distinction is the
                      point: gross or net is what the round is played FOR, this is what the field
                      writes DOWN.
                    </p>
                    <p>
                      A full card is the raw fact — net, Stableford and every tiebreaker are
                      readings of it, so a card can be re-scored if the round changes from gross to
                      net. Hole results and a final margin cannot: the strokes were never recorded.
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {MATCH_ENTRY_MODES.filter((m) => inputChoices(format).includes(m.key)).map((m) => (
                        <li key={m.key}>
                          <b>{m.label}</b> — {m.blurb}
                        </li>
                      ))}
                    </ul>
                    <p>
                      Ask for cards from a match-play day when you want the round to count for
                      handicapping. Under WHS a match-play score is acceptable only when a full
                      card is returned.
                    </p>
                  </FieldInfo>
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {inputChoices(format).map((key) => {
                    const info = MATCH_ENTRY_MODES.find((m) => m.key === key);
                    const natural = key === declaredInput(format);
                    return (
                      <label key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                        <input
                          type="radio"
                          name={`score-input-${stage.id}`}
                          // "" resolves to the format's own answer, so the
                          // natural option is the one lit when nobody has
                          // chosen — the round is not silently overridden.
                          checked={scoreInput === key || (scoreInput === "" && natural)}
                          disabled={pending || locked}
                          // Choosing the natural input CLEARS the override
                          // rather than storing it. A round that says nothing
                          // follows its format when the format's mind changes.
                          onChange={() => commitScoreInput(natural ? "" : key)}
                          style={{ marginTop: 3 }}
                        />
                        <span>
                          {SCORE_WORDS[key] ?? info?.label ?? key}
                          {/* Each option's explanation is in the ⓘ above (2026-10-16, "redundancies"). */}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* HOW PLAYERS KEEP THEIR MATCHES (Ajay, 2026-10-19: "provide both
                options for organizer to decide while setting up the
                tournament"). Only on a round with matches whose format does
                not already carry the choice above — Match Play and Nassau ask
                it as "How scores are recorded", and one choice never gets two
                controls. */}
            {(() => {
              const kept = matchKeptBy({ type: stage.type, format, scoreInput, matchKeptBy: keptBy });
              if (kept === null || keptByScoreInput(format)) return null;
              return (
                <div className="field" style={{ maxWidth: 420, width: "100%" }}>
                  <span className="field-caption">
                    How players keep their matches
                    <FieldInfo label="how players keep their matches">
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {MATCH_KEPT_BY.map((m) => (
                          <li key={m.key}>
                            <b>{m.label}</b> — {m.detail}
                          </li>
                        ))}
                      </ul>
                      <p>
                        A round is kept one way, so choose before anyone scores: once a match has a
                        score the choice stays as it is.
                      </p>
                    </FieldInfo>
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {MATCH_KEPT_BY.map((m) => (
                      <label key={m.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                        <input
                          type="radio"
                          name={`match-kept-by-${stage.id}`}
                          checked={kept === m.key}
                          disabled={pending || locked}
                          onChange={() => commitKeptBy(m.key)}
                          style={{ marginTop: 3 }}
                        />
                        <span>{m.label}</span>
                      </label>
                    ))}
                  </div>
                  {keptByRefusal && (
                    <p role="alert" style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
                      {keptByRefusal}
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Was two headings for one thing: a group titled "On the day"
                blurbed "whether scores can still go in", holding one control
                labelled "Scoring window" blurbed "Whether scores can still be
                entered for this round." Said once now — the trap this pass
                walked into on PlaySettings, already sitting here.

                And the deadline itself has moved INTO the group. It was four
                sections and a group boundary away, while two comments still
                described them as adjacent: the one below claiming "directly
                under the date", and RoundDeadlineControl's own footer, which
                says "Scoring follows the completion deadline above." Both are
                true again. */}
            {!playByOnFace && whenDue}

            {/* Was "Cut line &amp; carry-forward — before the next round" —
                an ampersand heading naming two of the THREE things beneath it.
                The third is the Generate pairings button, and nobody looking
                for "how do I draw Round 2" would look under a heading about cut
                lines. Renamed to cover the handover itself; no sub-headings
                added, because each control below already labels itself and a
                heading that repeats the label under it is the trap this pass
                walked into on its own first screen. */}

            {/* POINTS ARE SCORING, NOT A TIEBREAK (2026-10-16; the review panel). They
                shared one block with the table's tie chain under "Tiebreakers"; the tie
                chain is on the face now, under Ties. One line here, the figures on Change. */}


            {/* A committee's own figure for one player in one round — a visitor's
                handicap, a correction for the day. Real, and rare: in Customize,
                not on the face of every round. */}
            {stage.handicaps.length > 0 && (
              <div>
                <SectionLabel>Handicaps for this round</SectionLabel>
                <div style={{ marginTop: 6 }}>
                  <RoundHandicaps stageId={stage.id} rows={stage.handicaps} roundName={roundLabelOf(allStages, stage.id) || "this round"} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div
      id={`round-${stage.id}`}
      className="card elev-sm"
      // Clear of the sticky header when a new round is scrolled to. A CLOSED
      // round is a row, so it is padded as one (2026-10-16): ten closed rounds
      // were 76px each, the card's padding outweighing the line it held.
      style={{
        gap: 14,
        borderLeft: `3px solid ${roundColor}`,
        scrollMarginTop: 88,
        ...(expanded ? {} : { paddingTop: 8, paddingBottom: 8 }),
      }}
    >
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
          <span style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="warning" />
            {chainWarnings.length === 1 ? "Check this round follows on" : "Check how this round follows on"}
          </span>
          {chainWarnings.map((w, i) => (
            <p key={i} className="text-muted" style={{ fontSize: 13, margin: 0 }}>{w}</p>
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
            color: roundText,
            fontFamily: "var(--font-heading)",
            fontWeight: 700,
            fontSize: 19,
          }}
          title={stage.type}
        >
          {/* The tournament's own count (`roundNumber`), which closes up when a
              round is removed and does not count a cut. Was the stored position
              plus one: after deleting Round 1 this list read 2, 3, 4 under a
              banner calling the same rounds 1 and 2. */}
          {roundNumberOf(allStages, stage.id) || "–"}
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
              {thisRound || stage.type}
              {thisRound && (stage.playedOn ? ` · ${shortDate(stage.playedOn, locale)}` : ` · ${stage.type}`)}
            </span>
            {/* ONLY ONCE THERE IS SOMETHING TO SAY. Before a ball is struck every
                round is simply set up, and the chips said otherwise: on a draft
                tournament with no cards, an undated Round 1 read "Played" and
                Round 2 "Active" (2026-10-16). */}
            {underWay && !notGenerated && (
              <span className="tag tag-neutral">
                {standing === "active" ? "In play" : standing === "played" ? "Played" : "Upcoming"}
              </span>
            )}
            {notGenerated && (
              <span className="tag tag-neutral"><Icon name="clock" /> Not drawn yet</span>
            )}
            {/* Pinned to the right edge rather than trailing the last tag.
                A disclosure chevron is the affordance for the whole row, and
                sitting wherever the tags happen to end put it in a different
                place on every round — after "Active" on one, after "Not
                generated yet" on another, and mid-line once a long round name
                wrapped. `auto` margin is what makes it the same target on
                every card whatever the title length. */}
            <Icon name={expanded ? "ph ph-caret-up" : "ph ph-caret-down"}
              style={{ fontSize: 13, color: "var(--color-neutral-500)", marginLeft: "auto" }}
            />
          </div>
          {!expanded && (
            // Everything the closed row needs to be useful: what it plays,
            // over how many holes, and the settings summary the card already
            // computed for the "Customize" panel.
            // ONE LINE WHERE "EVERY ROUND" HAS SAID THE REST (2026-10-16): a
            // ten-week league repeated "Stableford · 18 holes · Off handicap"
            // ten times. Only what this round adds is said, and nothing at all
            // when it adds nothing.
            sharedWithAll ? (
              sameAsAllLine && (
                <div className="text-muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>
                  {sameAsAllLine}
                </div>
              )
            ) : (
              <div className="text-muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>
                {stage.format} · {stage.holes} holes · {summaryLine}
              </div>
            )
          )}
        </button>
        {/* Every control on this card saves the moment it changes, and this says
            so — in the header row, OUTSIDE the round's button: inside it, "Saved"
            became part of the round's name to a screen reader ("Round 2 · … Saved",
            the UI/UX designer on the review panel). Still a live region. */}
        <SaveState status={saveStatus} />
        {/* `display: contents` rather than a conditional render: these fields
            are flex children of the header row, and wrapping them in an
            ordinary div when open would change the layout. Contents makes the
            wrapper vanish from the box tree; none takes the lot away. */}
        {!asPanel && <div style={{ display: expanded ? "contents" : "none" }}>{face}</div>}
      </div>

      {!asPanel && formatInfo}


      {/* Everything below is the round's configuration, folded away when the
          card is closed. The chain warnings above stay visible either way:
          "this round doesn't follow on from the last one" is the one thing an
          organizer must see without opening anything. */}
      {!asPanel && <div style={{ display: expanded ? "contents" : "none" }}>{body}</div>}

      {/* THE TIMELINE (behind its switch, 2026-10-30): the same face and body, in the side panel,
          inside this card in the page so every test's `#round-<id>` still finds them. Kept
          mounted while closed, as the inline card always was. */}
      {asPanel && (
        <SidePanel
          keepMounted
          open={expanded}
          title={thisRound || stage.type}
          kicker={[stage.playedOn ? shortDate(stage.playedOn, locale) : "", stage.type].filter(Boolean).join(" · ")}
          onClose={onToggle}
          footer={<SaveState status={saveStatus} />}
        >
          <div className="round-panel-face">{face}</div>
          {formatInfo}
          {body}
        </SidePanel>
      )}
    </div>
  );
}

/**
 * WHAT EVERY ROUND SHARES, SET ONCE (2026-10-16).
 *
 * Ajay, the same day: "the Rounds and format looks pretty long specially for
 * multi round tournament". A ten-week Stableford league was ten cards to open,
 * each to set the same format, holes and handicap — and ten two-line rows to
 * scroll past to see that they were the same. So, from three playing rounds:
 * one line saying what they share, and one place to change it for every round
 * nobody has played yet.
 *
 * It goes through the SAME actions a round's card uses, one round at a time, so
 * each refusal still applies: a format a round cannot be scored in is not
 * offered here either (`formatChoicesFor`, narrowed to what every round can
 * take), and a round holding a card is left as it is and named — re-scoring
 * a played round stays a decision made on that round's own card.
 */
/**
 * The countback ladder in words, read off the rule the boards apply
 * (`countbackSegments`) so the sentence cannot say one ladder while the
 * board climbs another.
 */
function countbackInWords(holes: number): string {
  const steps = countbackSegments(holes).map((n) => (n === 1 ? "the last hole" : `the last ${["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? n}`));
  if (steps.length === 0) return "the card";
  if (steps.length === 1) return `the better ${steps[0].replace(/^the /, "")}`;
  return `the better ${steps[0].replace(/^the /, "")}, then ${steps.slice(1, -1).join(", ")}${steps.length > 2 ? " and " : ""}${steps.length > 2 ? steps[steps.length - 1] : steps[1]}`;
}

/** A round's gross/net as it plays: a Stableford round is off handicap whatever is stored (`basisFor`). */
function basisOf(s: StageView): string {
  return isStablefordFormat(s.format) ? "net" : s.scoringBasis;
}

function EveryRound({
  rounds,
  resultIds,
  onDone,
}: {
  /** The playing rounds, in order. */
  rounds: StageView[];
  /** Rounds with a card or a result — left alone. */
  resultIds: string[];
  onDone: (said: string) => void;
}) {
  const locked = React.useContext(SetupLocked);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const same = <T,>(f: (s: StageView) => T): T | null => {
    const first = f(rounds[0]);
    return rounds.every((s) => f(s) === first) ? first : null;
  };
  const format = same((s) => s.format);
  const holes = same((s) => s.holes);
  const basis = same(basisOf);
  // Where the rounds differ, nothing is chosen, and nothing is changed unless
  // somebody chooses: "" and 0 mean "leave each as it is".
  const [f, setF] = useState(format ?? "");
  const [h, setH] = useState<number>(holes ?? 0);
  const [b, setB] = useState(basis ?? "");
  // Only what EVERY round can be scored in: a list for one type, narrowed by each
  // other type — and the format they all hold, offered even where the list would
  // not (an Alternate Shot season), so the box never shows a value the rounds do
  // not have (the QA manager on the review panel).
  const types = [...new Set(rounds.map((s) => s.type))];
  const choices = formatChoicesFor(types[0], format ?? "").filter(
    (c) => c.name === format || types.every((t) => formatChoicesFor(t).some((o) => o.name === c.name)),
  );
  /**
   * WHAT "EVERY ROUND" MAY CHANGE: not closed, nothing returned — and, once the
   * tournament is live, not a round whose day has come (the tournament director
   * on the review panel: the round being played today, before its first card, was
   * re-formatted by Apply).
   */
  const launched = React.useContext(Launched);
  const today = React.useContext(ServerToday);
  const dayHasCome = (s: StageView) => !s.playedOn || !today || s.playedOn <= today;
  const unplayed = rounds.filter((s) => !s.closed && !resultIds.includes(s.id) && !(launched && dayHasCome(s)));
  const played = rounds.filter((s) => !unplayed.includes(s));
  const names = (list: StageView[]) => list.map((s) => roundLabelOf(rounds, s.id)).join(", ");

  const sharedWords = [
    format ?? "mixed formats",
    holes ? `${holes} holes` : "mixed holes",
    basis === "gross" ? "gross" : basis === "both" ? "gross and net" : basis === "net" ? "net" : "mixed handicaps",
  ].join(" · ");

  const apply = () =>
    startTransition(async () => {
      // WHY each round was left, said truthfully (the QA manager and the UI/UX
      // designer on the review panel): a refusal was reported as "has scores", and
      // a basis refused for another reason was counted as changed.
      const hasScores = new Set<string>();
      const refused = new Set<string>();
      const note = (id: string, r: unknown) => {
        if (!r || typeof r !== "object" || (r as { ok?: boolean }).ok !== false) return;
        if ((r as { needsConfirm?: boolean }).needsConfirm) hasScores.add(id);
        else refused.add(id);
      };
      for (const s of unplayed) {
        try {
          if (f && f !== s.format) note(s.id, await setStageFormat(s.id, f));
          if (h && h !== s.holes) note(s.id, await setStageHoles(s.id, h));
          if (b && !isStablefordFormat(f || s.format) && b !== s.scoringBasis) note(s.id, await setStageScoringBasis(s.id, b));
        } catch {
          refused.add(s.id);
        }
      }
      const changed = unplayed.filter((s) => !hasScores.has(s.id) && !refused.has(s.id));
      const scored = [...played, ...unplayed.filter((s) => hasScores.has(s.id))];
      const refusedRounds = unplayed.filter((s) => refused.has(s.id) && !hasScores.has(s.id));
      onDone(
        [
          `${changed.length} round${changed.length === 1 ? "" : "s"} changed.`,
          scored.length ? `Left as they were, because play has begun: ${names(scored)} — change those on their own cards.` : "",
          refusedRounds.length ? `Not changed: ${names(refusedRounds)} — the change was refused; open the round to see why.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      setOpen(false);
    });

  return (
    <div className="card elev-sm" style={{ gap: 10 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-text)", textAlign: "left", font: "inherit", minHeight: 44 }}
      >
        <Icon name="stack" style={{ color: "var(--color-accent-200)", flex: "none" }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Every round</span>
          <span className="text-muted" style={{ display: "block", fontSize: 13, lineHeight: 1.45 }}>
            All {rounds.length}: {sharedWords}
          </span>
        </span>
        <Icon name={open ? "caret-up" : "caret-down"} style={{ marginLeft: "auto", fontSize: 13, color: "var(--color-neutral-500)", flex: "none" }} />
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field" style={{ minWidth: 200, flex: "1 1 200px" }}>
              <label htmlFor="every-format">Format</label>
              <select id="every-format" className="input" value={f} disabled={pending || locked} onChange={(e) => setF(e.target.value)}>
                {!format && <option value="">Leave each as it is</option>}
                {choices.map((c) => (
                  <option key={c.name} value={c.name}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ width: 110 }}>
              <span className="field-caption">Holes</span>
              <div className="seg" role="radiogroup" aria-label="Holes for every round" style={{ width: "100%" }}>
                {[18, 9].map((n) => (
                  <label key={n} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                    <input type="radio" name="every-holes" checked={h === n} disabled={pending || locked} onChange={() => setH(n)} />
                    {n}
                  </label>
                ))}
              </div>
            </div>
            {!isStablefordFormat(f) && (
              <div className="field" style={{ flex: "1 1 220px" }}>
                <span className="field-caption">Handicap</span>
                <div className="seg" role="radiogroup" aria-label="Handicap for every round" style={{ width: "100%" }}>
                  {BASIS_CHOICES.map((o) => (
                    <label key={o.key} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                      <input type="radio" name="every-basis" checked={b === o.key} disabled={pending || locked} onChange={() => setB(o.key)} />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            {/* What Apply will do, named before it is pressed (the UI/UX designer on
                the review panel) — and "play has begun" rather than "has scores",
                since a round whose day has come is left too. */}
            {unplayed.length === 0
              ? "Play has begun in every round, so each is changed on its own card."
              : `Changes ${unplayed.length === rounds.length ? `all ${rounds.length} rounds` : names(unplayed)}` +
                (() => {
                  const to = [
                    f && f !== format ? f : "",
                    h && h !== holes ? `${h} holes` : "",
                    b && b !== basis ? (b === "gross" ? "gross" : b === "both" ? "gross and net" : "net") : "",
                  ].filter(Boolean);
                  return to.length ? ` to ${to.join(", ")}` : "";
                })() +
                "." +
                (played.length ? ` Play has begun in ${names(played)}, so ${played.length === 1 ? "it stays" : "they stay"} as ${played.length === 1 ? "it is" : "they are"}.` : "")}
          </p>
          <div>
            <button type="button" className="btn btn-primary" disabled={pending || locked || unplayed.length === 0} onClick={apply}>
              {pending ? "Changing…" : `Apply to ${unplayed.length === rounds.length ? "every round" : `the ${unplayed.length} unplayed rounds`}`}
            </button>
          </div>
        </div>
      )}
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
  homeVenue = "",
  chainsRounds = true,
  activeStageId = null,
  roundsWithResults = [],
  singleMatches,
  thirdPlaces,
  canSetVenue = true,
  locked = false,
  launched = false,
  arrangement = null,
  today,
  timeline = false,
}: {
  /**
   * THE REDESIGN, BEHIND ITS SWITCH (2026-10-30): rounds as a timeline, the open one in a side
   * panel. Off by default; `?view=timeline` turns it on for a preview. Agreed by the panel: no
   * control renamed or moved out of its card, no data read or written differently.
   */
  timeline?: boolean;
  stages: StageView[];
  /** The knockout's arrangement, for a Bracket round's "The draw". */
  arrangement?: Arrangement | null;
  /** The tournament has been launched — see `Launched`. */
  launched?: boolean;
  /** Today, yyyy-mm-dd, from the server — see `ServerToday`. */
  today: string;
  /** Organizer only — see `StageCard`'s prop of the same name. */
  canSetVenue?: boolean;
  /** Setup is locked — provided to every card through `SetupLocked`. */
  locked?: boolean;
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
  venues?: Array<{ id: string; name: string; cardNote?: PickedCardNote | null }>;
  /** The tournament's own course. Only used when `venues` has more than one. */
  homeVenue?: string;
  /** Whether rounds feed each other — false for a single-round tournament. */
  chainsRounds?: boolean;
  /** The round actually being played, decided on the server so this screen
   *  and every other one name the same round. */
  activeStageId?: string | null;
  /**
   * Ids of the rounds somebody has returned something for — one hole is
   * enough. See `roundsWithResults`.
   *
   * Because `activeStageId` is a single pointer and a tournament does not play
   * its rounds strictly one at a time: a round robin stays active while its
   * results are confirmed and the medal round after it is scored meanwhile.
   * Defaults to empty, so a caller not yet taught chips exactly what it
   * chipped before.
   */
  roundsWithResults?: string[];
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
  // The club's own date order — see `shortDate`.
  const { locale } = useFormatting();
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
  /**
   * Whether the round builder is open.
   *
   * It is the whole point of this screen while there are no rounds, and the
   * largest thing on it once there are. With four rounds built, an
   * always-open builder — two groups of type cards, five fields and a button —
   * was taller than the list of rounds it sat under, so the screen's answer to
   * "what is this tournament playing" was mostly a form for adding another
   * one.
   *
   * So: open when there is nothing yet, because the only useful act on an
   * empty screen is the one it contains; shut afterwards, behind a control
   * that says what it opens.
   *
   * IT STAYS OPEN AFTER AN ADD. Somebody who has just added a round is the
   * likeliest person in the world to add another, and closing a panel under
   * the hands of the person who deliberately opened it is the app taking
   * something away as a reward for using it.
   */
  const [addOpen, setAddOpen] = useState(stages.length === 0);
  /**
   * WHAT KIND OF ROUND — asked, not assumed.
   *
   * This opened on `STAGE_TYPES[0]`, which is Round Robin, so the Add button
   * read "Add round robin" before anybody had looked at the five cards, and
   * the sentence under it promised "a full set of pairings" for a tournament
   * that might be a club medal. On the commonest path — open the screen, press
   * the obvious button — the app chose the round type and the organizer never
   * knew there had been a choice.
   *
   * A round's type is not a label. It decides what is DRAWN: `stage-types.ts`
   * records a round robin set to stroke play as "a full set of pairings for a
   * round in which nobody plays anybody", which is what a defaulted type
   * produces the moment the format is not the one it assumed.
   *
   * Empty until picked, and Add stays disabled — the same rule the tournament
   * builder and the casual round now follow.
   */
  const [newType, setNewType] = useState<StageTypeKey | "">("");
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
  const [addRefused, setAddRefused] = useState("");
  const [pending, startTransition] = useTransition();
  /**
   * A TYPE BRINGS ITS FORMAT WITH IT — the one clubs play it in — and keeps
   * the organizer's own choice where that still fits (2026-10-16).
   *
   * The format used to wait at "Choose…" until picked, because a defaulted
   * format once produced a stroke round labelled Match Play. That default was
   * the EVENT's, not the type's; `naturalFormatFor` is the type's, and the list
   * below offers nothing the type cannot score, so the old failure cannot
   * recur. A choice that no longer fits — Match Play kept from a round robin,
   * then Stroke play round chosen — is replaced rather than carried into the
   * next Add, which is what the walk found.
   */
  const pickType = (t: StageTypeKey) => {
    setNewType(t);
    setBulkFormat((cur) => (cur && formatChoicesFor(t).some((c) => c.name === cur) ? cur : naturalFormatFor(t)));
  };

  /**
   * THE ROUND JUST ADDED IS OPENED AND BROUGHT INTO VIEW (2026-10-04).
   *
   * `openRound` is decided once, when the screen loads, so a tournament's first
   * round arrived closed — and above the builder, which stays open after an
   * add. On a phone that is off the top of the screen: the organizer pressed
   * "Add stroke play round" and saw nothing change. Found walking a new club's
   * first medal in `e2e/organizer-medal.spec.ts`.
   */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  useEffect(() => {
    if (!justAdded || !stages.some((s) => s.id === justAdded)) return;
    document.getElementById(`round-${justAdded}`)?.scrollIntoView({ block: "start" });
    setJustAdded(null);
  }, [justAdded, stages]);

  const activeIndex = stages.findIndex((s) => s.id === activeStageId);
  /** The playing rounds, and — from three of them — what they all share (`EveryRound`). */
  const playing = stages.filter((s) => isPlayingRound(s.type));
  const [everyNote, setEveryNote] = useState("");
  const shared =
    // The same reading of the basis as `EveryRound` (`basisOf`): two readers of
    // "do they all match" disagreed on Stableford rounds (the QA manager).
    playing.length >= 3 && playing.every((s) => s.format === playing[0].format && s.holes === playing[0].holes && basisOf(s) === basisOf(playing[0]))
      ? { format: playing[0].format, holes: playing[0].holes, basis: playing[0].scoringBasis }
      : null;

  // Where the rounds don't fit together. Rounds chain — standings carry
  // forward, cuts pick the next field from the last round's results — and that
  // silently assumes consecutive rounds measure the same thing. Once any round
  // can be any format, they often don't.
  const chain = chainIssues(
    stages.map((s) => ({
      id: s.id,
      position: s.position,
      type: s.type,
      format: s.format,
      scoringBasis: s.scoringBasis,
      carryForwardEnabled: s.carryEnabled,
      cutEnabled: s.cutEnabled,
    })),
  );

  return (
    <ServerToday.Provider value={today}>
    <Launched.Provider value={launched}>
    <SetupLocked.Provider value={locked}>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {playing.length >= 3 && (
        <EveryRound rounds={playing} resultIds={roundsWithResults} onDone={setEveryNote} />
      )}
      {everyNote && (
        <p role="status" className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          <Icon name="check-circle" /> {everyNote}
        </p>
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
            canSetVenue={canSetVenue}
            allStages={stages}
            singleMatch={singleMatches?.[s.id] ?? null}
            thirdPlace={thirdPlaces?.[s.id] ?? null}
            hasResult={roundsWithResults.includes(s.id)}
            sharedWithAll={shared}
            arrangement={arrangement}
            asPanel={timeline}
            expanded={openRound === s.id}
            onToggle={() => setOpenRound((cur) => (cur === s.id ? null : s.id))}
            isFirst={i === 0}
            standing={roundStanding({
              isActive: activeStageId === s.id,
              index: i,
              activeIndex,
              // Asking the ROUND rather than its index. See `roundStanding`:
              // this chipped Round 2 "Upcoming" with seven cards in.
              hasResult: roundsWithResults.includes(s.id),
            })}
            nextStage={nextStage}
            rrMatchesPerPlayer={rrMatchesPerPlayer}
            scoring={scoring}
            tiebreakers={tiebreakers}
            matchTiebreakers={matchTiebreakers}
            qual={qual}
            confirmedCount={confirmedCount}
            flightCount={flightCount}
            venues={venues}
            homeVenue={homeVenue}
            chainWarnings={issuesForRound(chain, s.position).map((w) => w.message)}
            chainsRounds={chainsRounds}
          />
        );
      })}
      {stages.length === 0 && (
        <div className="card elev-sm">
          <span className="text-muted" style={{ fontSize: 13 }}>
            {/* The parenthetical that used to end this line said "start with a
                Round Robin". It was the defaulted type wearing a suggestion:
                everyone plays everyone in their flight is a match-play idea,
                and this screen is reached just as often by a club medal, where
                it is the wrong answer stated as the obvious one. */}
            No rounds yet — pick what is being played below.
          </span>
        </div>
      )}

      {/* Shut, this is one control rather than a card with a form inside it.
          A collapsed panel that still looks like a panel is not a saving —
          the point is that a screen showing four rounds shows four rounds and
          a way to add a fifth, not four rounds and a fifth being built. */}
      {!addOpen && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="card elev-sm"
          aria-expanded={false}
          style={{
            width: "100%",
            textAlign: "left",
            display: "flex",
            // `.card` sets column, so a bare `display: flex` here stacked the
            // plus, the label and the caret into three rows — the control read
            // as a centred heading with a chevron under it rather than as a
            // row you press.
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 44,
            cursor: "pointer",
            color: "var(--color-text)",
            border: "1px dashed var(--color-divider)",
          }}
        >
          <Icon name="plus" style={{ fontSize: 16, color: "var(--color-accent-200)", flex: "none" }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Add a round</span>
            {/* Names what is behind it. "Add a round" alone hides the fact
                that a cut and a bracket live in here too, and a control whose
                contents are a surprise is a control people do not open. */}
            <span className="text-muted" style={{ display: "block", fontSize: 13, marginTop: 2, lineHeight: 1.45 }}>
              Another round the field plays, or a cut or a bracket between them.
            </span>
          </span>
          <Icon name="caret-down" style={{ fontSize: 13, color: "var(--color-neutral-500)", marginLeft: "auto", flex: "none" }} />
        </button>
      )}

      {/* Was a bare select of four raw enum strings — "Single Match Stage"
          told an organizer nothing about what it would do, and the medal
          round every club plays wasn't on the list at all. Each option now
          says what the app will actually generate, because that is the whole
          difference between the types. */}
      {addOpen && (
      <div className="card elev-sm" style={{ gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <span className="card-title" style={{ fontSize: 15 }}>Add a round</span>
            <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
              Sequence as many as you like. The <em>type</em> decides what gets drawn — pairings, a
              cut, or a bracket. How it&apos;s scored is the <em>format</em> on each round, chosen
              separately, so a Stableford or four-ball round is a round of one of these types.
            </p>
          </div>
          {/* No way to shut it while there is nothing to shut it over: on an
              empty tournament this panel IS the screen, and a close button
              would offer an organizer a blank page. */}
          {stages.length > 0 && (
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              aria-expanded
              aria-label="Close the round builder"
              className="btn btn-ghost"
              style={{ marginLeft: "auto", flex: "none", minHeight: 44, minWidth: 44 }}
            >
              <Icon name="caret-up" />
            </button>
          )}
        </div>

        {/* Two groups rather than five equal cards. Nearly every round an
            organizer adds is one the field plays; a single match and a bracket are
            structure, added once if at all. Showing them as peers made the
            common choice a five-way decision every time. */}
        <span className="card-kicker">Rounds the field plays</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 8 }}>
          {STAGE_TYPE_INFO.filter((t) => !isStructuralStage(t.key)).map((t) => {
            const selected = newType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => pickType(t.key)}
                aria-pressed={selected}
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
                  <Icon name={t.icon} style={{ fontSize: 15, color: "var(--color-accent-200)" }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>
                  {t.blurb}
                </div>
              </button>
            );
          })}
        </div>

        <span className="card-kicker" style={{ marginTop: 4 }}>Structure</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 8 }}>
          {STAGE_TYPE_INFO.filter((t) => isStructuralStage(t.key)).map((t) => {
            const selected = newType === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => pickType(t.key)}
                aria-pressed={selected}
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
                  <Icon name={t.icon} style={{ fontSize: 15, color: "var(--color-accent-200)" }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</span>
                </div>
                <div className="text-muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>
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
          {/* Stacked like every other field in this row. It was the one
              inline label among four stacked ones, at 13px among 12s, so with
              the row aligned to `flex-end` its input sat on a different
              baseline to its neighbours — the row read as two rows that had
              not quite met. Same fields, same order, same behaviour. */}
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
            <span className="text-muted">How many?</span>
            <input
              className="input"
              type="number"
              min={1}
              max={MAX_ROUNDS_AT_ONCE}
              value={howMany}
              disabled={pending}
              onChange={(e) => setHowMany(Math.max(1, Math.min(MAX_ROUNDS_AT_ONCE, figureOr(readWhole(e.target.value), 1) || 1)))}
              style={{ width: 72, textAlign: "center" }}
              aria-label="How many rounds to add"
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
            <span className="text-muted">Format</span>
            <select
              className="input"
              value={bulkFormat}
              disabled={pending}
              onChange={(e) => setBulkFormat(e.target.value)}
              style={{ minWidth: 150 }}
              aria-label="Format for every round added"
            >
              {/* "Default for this event" — preselected, so the commonest path
                  through this screen never chose a format at all. What it
                  resolved to was the event's scoring hint, which on a
                  from-scratch tournament is match: a stroke play round came
                  out labelled Match Play, and score entry opened it in match
                  mode with nothing to enter. Measured on 2026-09-09 by adding
                  one and reading the card.

                  The format is HALF of what a round is — the type decides what
                  is drawn, the format decides how a score becomes a result —
                  so it is asked, like the type above it. */}
              <option value="">Choose…</option>
              {/* What the chosen type can be scored in — `formatChoicesFor`, the
                  list `addStage` also holds to. Before a type is picked, the
                  formats a stroke round can take, which is most of them; the
                  pick then narrows it. */}
              {(["own", "side"] as const).map((g) => {
                const opts = formatChoicesFor(newType || "Stroke Play Round").filter((c) => c.group === g);
                return opts.length === 0 ? null : (
                  <optgroup key={g} label={g === "own" ? "Played on your own" : "Played as a side"}>
                    {opts.map((c) => (
                      <option key={c.name} value={c.name}>{c.label}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
            <span className="text-muted">Holes</span>
            <select
              className="input"
              value={bulkHoles}
              disabled={pending}
              onChange={(e) => setBulkHoles(holesPlayed(parseInt(e.target.value, 10)))}
              style={{ width: 82 }}
              aria-label="Holes for every round added"
            >
              <option value={18}>18</option>
              <option value={9}>9</option>
            </select>
          </label>

          {/* A fixed-day league plays ON a day; it does not "play by" one.
              Leaving this blank keeps the old behaviour of no fixed date. */}
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
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
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13 }}>
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
            disabled={pending || !newType || !bulkFormat}
            onClick={() =>
              newType &&
              bulkFormat &&
              startTransition(async () => {
                setAddRefused("");
                const res = await addStage(newType, {
                  count: howMany,
                  format: bulkFormat || undefined,
                  holes: bulkHoles,
                  startDate: startDate || undefined,
                  intervalDays: interval,
                });
                // The Par plan's seven-day window, said beside the button.
                if (res?.error) {
                  setAddRefused(res.error);
                  return;
                }
                setHowMany(1);
                setStartDate("");
                if (res?.id) {
                  setOpenRound(res.id);
                  setJustAdded(res.id);
                }
              })
            }
          >
            <Icon name="plus" />{" "}
            {/* Names the round it will add, and says so is unanswered until
                one is picked. "Add round robin" on an unanswered screen was
                the default announcing itself as a decision. */}
            {!newType
              ? "Add round"
              : howMany === 1
                ? `Add ${stageTypeInfo(newType).label.toLowerCase()}`
                : `Add ${howMany} ${stageTypeInfo(newType).label.toLowerCase()}s`}
          </button>
        </div>
        {addRefused && (
          <p role="alert" style={{ fontSize: 13, margin: "6px 0 0", color: "var(--color-danger)" }}>
            {addRefused} <a href="/organization#plan">See plans</a>
          </p>
        )}

        {/* The consequence, stated before the click rather than discovered
            after it. Pairings are the thing an organizer is most often
            surprised by, in both directions.

            OUT of the field row and under it. As a flex sibling of the button
            this sentence competed with the fields for the same line: on a wide
            screen it sat to the right of the button reading like a caption
            belonging to nothing, and as the row filled it wrapped to wherever
            there happened to be space. It describes what the button will do,
            so it belongs beneath the row it describes — the same place every
            other explanation on this screen sits. */}
        <p className="text-muted" style={{ fontSize: 13, margin: "10px 0 0", maxWidth: "62ch", lineHeight: 1.5 }}>
          {/* Nothing is promised about a round nobody has chosen. This read
              "Draws a full set of pairings" on an untouched screen, which
              described the defaulted Round Robin rather than anything the
              organizer had asked for. */}
          {!newType
            ? "Pick one above — the type decides what gets drawn."
            : !bulkFormat
              ? `${addRoundConsequence(newType)} Now choose the format it is scored by.`
              : addRoundConsequence(newType)}
        </p>

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
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              All {howMany} rounds will be created the same
            </span>
            <p style={{ margin: "5px 0 0", fontSize: 13, lineHeight: 1.6 }}>
              They share the format, holes{startDate ? " and dates" : ""} set above. Everything
              else — the handicap allowance, the cut line, carry-forward, round codes — is set on
              each round, so changing one of those afterwards means editing {howMany} cards.
              {" "}Worth setting the format here rather than there.
            </p>
            {startDate && (
              <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55 }}>
                {interval === 0
                  ? `All ${howMany} on ${shortDate(startDate, locale)}.`
                  : `${shortDate(startDate, locale)}, then ${INTERVAL_OPTIONS.find((o) => o.days === interval)?.label.toLowerCase()} — last round ${shortDate(roundDates(startDate, howMany, interval)[howMany - 1], locale)}.`}
                {" "}Any one of them can be moved later if it rains off.
              </p>
            )}
          </div>
        )}
      </div>
      )}
    </div>
    </SetupLocked.Provider>
    </Launched.Provider>
    </ServerToday.Provider>
  );
}
