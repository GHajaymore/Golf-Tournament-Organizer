"use client";
import { AddRoundPanel } from "@/components/rounds/AddRoundPanel";
import { RoundCardProps, useRoundCtx } from "@/components/rounds/use-round-ctx";
import { BASIS_CHOICES, SetupLocked, ServerToday, Launched, SettingsGroup } from "@/components/rounds/shared";
import { DrawRound } from "@/components/rounds/DrawRound";
import { RoundDeadlineField } from "@/components/rounds/RoundDeadlineField";
import { RoundSignUp } from "@/components/rounds/RoundSignUp";
import { RemoveWarning } from "@/components/rounds/RemoveWarning";
import { RoundFormatControl } from "@/components/rounds/RoundFormatControl";
import { RoundHolesControl } from "@/components/rounds/RoundHolesControl";
import { RoundDayControl } from "@/components/rounds/RoundDayControl";
import { RoundCourseTees } from "@/components/rounds/RoundCourseTees";
import { RoundDeleteButton } from "@/components/rounds/RoundDeleteButton";
import { RoundFormatInfo } from "@/components/rounds/RoundFormatInfo";
import { RoundBasisControl } from "@/components/rounds/RoundBasisControl";
import { RoundTeamScoringBlock } from "@/components/rounds/RoundTeamScoringBlock";
import { RoundAllowanceBlock } from "@/components/rounds/RoundAllowanceBlock";
import { RoundSingleMatch, roundSingleMatchShown } from "@/components/rounds/RoundSingleMatch";
import { RoundCut, roundCutShown } from "@/components/rounds/RoundCut";
import { RoundBracketMode, roundBracketModeShown } from "@/components/rounds/RoundBracketMode";
import { RoundThirdPlace, roundThirdPlaceShown } from "@/components/rounds/RoundThirdPlace";
import { RoundQualification, roundQualificationShown } from "@/components/rounds/RoundQualification";
import { RoundTransition } from "@/components/rounds/RoundTransition";
import { RoundOnTheDay } from "@/components/rounds/RoundOnTheDay";
import { RoundTies } from "@/components/rounds/RoundTies";
import { RoundScoreInput } from "@/components/rounds/RoundScoreInput";
import { RoundMatchKeptBy } from "@/components/rounds/RoundMatchKeptBy";
import { RoundScoringException } from "@/components/rounds/RoundScoringException";
import { RoundHandicapsBlock } from "@/components/rounds/RoundHandicapsBlock";

import React, { useEffect, useState, useTransition } from "react";
import Link from "next/link";

// Aliased: several components here hold a local `roundLabel` string built from
// it, and shadowing the import would read as a bug rather than as a value.
import { roundLabel as roundLabelOf, roundNumber as roundNumberOf } from "@/lib/domain/round-label";
import { formatChoicesFor } from "@/lib/domain/round-choices";
import { setStageScoringBasis, setStageFormat, setStageHoles } from "@/app/actions/tournament";

import { isManualFormat } from "@/lib/formats";




import { roundStanding } from "@/lib/domain/round-standing";

import { type RoundDoors } from "@/lib/domain/round-change";
import { SaveState } from "./SaveState";



import { shortDate } from "@/lib/domain/round-dates";

import type { PickedCardNote } from "@/lib/domain/picked-card";



import { chainIssues, issuesForRound } from "@/lib/format-chain";
import { seededFromQualifiers, nextPlayingStage, isPlayingRound } from "@/lib/stage-types";


import { type RoundScoringInfo } from "./RoundTeamScoring";


import { type RoundAllowanceInfo } from "./RoundAllowance";
import { NeedsStrokesBand, type BandRound } from "./NeedsStrokesBand";
import type { RoundHandicapView } from "@/lib/services/round-handicap";
import type { MatchTiebreakKey } from "@/lib/domain/match-tiebreak";



import { isStablefordFormat } from "@/lib/domain/week-basis";
export interface ThirdPlaceView {
  on: boolean;
  problem: string;
  aName: string;
  bName: string;
  made: boolean;
}
import type { SingleMatchView } from "@/lib/services/single-match";


import { type BracketMode } from "@/lib/domain/bracket";



