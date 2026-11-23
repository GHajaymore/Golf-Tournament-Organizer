"use client";
import React, { useEffect, useRef, useState, useTransition } from "react";
import { useGolfTerms } from "@/components/GolfTermsProvider";
import { roundLabel as roundLabelOf } from "@/lib/domain/round-label";
import { setStageScoringBasis, setStageMatchKeptBy, setStageScoring, setStageFormat, setStageHoles, setStagePlayedOn } from "@/app/actions/tournament";
import { setStageCourse } from "@/app/actions/courses";
import { GOLF_FORMATS, declaredInput, entryModeFor, isManualFormat } from "@/lib/formats";
import { MATCH_ENTRY_MODES } from "@/lib/domain/match-entry";
import { MATCH_KEPT_BY, keptByScoreInput, matchKeptBy, type MatchKeptBy } from "@/lib/domain/match-kept-by";
import { roundScoring, type EndCheck, type ScoreKeeping } from "@/lib/domain/round-scoring";
import { type RoundDoors } from "@/lib/domain/round-change";
import { useSaveStatus } from "@/components/SaveState";
import { useCaughtUp } from "@/components/useAction";
import { roundShapeMismatch } from "@/lib/domain/round-shape";
import { dueBeforePlayed, shortDate } from "@/lib/domain/round-dates";
import type { PickedCardNote } from "@/lib/domain/picked-card";
import { cutRuleWords, cutAfterRound } from "@/lib/domain/cut-ready";
import { carryForwardPrompt } from "@/lib/format-chain";
import { seededFromQualifiers, isIndividualStrokeRound, isKnockoutRound, isHeadToHead } from "@/lib/stage-types";
import type { MatchTiebreakKey } from "@/lib/domain/match-tiebreak";
import { isStablefordFormat } from "@/lib/domain/week-basis";
import type { SingleMatchView } from "@/lib/services/single-match";
import { BRACKET_MODES } from "@/lib/domain/bracket";
import type { TiebreakerKey } from "@/lib/domain";
import { type RoundFacts } from "@/lib/rounds-timeline";
import type { RoundStepView } from "@/lib/domain/timeline-step";
import { useFormatting } from "@/components/CurrencyProvider";
import { writeScoreInput } from "@/components/rounds/RoundScoreInput";
import { roundUnderWay } from "@/lib/domain/round-under-way";
import { SetupLocked, ServerToday, Launched, isIsoDate, ROUND_PALETTE, ROUND_TEXT, type RefusedAt, type SaveAnswer } from "@/components/rounds/shared";
import type { StageView, Arrangement, ThirdPlaceView, ScoringValues, QualValues } from "@/components/StagesClient";

export interface RoundCardProps {
  /** The timeline (behind its switch): the open round's settings in the side panel, not unfolded inline. */
  asPanel?: boolean;
  /** Step 2's golf facts for this round (course card, field, saved tee times); timeline only. */
  facts?: RoundFacts | null;
  /** Step 2: this round's state chip and spine shape, from the state machine (`courseDayOf`); timeline only. */
  roundStep?: RoundStepView | null;
  /** How many rounds the field plays, for the panel's "Round 2 of 3". */
  playingCount?: number;
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
}

/**
 * EVERYTHING ONE ROUND'S CONTROLS READ AND WRITE (R4, the move): the state, the handlers and the derived words that
 * `StageCard` held inline, lifted so the old screen and the redesigned one draw the same controls from one place.
 * Nothing here is new behaviour; it is the body of `StageCard` as it was.
 */
