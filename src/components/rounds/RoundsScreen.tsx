"use client";
import React, { useState } from "react";
import Link from "next/link";
import type { StagesClient } from "@/components/StagesClient";
import { NeedsStrokesBand } from "@/components/NeedsStrokesBand";
import { RoundColumn } from "@/components/setup/RoundColumn";
import { SetupField } from "@/components/setup/SetupField";
import { LockedOnce } from "@/components/setup/LockedOnce";
import { roundLabel } from "@/lib/domain/round-label";
import { roundStanding } from "@/lib/domain/round-standing";
import { chainIssues, issuesForRound } from "@/lib/format-chain";
import { isKnockoutRound, isPlayingRound, nextPlayingStage, seededFromQualifiers } from "@/lib/stage-types";
import { shortDate } from "@/lib/domain/round-dates";
import type { RoundRing } from "@/lib/domain/round-ring";
import type { Mark } from "@/lib/domain/setup-field";
import type { ScreenKey } from "@/lib/domain/console-merges";
import type { RoundStepView } from "@/lib/domain/timeline-step";
import type { CorrectionFacts, ScopeLock } from "@/lib/domain/tournament-status";
import { AddRoundPanel } from "@/components/rounds/AddRoundPanel";
import { BetweenRounds } from "@/components/rounds/BetweenRounds";
import { DrawRound } from "@/components/rounds/DrawRound";
import { RemoveWarning } from "@/components/rounds/RemoveWarning";
import { RoundAllowanceBlock } from "@/components/rounds/RoundAllowanceBlock";
import { RoundBasisControl } from "@/components/rounds/RoundBasisControl";
import { RoundBracketMode } from "@/components/rounds/RoundBracketMode";
import { RoundCourseTees } from "@/components/rounds/RoundCourseTees";
import { RoundDayControl } from "@/components/rounds/RoundDayControl";
import { RoundDeadlineField } from "@/components/rounds/RoundDeadlineField";
import { RoundDeleteButton } from "@/components/rounds/RoundDeleteButton";
import { RoundFormatControl } from "@/components/rounds/RoundFormatControl";
import { RoundHandicapsBlock } from "@/components/rounds/RoundHandicapsBlock";
import { RoundHolesControl } from "@/components/rounds/RoundHolesControl";
import { RoundMatchKeptBy } from "@/components/rounds/RoundMatchKeptBy";
import { RoundOnTheDay } from "@/components/rounds/RoundOnTheDay";
import { RoundScoreInput } from "@/components/rounds/RoundScoreInput";
import { RoundScoringException } from "@/components/rounds/RoundScoringException";
import { RoundSignUp } from "@/components/rounds/RoundSignUp";
import { RoundSingleMatch } from "@/components/rounds/RoundSingleMatch";
import { RoundTeamScoringBlock } from "@/components/rounds/RoundTeamScoringBlock";
import { RoundThirdPlace, roundThirdPlaceShown } from "@/components/rounds/RoundThirdPlace";
import { RoundTies } from "@/components/rounds/RoundTies";
import { ScoringTile } from "@/components/rounds/ScoringTile";
import { Launched, ServerToday, SetupLocked } from "@/components/rounds/shared";
import { useRoundCtx, type RoundCardProps } from "@/components/rounds/use-round-ctx";

/** What the page works out from the machine and hands over; the screen draws it and computes none of it. */
export interface RoundsScreenExtras {
  /** `courseDayOf(...).rounds`: each round's one chip. */
  chips: Record<string, RoundStepView>;
  /** `roundRing(...)` for each round; null draws the state instead. */
  rings: Record<string, RoundRing | null>;
  /** The day's Default/Required mark (`markOf`), per round. */
  dayMarks: Record<string, Mark | null>;
  /** The day the app proposes for each round (`defaultRoundDays`), "" when it proposes none. */
  defaultDays: Record<string, string>;
  /** The citation of each round's default allowance (`allowanceSource`); absent where the round has none. */
  allowanceSources: Record<string, string>;
  /** "Round 1" where this round plays a course an earlier round plays (`inheritedRoundTee`). */
  inheritedTees: Record<string, string>;
  /** The event's own answer to "Can players enter scores?". */
  eventScoring: { scoreEntryBy: string };
  /** The rounds scope's lock, drawn once (`LockedOnce`). */
  lock: { locks: ScopeLock[]; correction: CorrectionFacts | null; isAdmin: boolean; open: readonly string[] | null };
  /** The redesigned screens shown to this request (`screensShownFor`). */
  shown: ScreenKey[];
  /** Where Round n's draw is made when Tee times & draw is shown (`relocate`), else "/stages". */
  drawHref: Record<string, string>;
}

export type RoundsScreenProps = React.ComponentProps<typeof StagesClient> & RoundsScreenExtras;

/**
 * ROUNDS & FORMATS, THE REDESIGNED SCREEN (R4), drawn while its key is shown. One column per round with the same rows in the
 * same order (Day, Course when there is more than one, Format, Holes, Handicap), the event's Scoring once above them, what
 * flows from one round into the next between them, and everything else under More. Every control is a component the old
 * Rounds screen mounts too (`components/rounds/`), so no rule is written twice.
 *
 * A control that leaves this screen for a room not yet shown stays here until that room is shown: ONE boolean, whether
 * Tee times & draw (or Score entry) is in `shown`, decides where the one component is mounted.
 */