import type { TiebreakerKey } from "@/lib/domain";
import { Icon } from "./Icon";
import type { CutTieOnCard } from "./CutReadyCard";
import { SidePanel } from "./SidePanel";
import { CourseCard, NeedsYou, PanelSection, RecipeTiles, RoundChip, TeeTicks, factsLine } from "./RoundsTimeline";
import { effectLine, type RoundFacts } from "@/lib/rounds-timeline";
import type { CourseDay } from "@/lib/domain/timeline-step";



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
  /** Who enters this round's scores, as stored. Read through `roundScoring`. */
  scoreKeeping?: string;
  /** The end-of-round check, as stored. Read through `roundScoring`. */
  endCheck?: string;
  /**
   * The tournament has a published tee sheet to take groups from
   * (`groupsArePublished`). Without one, a round kept by one scorer per group
   * has no groups yet and each player keeps their own card — said on the card.
   */
  groupsPublished?: boolean;
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
  /**
   * A round robin's cut into this round, where its line falls in a tie the
   * committee settles (J31) — decided or not — with the round robin it is
   * taken out of. Null where there is no such tie, or no such cut.
   */
  cutTie?: { feederId: string; ties: CutTieOnCard[] } | null;
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
  /**
   * WHAT THE ROUNDS RULE SAYS OF THIS ROUND (J12, PR 7b; `roundDoors`): each of
   * its format, allowance, tees, day and delete, refused in a sentence or open.
   * Optional: a screen that does not pass them falls back to the setup lock.
   */
  doors?: RoundDoors | null;
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