export function useRoundCtx(props: RoundCardProps) {
  const {
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
  facts = null,
  roundStep = null,
  playingCount = 0,
} = props;

  // The club's own date order — see `shortDate`.
  const { locale } = useFormatting();
  // And its golf words — "club, league and golf group competitions".
  const golfWords = useGolfTerms();
  // Gates only the controls whose action refuses a locked tournament — see
  // `SetupLocked` for the ones that deliberately stay open.
  const locked = React.useContext(SetupLocked);
  const caughtUp = useCaughtUp();
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
  const underWay = roundUnderWay({ hasResult, closed: stage.closed, launched, playedOn: stage.playedOn, today, isActiveRound: standing === "active" });
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
  /**
   * WHAT THE ROUNDS RULE SAID ABOUT A FORMAT CHANGE (J12, PR 7b): the refusal
   * once the round has scores ("…its cards would mean something else"), or the
   * re-draw a taken change leaves to do. The old "re-score N cards" question is
   * gone: after scores a format change is refused both ways (Golf Pro, Q5).
   */
  const [formatSaid, setFormatSaid] = useState<{ refused: boolean; words: string } | null>(null);
  /** A played round's new day: who sees it (section 3, "Players' schedules show the new day"). */
  const [dateSaid, setDateSaid] = useState("");
  /**
   * THE ROUND'S DOORS (`roundDoors`): each change's refusal as a sentence, or
   * null where it is open — asked of the rounds rule, so a control is never
   * offered that its action refuses. Without them (a screen that did not pass
   * them) the setup lock answers, as before.
   */
  const doors = stage.doors ?? null;
  const shut = (k: keyof RoundDoors) => (doors ? doors[k] !== null : locked);
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
    | { kind: "holes"; holes: number; cards: number; says?: string }
    | { kind: "basis"; basis: string; cards: number; says?: string }
    | { kind: "venue"; course: string | null; nine: string; cards: number; says?: string }
    | null
  >(null);
  // A holes, basis or venue change refused (the rounds rule, or an archived tournament) is said
  // under its own control through `sayRefused` below — one line per control.
  /**
   * What deleting this round would take with it.
   *
   * Null until the server refuses. Deleting a round deletes its matches, its
   * cards and — through the cascade — its skins pot with every stake already
   * collected, and the trash icon used to do all of that on one click.
   */
  const [removeCost, setRemoveCost] = useState<{ cards: number; stakes: number; records: number; refused?: string; drawn?: string } | null>(null);
  /** Delete refused outright — the rounds are locked (PR 5b) — said under the bin, in the lock's words. */
  const [removeRefused, setRemoveRefused] = useState("");
  // On the timeline Delete is the panel's last control, so its warning opens below the fold of
  // the panel's own scroll: brought into view when it appears (`rounds-panel.spec`, 2026-11-02).
  const removeWarningRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (removeCost && asPanel) removeWarningRef.current?.scrollIntoView({ block: "nearest" });
  }, [removeCost, asPanel]);
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
  /**
   * A REFUSED SAVE IS SAID BESIDE ITS CONTROL, AND THE CONTROL GOES BACK
   * (2026-11-09). An archived tournament's refusal — and a lock's — came back
   * as `{ ok: false, error }` and was dropped: the picker went on showing a
   * value the round does not have, and nothing said why. One line per control,
   * under it, in the server's words.
   */
  const [refused, setRefused] = useState<Partial<Record<RefusedAt, string>>>({});
  const sayRefused = (at: RefusedAt, res: SaveAnswer | undefined): boolean => {
    const no = !!res && !res.ok && !res.needsConfirm;
    setRefused((r) => ({ ...r, [at]: no ? (res?.error ?? "Couldn't save that.") : "" }));
    return no;
  };

  // Put a control back to what is actually stored, or it keeps showing a
  // value the round does not have — the same trap the format warning names.
  const putBack = (kind: "holes" | "basis" | "venue") => {
    if (kind === "holes") setHoles(stage.holes);
    else if (kind === "basis") setBasis(stage.scoringBasis);
    else {
      setCourseId(stage.courseId);
      setNine(stage.nine);
    }
  };
  const confirmRescore = () => {
    const p = rescore;
    if (!p) return;
    setRescore(null);
    startTransition(async () => {
      const res =
        p.kind === "holes"
          ? caughtUp(await setStageHoles(stage.id, p.holes, true))
          : p.kind === "venue"
            ? await setStageCourse(stage.id, p.course, p.nine, true)
            : caughtUp(await setStageScoringBasis(stage.id, p.basis, true));
      if (sayRefused(p.kind, res)) putBack(p.kind);
    });
  };
  const cancelRescore = () => {
    const p = rescore;
    setRescore(null);
    if (p) putBack(p.kind);
  };

  const commitFormat = (v: string) => {
    setFormat(v);
    setFormatSaid(null);
    // The rounds rule (J12, PR 7b): refused once the round has scores — the
    // strokes would stay and what they MEAN would change — and otherwise taken,
    // with the re-draw said where the new format draws differently.
    startTransition(async () => {
      const res = caughtUp(await setStageFormat(stage.id, v));
      // Refused outright (the rounds rule, or an archived tournament's words): the picker goes
      // back to what the round is, and the reason is said under it — `formatSaid`, the one line
      // under the Format box, which also carries what a taken change left to draw.
      if (res && !res.ok) {
        setFormat(stage.format);
        if ("error" in res && res.error) setFormatSaid({ refused: true, words: res.error });
      } else if (res && "said" in res && res.said) setFormatSaid({ refused: false, words: res.said });
    });
  };

  const commitPlayedOn = (v: string) => {
    const before = playedOn;
    setPlayedOn(v);
    setDateRefused("");
    setDateSaid("");
    startTransition(async () => {
      // Refused on the Par plan outside its seven-day window, or once the
      // tournament is completed: the date goes back to what is stored, and the
      // reason is said beside the field.
      const res = await setStagePlayedOn(stage.id, v);
      if (res && !res.ok) {
        setPlayedOn(before);
        setDateRefused(res.error ?? "That date could not be saved.");
      } else if (res?.said) setDateSaid(res.said);
    });
  };

  const commitHoles = (v: number) => {
    setHoles(v);
    // Refuses on a round that already holds cards, exactly as the format does
    // — eighteen to nine re-ranks the stroke index onto the nine played and
    // measures every card against a different denominator.
    startTransition(async () => {
      const res = caughtUp(await setStageHoles(stage.id, v));
      if (res?.needsConfirm) setRescore({ kind: "holes", holes: v, cards: res.cards ?? 0 });
      // Refused (the rounds rule, or an archived tournament): the radio goes back and the
      // reason is said under it, where the press was.
      else if (sayRefused("holes", res)) putBack("holes");
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
      } else if (sayRefused("venue", res)) {
        // Refused by the rounds rule (J12), or an archived tournament: the picker goes back,
        // and the reason is said beside the venue and the nine.
        putBack("venue");
      }
    });
  };
  const commitBasis = (next: string) => {
    setBasis(next);
    // Gross, net and Stableford rank the same numbers three different ways,
    // and the countback now runs on whichever this says. See the action.
    startTransition(async () => {
      const res = caughtUp(await setStageScoringBasis(stage.id, next));
      if (res?.needsConfirm) setRescore({ kind: "basis", basis: next, cards: res.cards ?? 0, says: res.says });
      else if (sayRefused("basis", res)) putBack("basis");
    });
  };
  const commitScoreInput = (next: string) => {
    const before = scoreInput;
    setScoreInput(next);
    startTransition(async () => {
      if (sayRefused("input", caughtUp(await writeScoreInput(stage.id, next)))) setScoreInput(before);
    });
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
      const res = caughtUp(await setStageMatchKeptBy(stage.id, next));
      if (!res.ok) {
        setKeptBy(before);
        setKeptByRefusal(res.error ?? "Couldn't change that.");
      }
    });
  };

  // WHO KEEPS THE CARD, AND WHO CHECKS IT (2026-11-04, `roundScoring`). A
  // refusal — a late switch to one scorer — is said beside the choice and the
  // radio goes back, as "How players keep their matches" does.
  const [scoringNow, setScoringNow] = useState(() =>
    roundScoring({ scoreKeeping: stage.scoreKeeping ?? null, endCheck: stage.endCheck ?? null }),
  );
  const [scoringOpen, setScoringOpen] = useState(false);
  const [scoringRefusal, setScoringRefusal] = useState("");
  const commitScoring = (next: { scoreKeeping?: ScoreKeeping; endCheck?: EndCheck }) => {
    const before = scoringNow;
    setScoringNow({ ...scoringNow, ...next });
    setScoringRefusal("");
    startTransition(async () => {
      const res = await setStageScoring(stage.id, next);
      if (!res.ok) {
        setScoringNow(before);
        setScoringRefusal(res.error ?? "Couldn't change that.");
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
  // THE CUT THIS ROUND DECIDES, in the words the rules sheet prints
  // (`cutAfterRound`): "top 8 in each flight and ties" — a cut to "top 8" was
  // the summary of a per-flight cut too. Asked of the sheet's own function
  // (2026-11-07), so the card names the cut its scores decide — a round robin's
  // cut past a medal on the round robin's card, under the round it feeds — and
  // nothing for a cut no engine makes.
  const cutHere = cutAfterRound(allStages, stage.id);
  const cutWords = cutHere
    ? `cuts to ${cutRuleWords(cutHere.rule, cutHere.ties).toLowerCase()}${
        cutHere.tieRule === "playoff" ? ", a tie by play-off" : cutHere.tieRule === "countback" ? ", a tie by countback" : ""
      }`
    : "";
  if (cutHere && cutHere.intoId === nextStage?.id) transitionParts.push(cutWords);
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
  // What flows into the next round, worked out once: the closed row says it, or — on the
  // timeline — the link under the round does, and never both (2026-10-30).
  let intoNext = "";
  if (nextStage && chainsRounds && (showTransition || nextIsDraw || transitionParts.length > 0)) {
    const into = nextIsDraw
      ? qual.mode === "overall"
        ? `top ${qual.overall} overall`
        : `top ${qual.perFlight} per flight`
      : transitionParts.length
        ? transitionParts.join(" · ")
        : "everyone, points start fresh";
    intoNext = `Into ${roundLabelOf(allStages, nextStage.id)}: ${into}`;
    if (!asPanel) rowParts.push(intoNext);
  } else if (showTransition && !nextStage) {
    rowParts.push("No round after this yet");
  }
  // A cut this round decides into a LATER round — a round robin's cut past a
  // medal — said under the round it feeds, never as the next round's.
  if (cutHere && cutHere.intoId !== nextStage?.id && chainsRounds) {
    const later = `Into ${roundLabelOf(allStages, cutHere.intoId)}: ${cutWords}`;
    intoNext = intoNext ? `${intoNext} · ${later}` : later;
    if (!asPanel) rowParts.push(later);
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
  return {
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
    canSetVenue,
    hasResult,
    sharedWithAll,
    arrangement,
    asPanel,
    facts,
    roundStep,
    playingCount,
    locale,
    golfWords,
    locked,
    caughtUp,
    today,
    launched,
    dayHasCome,
    underWay,
    thisRound,
    deadline,
    setDeadline,
    dueError,
    setDueError,
    optError,
    setOptError,
    basis,
    setBasis,
    scoreInput,
    setScoreInput,
    format,
    setFormat,
    holes,
    setHoles,
    playedOn,
    setPlayedOn,
    dateRefused,
    setDateRefused,
    courseId,
    setCourseId,
    nine,
    setNine,
    nineMayStayOpen,
    customizeOpen,
    setCustomizeOpen,
    formatInfoOpen,
    setFormatInfoOpen,
    formatSaid,
    setFormatSaid,
    dateSaid,
    setDateSaid,
    doors,
    shut,
    rescore,
    setRescore,
    removeCost,
    setRemoveCost,
    removeRefused,
    setRemoveRefused,
    removeWarningRef,
    pending,
    startTransition,
    saveStatus,
    refused,
    setRefused,
    sayRefused,
    putBack,
    confirmRescore,
    cancelRescore,
    commitFormat,
    commitPlayedOn,
    commitHoles,
    commitVenue,
    commitBasis,
    commitScoreInput,
    keptBy,
    setKeptBy,
    keptByRefusal,
    setKeptByRefusal,
    commitKeptBy,
    scoringNow,
    setScoringNow,
    scoringOpen,
    setScoringOpen,
    scoringRefusal,
    setScoringRefusal,
    commitScoring,
    activeFormat,
    shapeProblem,
    activePending,
    carryPrompt,
    description,
    showTransition,
    showStrokeCut,
    notGenerated,
    transitionParts,
    cutHere,
    cutWords,
    roundRaisesTies,
    customizeParts,
    changedHandicaps,
    rowParts,
    nextIsDraw,
    intoNext,
    decidesParts,
    summaryParts,
    summaryLine,
    sameAsAllLine,
    roundColor,
    roundText,
    playByOnFace,
  };
}

export type RoundCtx = ReturnType<typeof useRoundCtx>;