export function RoundsScreen(p: RoundsScreenProps) {
  const { stages, today, launched = false, locked = false, roundsWithResults = [], activeStageId = null, strokesBand = [], chainsRounds = true } = p;
  const completed = p.lock.locks.some((l) => l.by === "completed");
  const activeIndex = stages.findIndex((s) => s.id === activeStageId);
  const chain = chainIssues(
    stages.map((s) => ({ id: s.id, position: s.position, type: s.type, format: s.format, scoringBasis: s.scoringBasis, carryForwardEnabled: s.carryEnabled, cutEnabled: s.cutEnabled })),
  );
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const playing = stages.filter((s) => isPlayingRound(s.type));
  return (
    <ServerToday.Provider value={today}>
      <Launched.Provider value={launched}>
        <SetupLocked.Provider value={locked}>
          <div data-rounds-screen style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <NeedsStrokesBand rounds={strokesBand} />
            <LockedOnce locks={p.lock.locks} isAdmin={p.lock.isAdmin} correction={p.lock.correction} open={p.lock.open}>
              {() => (
                <>
                  <ScoringTile
                    rounds={playing.map((s) => ({ id: s.id, label: roundLabel(stages, s.id) || s.type, scoreKeeping: s.scoreKeeping ?? null, endCheck: s.endCheck ?? null }))}
                    settings={p.eventScoring}
                    canChange={p.lock.isAdmin && !completed}
                  />
                  {stages.map((s, i) => {
                    const card: RoundCardProps = {
                      stage: s,
                      isFirst: i === 0,
                      standing: roundStanding({ isActive: activeStageId === s.id, index: i, activeIndex, hasResult: roundsWithResults.includes(s.id) }),
                      nextStage: nextPlayingStage(stages, s.position),
                      allStages: stages,
                      rrMatchesPerPlayer: p.rrMatchesPerPlayer,
                      scoring: p.scoring,
                      tiebreakers: p.tiebreakers,
                      matchTiebreakers: p.matchTiebreakers ?? [],
                      qual: p.qual,
                      confirmedCount: p.confirmedCount,
                      flightCount: p.flightCount ?? 1,
                      venues: p.venues ?? [],
                      homeVenue: p.homeVenue ?? "",
                      chainWarnings: issuesForRound(chain, s.position).map((w) => w.message),
                      chainsRounds,
                      expanded: true,
                      onToggle: () => undefined,
                      singleMatch: p.singleMatches?.[s.id] ?? null,
                      thirdPlace: p.thirdPlaces?.[s.id] ?? null,
                      canSetVenue: p.canSetVenue ?? true,
                      hasResult: roundsWithResults.includes(s.id),
                      arrangement: p.arrangement ?? null,
                    };
                    return (
                      <RoundView
                        key={s.id}
                        card={card}
                        chip={p.chips[s.id]}
                        ring={p.rings[s.id] ?? null}
                        extras={p}
                        completed={completed}
                        justAdded={justAdded === s.id}
                      />
                    );
                  })}
                  {stages.length === 0 && (
                    <div className="card elev-sm">
                      <span className="text-muted" style={{ fontSize: 13 }}>No rounds yet — pick what is being played below.</span>
                    </div>
                  )}
                </>
              )}
            </LockedOnce>
            {!completed && <AddRoundPanel roundCount={stages.length} onAdded={(id) => setJustAdded(id)} />}
          </div>
        </SetupLocked.Provider>
      </Launched.Provider>
    </ServerToday.Provider>
  );
}