function StageCard(props: RoundCardProps & { onTheDayHere: boolean }) {
  const ctx = useRoundCtx(props);
  const { stage, isFirst, standing, allStages, confirmedCount, chainWarnings, expanded, onToggle, sharedWithAll, asPanel, facts, roundStep, playingCount, locale, launched, underWay, thisRound, basis, format, customizeOpen, setCustomizeOpen, saveStatus, notGenerated, roundRaisesTies, customizeParts, intoNext, summaryLine, sameAsAllLine, roundColor, roundText, playByOnFace } = ctx;
  
  

  // The round's face, its format note and its body, named so they can be drawn in one of two
  // places: unfolded inline (today's screen), or in the side panel (the timeline, behind its
  // switch). One rendered copy either way — never the same controls twice.
  // The face in three parts, so the timeline's panel can put them under the golf panel's
  // headings ("Date & course" first, then "Format & scoring"); today's screen draws them
  // back to back exactly as before.
  /*
   * Deleting a round is the one destructive control here that asked nothing at all, while the
   * format dropdown above it refuses. The stake count is separate from the card count on purpose:
   * cards can be re-entered from the paper, and money cannot.
   *
   * SAID WHERE THE PRESS WAS. Today's screen draws it under the Format box, which is in the same
   * row as the trash button. The timeline's panel puts Delete at its very end, a screen away from
   * the Format box, so there it is drawn beside Delete (`rounds-panel.spec`, 2026-11-02).
   */
  
  const faceFormat = (
    <>
      <RoundFormatControl ctx={ctx} />
      <RoundHolesControl ctx={ctx} />
    </>
  );
  const faceWhere = (
    <>
      <RoundDayControl ctx={ctx} />
      <RoundCourseTees ctx={ctx} />
    </>
  );
  const faceDelete = <RoundDeleteButton ctx={ctx} />;
  const face = (
    <>
      {faceFormat}
      {faceWhere}
      {faceDelete}
    </>
  );
  const formatInfo = <RoundFormatInfo ctx={ctx} />;
  const body = (
    <>
      <RoundBasisControl ctx={ctx} />
      <RoundTeamScoringBlock ctx={ctx} />
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
      <RoundAllowanceBlock ctx={ctx} />
      <SettingsGroup title="What this round decides">
        {roundSingleMatchShown(ctx) && <RoundSingleMatch ctx={ctx} />}
        {roundCutShown(ctx) && <RoundCut ctx={ctx} />}
        {roundBracketModeShown(ctx) && <RoundBracketMode ctx={ctx} />}
        {roundThirdPlaceShown(ctx) && <RoundThirdPlace ctx={ctx} />}
        {roundQualificationShown(ctx) && <RoundQualification ctx={ctx} />}
      </SettingsGroup>
      <RoundTransition ctx={ctx} />
      {playByOnFace && <RoundDeadlineField ctx={ctx} />}
      <RoundSignUp ctx={ctx} />
      {/* The same boolean the redesigned Rounds screen asks (`shown.has("scoreEntry")`): while Score entry is shown
          the round is closed and its window set THERE, and this screen stops drawing them (R12). */}
      {props.onTheDayHere && <RoundOnTheDay ctx={ctx} />}
    </>
  );
  // "Customize this round" on its own, so the timeline's panel can give it the fourth section
  // ("Extra rules"); today's screen draws it straight after the body, exactly as before.
  const extraRules = (
    <>
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
            <RoundTies ctx={ctx} />
            <RoundScoreInput ctx={ctx} />

            <RoundMatchKeptBy ctx={ctx} />

            <RoundScoringException ctx={ctx} />

            {!playByOnFace && <RoundDeadlineField ctx={ctx} />}

            <RoundHandicapsBlock ctx={ctx} />
          </div>
        )}
      </div>
    </>
  );

  // ── STEP 2, "COURSE DAY" (timeline only) ──
  // How the round is scored, in the tiles' words. Read from the round as stored; the
  // allowance is the one in force (the committee's, or the Rules' figure).
  const basisWords = isManualFormat(format)
    ? ""
    : isStablefordFormat(format)
      ? stage.allowance ? `Off handicap ${stage.allowance.allowance}%` : "Off handicap"
      : basis === "net"
        ? stage.allowance ? `Net ${stage.allowance.allowance}%` : "Net"
        : basis === "both"
          ? "Gross and net"
          : basis === "gross" ? "Gross" : "";
  // The state chip is the STATE MACHINE's (PR 5c, J16): `roundStep`, from the round's own step
  // (results only, D8) and its first need — the same need the strip lists for it. It was worked
  // out here from the round's date, today, the launch and the course facts: a fourth answer to
  // "has this round started" (D8) and a second list of what it lacks (D7).
  const effect = asPanel && facts && isPlayingRound(stage.type) ? effectLine({ holes: stage.holes, basis: basisWords.toLowerCase(), facts }) : null;
  const roundNo = roundNumberOf(allStages, stage.id);

  return (
    <div
      id={`round-${stage.id}`}
      // On the timeline a round is a stop on the spine, not a boxed card (`.round-node`), and its
      // state is drawn from `data-standing` — by shape, never by colour alone.
      className={asPanel ? "round-node" : "card elev-sm"}
      data-standing={asPanel ? (roundStep?.standing ?? "setup") : undefined}
      data-open={asPanel && expanded ? "" : undefined}
      // Clear of the sticky header when a new round is scrolled to. A CLOSED
      // round is a row, so it is padded as one (2026-10-16): ten closed rounds
      // were 76px each, the card's padding outweighing the line it held.
      style={
        asPanel
          ? { scrollMarginTop: 88 }
          : {
              gap: 14,
              borderLeft: `3px solid ${roundColor}`,
              scrollMarginTop: 88,
              ...(expanded ? {} : { paddingTop: 8, paddingBottom: 8 }),
            }
      }
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
            {!asPanel && underWay && !notGenerated && (
              <span className="tag tag-neutral">
                {standing === "active" ? "In play" : standing === "played" ? "Played" : "Upcoming"}
              </span>
            )}
            {!asPanel && notGenerated && (
              <span className="tag tag-neutral"><Icon name="clock" /> Not drawn yet</span>
            )}
            {/* The timeline's state chip (step 2): what the round is, as the state machine says. */}
            {asPanel && <RoundChip step={roundStep} />}
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
          {asPanel ? (
            // STEP 2: the recipe as tiles, always (the panel is beside the row, not inside it).
            <span className="rt-recipe">
              <RecipeTiles holes={stage.holes} format={format} basis={basisWords} />
            </span>
          ) : !expanded && (
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
      {/* STEP 2: the round's field at a glance — where, who, how many groups, when — and its tee
          times as ticks. Muted: these are facts, the row's button is the action. */}
      {asPanel && facts && isPlayingRound(stage.type) && (
        <div className="rt-field">
          {factsLine(facts) && <span className="text-muted rt-field-words">{factsLine(facts)}</span>}
          <TeeTicks facts={facts} />
        </div>
      )}
      {/* On the timeline, what flows into the next round sits under the round, on the spine. The
          same words the closed row says on today's screen (`intoNext`), never a second reading. */}
      {asPanel && intoNext && (
        <div className="round-link">
          <span className="round-link-chip">
            <Icon name="arrow-down" aria-hidden="true" /> {intoNext}
          </span>
        </div>
      )}

      {!asPanel && formatInfo}


      {/* Everything below is the round's configuration, folded away when the
          card is closed. The chain warnings above stay visible either way:
          "this round doesn't follow on from the last one" is the one thing an
          organizer must see without opening anything. */}
      {!asPanel && <div style={{ display: expanded ? "contents" : "none" }}>{body}{extraRules}</div>}

      {/* THE TIMELINE (behind its switch, 2026-10-30): the same face and body, in the side panel,
          inside this card in the page so every test's `#round-<id>` still finds them. Kept
          mounted while closed, as the inline card always was. */}
      {asPanel && (
        <SidePanel
          keepMounted
          // Beside the list from 1280px, and not modal there: a press on another round switches to it.
          dock
          open={expanded}
          title={thisRound || stage.type}
          kicker={[
            roundNo && playingCount > 1 ? `Round ${roundNo} of ${playingCount}` : "",
            stage.type,
            stage.playedOn ? shortDate(stage.playedOn, locale) : "",
          ].filter(Boolean).join(" · ")}
          onClose={onToggle}
          footer={<SaveState status={saveStatus} />}
        >
          {/* STEP 2 ("Course day", 2 Nov). THE EFFECT FIRST, from what is stored (rule 4): what this
              round will be on the day, before anything in it is touched. */}
          {effect && (
            <p className="rt-effect">
              <b>{effect.setting}</b> <Icon name="arrow-right" aria-hidden="true" /> {effect.outcome}.
            </p>
          )}
          {/* The golf panel's order (30 Oct): when and where first, then how it is played, then
              who plays with whom, then the rarely-changed rules folded under Customize. Each section
              says what it decides (rule 1); a choice already made shows as chosen. */}
          <PanelSection
            n={1}
            title="Date & course"
            decides="When and where this round is played. A new date moves this round only."
            aside={stage.playedOn ? shortDate(stage.playedOn, locale) : undefined}
          >
            {facts && <CourseCard facts={facts} holes={stage.holes} />}
            <div className="round-panel-face">{faceWhere}</div>
          </PanelSection>
          <PanelSection
            n={2}
            title="Format & scoring"
            decides="How a card becomes a score. Set as most clubs play it; change only what your club does differently."
            aside={<span className="tag tag-accent">{format}</span>}
          >
            <div className="round-panel-face">{faceFormat}</div>
            {formatInfo}
            {body}
          </PanelSection>
          {isPlayingRound(stage.type) && facts && (
            <PanelSection
              n={3}
              title="Groups & pairings"
              decides="Who plays with whom, and when. Players see their time once the tee sheet is published."
              aside={!facts.hasSheet && confirmedCount > 0 ? <span className="tag tag-accent-2">No tee times</span> : undefined}
            >
              <p className="rt-sect-fact">
                {facts.hasSheet
                  ? effectLine({ holes: stage.holes, basis: "", facts }).outcome + "."
                  : confirmedCount > 0
                    ? `${facts.players} ${facts.players === 1 ? "player" : "players"} to draw into groups.`
                    : "Groups are drawn once players have entered."}
              </p>
              {/* The tee sheet is its own screen (`/foursomes`, "Tee sheet" in the menu): drawn there,
                  read here. A quiet link — the screen's one filled button is elsewhere (rule 2). */}
              <Link href={`/foursomes?round=${stage.id}`} className="rt-sect-link">
                Tee sheet <span className="sr-only">for {thisRound || "this round"}</span>
                <Icon name="arrow-right" aria-hidden="true" />
              </Link>
            </PanelSection>
          )}
          <PanelSection
            n={isPlayingRound(stage.type) && facts ? 4 : 3}
            title="Extra rules"
            decides="Ties and the rules most rounds never change. Folded; its bar says what each is set to."
          >
            {extraRules}
          </PanelSection>
          {intoNext && (
            <div className="rt-after">
              <span className="rt-after-title">After this round</span>
              <span>{intoNext}</span>
            </div>
          )}
          <div className="round-panel-delete">{faceDelete}</div>
          {/* What deleting would destroy, under the button that asked (see `removeWarning`). */}
          <RemoveWarning ctx={ctx} />
        </SidePanel>
      )}
    </div>
  );
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
  linkedRound = null,
  roundFacts = null,
  courseDay = null,
  strokesBand = [],
  onTheDayHere = true,
}: {
  /**
   * Whether each round draws its "On the day" group, the tick that closes it and the scoring window (R12). The page says it,
   * from the same `shown.has("scoreEntry")` the redesigned screens ask, so Score entry and this screen never both draw them
   * and never both leave them out. Optional in the TYPE only because some fifty old render tests build this screen without
   * it and may not be edited; `closing-a-round-has-one-home.test.tsx` holds that the one page that mounts it always says.
   */
  onTheDayHere?: boolean;
  /**
   * Rounds scored net in which players with no handicap index need strokes (`playersNeedingFigure`), for
   * the band at the top (`NeedsStrokesBand`). Empty for anybody who may not give strokes.
   */
  strokesBand?: BandRound[];
  /** Step 2: each round's golf facts, worked out on the server from what is stored (timeline only). */
  roundFacts?: Record<string, RoundFacts> | null;
  /**
   * Step 2: where the tournament is — the "Needs you" strip and each round's chip — read from the
   * state machine on the server (`courseDayOf`, PR 5c / J16). Timeline only; never worked out here.
   */
  courseDay?: CourseDay | null;
  /** A round named in the address (`?round=<id>`): opened on arrival, if it is one of these. */
  linkedRound?: string | null;
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
  /**
   * Which round is open. One at a time, and none when there are several.
   *
   * A tournament with one or two rounds opens the first: there is nothing to
   * scroll past, and making somebody click to see the only round would be
   * officious. A league opens none, because ten expanded rounds is the wall
   * this replaced.
   */
  const [openRound, setOpenRound] = useState<string | null>(
    // A link straight to one round (`?round=<id>`, 2026-10-30) opens it; an id that is not
    // one of this tournament's rounds is ignored, never trusted.
    linkedRound && stages.some((s) => s.id === linkedRound)
      ? linkedRound
      : stages.length > 0 && stages.length <= 2 ? stages[0].id : null,
  );

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
    <div className={timeline ? "rounds-timeline" : undefined} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* STEP 2: the next step, always visible, above the rounds it opens (the brief's rule 3). */}
      {timeline && courseDay && <NeedsYou guide={courseDay} onOpen={(id) => setOpenRound(id)} />}
      {/* Players with no handicap index in a round scored net, and the box that gives them strokes:
          above every round, unfolded (lane N). Always mounted, so it outlives the last Give's refresh
          and says the last confirmation; it draws nothing with nobody to ask and nothing given. Staff
          only — the page passes nothing to anybody the actions would refuse. */}
      <NeedsStrokesBand rounds={strokesBand} />
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
        const card = (
          <StageCard
            key={s.id}
            stage={s}
            onTheDayHere={onTheDayHere}
            canSetVenue={canSetVenue}
            allStages={stages}
            singleMatch={singleMatches?.[s.id] ?? null}
            thirdPlace={thirdPlaces?.[s.id] ?? null}
            hasResult={roundsWithResults.includes(s.id)}
            sharedWithAll={shared}
            arrangement={arrangement}
            asPanel={timeline}
            redesign={false}
            facts={timeline ? roundFacts?.[s.id] ?? null : null}
            roundStep={timeline ? courseDay?.rounds[s.id] ?? null : null}
            playingCount={playing.length}
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
        if (!timeline) return card;
        // THE SPINE (the timeline's one bold idea, 2026-10-30): each round a stop on one line, like
        // the routing on a course map; what flows into the next round is said under each stop.
        return (
          <div key={s.id} className="round-spine-item" data-last={i === stages.length - 1 ? "" : undefined}>
            {card}
          </div>
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

      <AddRoundPanel redesign={false} roundCount={stages.length} onAdded={(id) => { setOpenRound(id); setJustAdded(id); }} />
    </div>
    </SetupLocked.Provider>
    </Launched.Provider>
    </ServerToday.Provider>
  );
}