function RoundView({
  card,
  chip,
  ring,
  extras,
  completed,
  justAdded,
}: {
  card: RoundCardProps;
  chip: RoundStepView | undefined;
  ring: RoundRing | null;
  extras: RoundsScreenExtras & { launched?: boolean };
  completed: boolean;
  justAdded: boolean;
}) {
  const ctx = useRoundCtx(card);
  const { stage, thisRound, doors, locale, holes, playedOn, summaryLine, hasResult, isFirst, commitPlayedOn } = ctx;
  const [more, setMore] = useState(false);
  const shown = new Set(extras.shown);
  const drawHref = extras.drawHref[stage.id] ?? "/stages";
  const drawMoved = drawHref !== "/stages";
  const launched = !!extras.launched;
  const played = hasResult && launched;
  const readOnly = completed || played;
  const label = thisRound || stage.type;
  const defaultDay = extras.defaultDays[stage.id] ?? "";
  const source = extras.allowanceSources[stage.id];
  const inherited = extras.inheritedTees[stage.id];
  const dayShut = doors ? doors.day !== null : false;
  return (
    <>
      <div id={`round-${stage.id}`} data-just-added={justAdded ? "" : undefined} style={{ scrollMarginTop: 88, minWidth: 0 }}>
        <RoundColumn label={label} chip={chip ?? { chip: "", tone: "neutral" }} ring={ring}>
          {card.chainWarnings.length > 0 && (
            <div style={{ padding: "8px 10px", border: "1px solid var(--color-divider)", borderRadius: 8, fontSize: 13, minWidth: 0 }}>
              {card.chainWarnings.map((w, i) => (
                <p key={i} className="text-muted" style={{ margin: 0 }}>{w}</p>
              ))}
            </div>
          )}
          {readOnly ? (
            <div data-round-settings-text style={{ minWidth: 0 }}>
              {completed ? null : (
                <p style={{ margin: "0 0 4px", fontSize: 13 }}>This round has scores, so its settings are locked.</p>
              )}
              <p className="text-muted" style={{ margin: 0, fontSize: 13, overflowWrap: "anywhere" }}>
                {[stage.format, `${stage.holes} holes`, stage.playedOn ? shortDate(stage.playedOn, locale) : "", summaryLine].filter(Boolean).join(" · ")}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              {!isKnockoutRound(stage.type) && (
                <SetupField
                  label="Day"
                  mark={extras.dayMarks[stage.id] ?? null}
                  dflt={defaultDay ? { value: defaultDay, source: "The event's first day, one round a day" } : null}
                  isDefault={defaultDay !== "" && playedOn === defaultDay}
                  onChange={null}
                  onUseDefault={defaultDay && !dayShut ? () => commitPlayedOn(defaultDay) : null}
                >
                  <RoundDayControl ctx={ctx} />
                </SetupField>
              )}
              {((card.venues?.length ?? 0) > 1 || holes === 9) && (
                <SetupField label="Course" mark={null} dflt={null} isDefault={false} onChange={null} onUseDefault={null}>
                  <RoundCourseTees ctx={ctx} />
                  {inherited && <span className="text-muted" style={{ display: "block", fontSize: 13 }}>Same tees as {inherited} at this course</span>}
                </SetupField>
              )}
              <SetupField label="Format" mark={null} dflt={null} isDefault={false} onChange={null} onUseDefault={null}>
                <RoundFormatControl ctx={ctx} />
              </SetupField>
              <SetupField label="Holes" mark={null} dflt={null} isDefault={false} onChange={null} onUseDefault={null}>
                <RoundHolesControl ctx={ctx} />
              </SetupField>
              <SetupField
                label="Handicap"
                mark={null}
                dflt={stage.allowance && source ? { value: `${stage.allowance.allowance}%`, source: `Allowance ${stage.allowance.allowance}%, from ${source}` } : null}
                isDefault={!!stage.allowance && !stage.allowance.overridden}
                onChange={null}
                onUseDefault={null}
              >
                <RoundBasisControl ctx={ctx} />
              </SetupField>
            </div>
          )}

          {/* WHERE A CONTROL THAT LEAVES THIS SCREEN STAYS UNTIL ITS ROOM IS SHOWN: one boolean decides, never two copies, never neither. */}
          {!completed && launched && !isFirst && !seededFromQualifiers(stage.type) &&
            (drawMoved ? (
              <Link href={drawHref} style={{ color: "var(--color-accent-200)", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                Draw {label}&apos;s matches
              </Link>
            ) : (
              <DrawRound stage={stage} label={label} />
            ))}
          {!completed && !drawMoved && roundThirdPlaceShown(ctx) && <RoundThirdPlace ctx={ctx} />}
          {!shown.has("teeTimes") ? (
            !completed && <RoundHandicapsBlock ctx={ctx} />
          ) : (
            stage.handicaps.length > 0 && (
              <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                {stage.handicaps.filter((h) => h.override !== null).length} handicap(s) set for this round, on Tee times &amp; draw.
              </p>
            )
          )}
          {!shown.has("scoreEntry") && !completed && <RoundOnTheDay ctx={ctx} />}

          {!readOnly && (
            <div style={{ minWidth: 0 }}>
              <button
                type="button"
                className="btn btn-ghost"
                aria-expanded={more}
                onClick={() => setMore((m) => !m)}
                style={{ minHeight: 44 }}
              >
                More about {label}
              </button>
              {/* In the page while closed, as a closed round is: a draft in it survives closing. */}
              <div data-round-more style={{ display: more ? "flex" : "none", flexDirection: "column", gap: 16, marginTop: 8, minWidth: 0 }}>
                <RoundTeamScoringBlock ctx={ctx} />
                <RoundAllowanceBlock ctx={ctx} />
                <RoundScoreInput ctx={ctx} />
                <RoundScoringException ctx={ctx} />
                <RoundMatchKeptBy ctx={ctx} />
                <RoundSingleMatch ctx={ctx} />
                <RoundBracketMode ctx={ctx} />
                <RoundTies ctx={ctx} />
                <RoundDeadlineField ctx={ctx} />
                <RoundSignUp ctx={ctx} />
              </div>
            </div>
          )}
          {!readOnly && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
              <RoundDeleteButton ctx={ctx} />
              <RemoveWarning ctx={ctx} />
            </div>
          )}
        </RoundColumn>
      </div>
      {!completed && <BetweenRounds ctx={ctx} />}
    </>
  );
}
